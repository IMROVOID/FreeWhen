/**
 * The provider seam.
 *
 * `src/routing/` is the only module that knows a provider exists (PRD-10 §6),
 * and it is also a **client** module: it is imported by screens. So it may
 * never read a provider key from the environment, and it may never open a
 * socket to a provider directly without being handed the key.
 *
 * The seam is therefore two injected things:
 *
 * - a **transport** — the function that performs the HTTP request, and
 * - a **key provider** — the function that returns the key for a service,
 *   or `null` when the service is not configured.
 *
 * On the client the key provider always returns `null`, so no provider rung
 * is ever reachable and the ladder resolves to the straight-line floor. On
 * the server it returns the real key, read from the environment by
 * `server/lib/provider-secrets.ts` — the ONLY place a key is read
 * (PRD-10 D9).
 *
 * This is what makes "no provider key in the released bundle" a structural
 * property rather than a review obligation: the client bundle contains the
 * name of the variable it would read, and never a value.
 */

import type { Coordinate, TransportMode, TravelMeasurement } from './types';

/**
 * The HTTP transport an adapter uses.
 *
 * Deliberately the `fetch` signature, so the server can pass the platform
 * `fetch` unchanged and a test can pass a stub.
 *
 * `body` is the already-serialised request body. It is a string rather than
 * an object so the transport does not have to know how to serialise one,
 * and so a test can assert on exactly what would go over the wire.
 */
export type ProviderTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<ProviderResponse>;

/** A response, as the adapter needs it. */
export interface ProviderResponse {
  /** The HTTP status. */
  status: number;
  /** The body, already read as text. */
  body: string;
}

/** The provider services that carry their own key. */
export type ProviderService = 'neshan_matrix' | 'neshan_direction' | 'ors';

/**
 * Resolves the key for a service.
 *
 * Returns `null` when the service is unconfigured. `null` is NOT an error:
 * an absent key means the ladder skips that rung, which is a config
 * decision, not a failure.
 */
export type ProviderKeyProvider = (service: ProviderService) => string | null;

/**
 * A provider service that is not configured.
 *
 * The ladder treats it exactly like a provider that failed: it moves to the
 * next rung. An absent key and an exhausted quota are the same thing to the
 * ladder — that service is unavailable — and they are logged differently.
 */
export const NO_KEY: ProviderKeyProvider = () => null;

/**
 * A request for one journey.
 *
 * The origin and destination are already rounded to 2 dp by the caller: the
 * cache key snaps them, and a precise origin would turn a shared cache into
 * a location store (PRD-05 §12.1, PRD-09 AS9.2).
 */
export interface TravelRequest {
  origin: Coordinate;
  destination: Coordinate;
  mode: TransportMode;
  /** The instant the journey departs, snapped to a 15-minute bucket. */
  departureBucket: string;
}

/**
 * A batch of journeys, one origin against many destinations.
 *
 * The matrix endpoint exists precisely so this is ONE request rather than
 * n×k of them: at 10 participants × 15 venues × 3 modes, the difference is
 * 3 requests and 450 (PRD-05 §12.1, layer 3).
 */
export interface MatrixRequest {
  origins: Coordinate[];
  destinations: Coordinate[];
  mode: TransportMode;
  departureBucket: string;
}

/**
 * The outcome of one pair in a matrix.
 *
 * A pair is either measured, or it is absent for a NAMED reason. "Absent"
 * is never a zero and never a low cost.
 */
export type MatrixOutcome =
  | { kind: 'measured'; measurement: TravelMeasurement }
  /** The provider found no route. Infeasible, not free and not instant. */
  | { kind: 'no_route' }
  /** The provider was uncertain about this pair. */
  | { kind: 'unknown' };

/**
 * A matrix result, with the coverage it achieved.
 *
 * `resolved` and `total` are separate because **partial results are normal,
 * not an error** (PRD-05 §12.3): a matrix where 6 of 8 pairs resolve is a
 * success with coverage 6/8, and the caller must be able to say so.
 */
export interface MatrixResult {
  outcomes: Map<string, MatrixOutcome>;
  /** The number of pairs that resolved. */
  resolved: number;
  /** The number of pairs requested. */
  total: number;
}

/**
 * A batch-capable provider adapter.
 *
 * The single-pair interface is the special case of this one, so a provider
 * that can only answer one journey at a time implements `measure` and gets
 * `measureMatrix` for free.
 */
export interface BatchTravelAdapter {
  readonly name: string;
  /** The rung this adapter occupies. 1 is the best. */
  readonly rung: number;
  /**
   * The provider service this adapter calls, when it calls one.
   *
   * The server uses it to consult the per-provider backoff BEFORE the call:
   * a benched provider is skipped without a network round trip, which is
   * the point — the request would fail anyway, and failing fast is what
   * keeps the ranking fast.
   *
   * `null` for the offline rungs, which have no provider to back off from.
   */
  readonly service?: ProviderService | null;
  /** Whether this adapter can serve the given mode at all. */
  supports?(mode: TransportMode): boolean;
  /** One journey. Returns `null` when the adapter cannot answer. */
  measure(request: TravelRequest): Promise<TravelMeasurement | null>;
  /** Many journeys at once. The default is one call per pair. */
  measureMatrix?(request: MatrixRequest): Promise<MatrixResult>;
}

/**
 * A hook the server uses to record a provider's refusal.
 *
 * The adapters are client-safe and know nothing about backoff, so the
 * server injects the hook. Without it, a provider that has just told us
 * its quota is spent would be asked again on the next request — and the
 * next.
 */
export type ProviderRefusalRecorder = (
  service: ProviderService,
  reason: 'quota' | 'rate' | 'config' | 'transient',
) => void;

/**
 * The options every provider adapter accepts.
 */
export interface ProviderAdapterOptions {
  transport: ProviderTransport;
  keys: ProviderKeyProvider;
  /** The clock, injected so a test never reads the wall clock. */
  now?: () => Date;
  /** The sleep between a retry, injected so a test does not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Records a refusal, so the server can bench the provider. */
  onRefusal?: ProviderRefusalRecorder;
}
export function pairKey(originIndex: number, destinationIndex: number): string {
  return `${originIndex}:${destinationIndex}`;
}

/**
 * The key under which a pair's outcome is stored.
 *
 * The pair is identified by its INDICES, not by its coordinates: a matrix
 * response is positional, and a coordinate key would silently mismatch a
 * re-sorted request.
 */
