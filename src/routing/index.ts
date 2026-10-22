/**
 * The travel-time interface.
 *
 * `src/routing/` is the ONLY module that knows a provider exists (PRD-10 §6).
 * Every caller asks for a `TravelMeasurement` and never learns whether it
 * came from Neshan, ORS, or the straight-line fallback.
 *
 * The ladder degrades rather than fails (PRD-05 §12.4):
 *
 *   Neshan matrix → Neshan direction → ORS matrix → ORS direction
 *     → straight-line × 1.35 (low) → no estimate (unknown)
 *
 * ★ THIS MODULE IS CLIENT-SAFE.
 *
 * It never reads a provider key from the environment and never opens a
 * socket to a provider on its own: the transport and the key provider are
 * injected (see `provider.ts`). On the client the key provider returns
 * `null`, so no provider rung is reachable and the ladder resolves to the
 * straight-line floor. On the server both are supplied, and the key is read
 * in exactly one place — `server/lib/provider-secrets.ts` (PRD-10 D9).
 */

import { estimateStraightLine } from './adapters/straight-line';
import { noEstimateAdapter } from './adapters/no-estimate';
import { createNeshanMatrixAdapter } from './adapters/neshan-matrix';
import { createNeshanDirectionAdapter } from './adapters/neshan-direction';
import { createOrsAdapter } from './adapters/ors';
import {
  defaultLadder,
  resolveMatrix,
  resolveTravel,
  type LadderOptions,
} from './ladder';
import type {
  BatchTravelAdapter,
  ProviderKeyProvider,
  ProviderTransport,
} from './provider';
import type { Coordinate, TransportMode, TravelMeasurement } from './types';

export type { Coordinate, Confidence, TransportMode, TravelMeasurement } from './types';
export type {
  BatchTravelAdapter,
  MatrixOutcome,
  MatrixRequest,
  MatrixResult,
  ProviderKeyProvider,
  ProviderService,
  ProviderTransport,
  TravelRequest,
} from './provider';
export type { DegradationReason, LadderOutcome } from './ladder';

/** A rung of the ladder: given a journey, produce a measurement or decline. */
export interface TravelAdapter {
  readonly name: string;
  measure(
    from: Coordinate,
    to: Coordinate,
    mode: TransportMode,
    now?: Date,
  ): Promise<TravelMeasurement | null>;
}

/**
 * The final rung: no estimate is available. Confidence is `unknown`, never a
 * fabricated number.
 */
export const noEstimate = {
  name: 'none',
  async measure(
    _from: Coordinate,
    _to: Coordinate,
    _mode: TransportMode,
    now = new Date(),
  ): Promise<TravelMeasurement> {
    return noEstimateAdapter.measure({
      origin: _from,
      destination: _to,
      mode: _mode,
      departureBucket: now.toISOString(),
    });
  },
} satisfies TravelAdapter;

/**
 * The straight-line rung. Always available — free, offline, no key.
 */
export const straightLine = {
  name: 'straight_line',
  async measure(
    from: Coordinate,
    to: Coordinate,
    mode: TransportMode,
    now?: Date,
  ): Promise<TravelMeasurement> {
    return estimateStraightLine({ from, to, mode, ...(now ? { now } : {}) });
  },
} satisfies TravelAdapter;

/**
 * The offline ladder: the straight-line floor and the unknown rung.
 *
 * ★ THIS IS THE CLIENT-SIDE LADDER.
 *
 * A client has no provider key — it must not, and the ORS terms forbid it
 * — so the provider rungs are unreachable from the client and the ranking
 * degrades to a labelled straight-line estimate. That is a shipping state,
 * not a failure (PRD-10 D9, PRD-05 §12.4).
 */
export const LADDER: readonly TravelAdapter[] = [straightLine, noEstimate];

/**
 * Estimates a journey, degrading through the ladder until a rung answers.
 *
 * The engine never fails; it degrades (PRD-05 §12.4).
 */
export async function getTravelTime(
  from: Coordinate,
  to: Coordinate,
  mode: TransportMode,
  now?: Date,
): Promise<TravelMeasurement> {
  for (const adapter of LADDER) {
    const measurement = await adapter.measure(from, to, mode, now);
    if (measurement) return measurement;
  }

  // Unreachable: `noEstimate` always answers. Kept so the return type holds
  // if a future rung is allowed to decline.
  const fallback = await noEstimate.measure(from, to, mode, now);
  return fallback;
}

/**
 * The server-side ladder.
 *
 * Builds the full six-rung ladder over an injected transport and key
 * provider. The order is fixed by `defaultLadder` and must not be
 * reordered: Neshan first because it is the only provider with Iranian road
 * data and live local traffic, straight-line before none because a labelled
 * estimate beats no answer.
 *
 * The provider rungs are constructed here rather than imported as
 * singletons, because each needs the transport and the key provider. A
 * singleton would have to read the key from the environment, and that would
 * put the server's secret into a module the client bundle can reach.
 */
export function buildLadder(
  transport: ProviderTransport,
  keys: ProviderKeyProvider,
): BatchTravelAdapter[] {
  return defaultLadder([
    createNeshanMatrixAdapter({ transport, keys }),
    createNeshanDirectionAdapter({ transport, keys }),
    createOrsAdapter({ transport, keys }),
  ]);
}

/**
 * Resolves one journey through the full ladder.
 *
 * Never throws. The result carries the rung that served it and why the
 * ladder stopped there — the `ranking_degraded` analytics payload
 * (PRD-05 §16).
 */
export { resolveTravel, resolveMatrix };
export type { LadderOptions };
