/**
 * The Neshan matrix adapter — rung 1 of the degradation ladder.
 *
 * ★ The matrix endpoint is the PRIMARY path, and the reason is batching.
 *
 * At 10 participants × 15 venues × 3 modes, the naive path is 450
 * individual requests. The matrix endpoint is 3. That difference is the
 * difference between a working demo and a provider that has blocked us
 * (PRD-05 §12.1, layer 3).
 *
 * ★ PARTIAL RESULTS ARE NORMAL, NOT AN ERROR.
 *
 * Each `element` in the response carries its own `status`. A matrix where 6
 * of 8 pairs resolve is a **success with coverage 6/8** — the seven good
 * measurements must survive the one bad pair. All-or-nothing handling turns
 * a usable result into a failure, which is the single most likely way to
 * lose the primary rung in production (PRD-05 §12.3).
 *
 * ★ The key is a HEADER, never a query string.
 *
 * Query strings land in proxy logs, and the provider key must not
 * (PRD-10 D9).
 */

import {
  MATRIX_MAX_PAIRS,
  NESHAN_TYPE_BY_MODE,
  PROVIDER_BACKOFF_BASE_MS,
  PROVIDER_ENDPOINTS,
  PROVIDER_RETRY_COUNT,
} from '../config';
import {
  pairKey,
  type BatchTravelAdapter,
  type MatrixOutcome,
  type MatrixRequest,
  type MatrixResult,
  type ProviderAdapterOptions,
  type ProviderService,
  type TravelRequest,
} from '../provider';
import type { Coordinate, TransportMode, TravelMeasurement } from '../types';
import {
  mapNeshanStatus,
  neshanActionRetries,
  refusalReasonFor,
  type NeshanAction,
  type NeshanElementStatus,
} from './neshan-errors';

/** The service whose key the matrix endpoint requires. */
const SERVICE: ProviderService = 'neshan_matrix';

/** One element of a Neshan matrix row. */
interface NeshanElement {
  status?: string;
  distance?: { value?: number };
  duration?: { value?: number };
}

/** The top-level Neshan matrix response. */
interface NeshanMatrixResponse {
  status?: string;
  rows?: Array<{ elements?: NeshanElement[] }>;
}

/** What the adapter learned from one request. */
export interface NeshanMatrixAttempt {
  /** The HTTP status, or `null` when the request never completed. */
  status: number | null;
  /** The documented action for that status. */
  action: NeshanAction;
  /** The parsed outcomes, when the request succeeded. */
  outcomes: Map<string, MatrixOutcome>;
  /** Whether the request was retried. */
  retried: boolean;
}

/**
 * Builds the matrix URL.
 *
 * The origins and destinations are pipe-separated `lat,lng` lists, and `type`
 * is `car` or `motorcycle` only. A mode with no Neshan equivalent has no
 * URL — the adapter declines it rather than sending a wrong `type`.
 */
export function buildMatrixUrl(
  origins: Coordinate[],
  destinations: Coordinate[],
  type: 'car' | 'motorcycle',
): string {
  const encode = (points: Coordinate[]): string =>
    points.map((point) => `${point.lat},${point.lng}`).join('|');

  const query = new URLSearchParams({
    type,
    origins: encode(origins),
    destinations: encode(destinations),
  });

  return `${PROVIDER_ENDPOINTS.neshanMatrix}?${query.toString()}`;
}

/**
 * The status of one element, normalised.
 *
 * An unrecognised status is treated as `UnknownError` rather than as a
 * success: a status this code has never seen must not be read as a
 * measurement.
 */
function elementStatus(element: NeshanElement): NeshanElementStatus {
  if (element.status === 'Ok') return 'Ok';
  if (element.status === 'NoRoute') return 'NoRoute';
  return 'UnknownError';
}

/**
 * Turns one `Ok` element into a measurement.
 *
 * The duration is seconds and the distance is metres, per the provider's
 * documented units. A `high`-confidence measurement carries NO range: a
 * range on a live measurement is false precision, and PRD-08's
 * `displayMinutes` renders `high` as a bare integer (PRD-04 FR-4.18).
 */
function toMeasurement(
  element: NeshanElement,
  fetchedAt: string,
): TravelMeasurement {
  const seconds = element.duration?.value ?? 0;
  const meters = element.distance?.value ?? 0;

  return {
    minutes: Math.round(seconds / 60),
    // A live measurement is precise. The range is null, and the UI reads
    // `confidence` to decide how to present it.
    minutesRange: null,
    distanceMeters: Math.round(meters),
    transfers: null,
    walkMinutes: null,
    waitMinutes: null,
    // A provider does not quote a fare. Unknown is unknown — NEVER 0, or
    // every venue reads as free (PRD-09 §13.3).
    costIrr: null,
    parkingCostIrr: null,
    confidence: 'high',
    source: 'neshan_matrix',
    fetchedAt,
  };
}

/**
 * Parses a successful matrix response into per-pair outcomes.
 *
 * The response is POSITIONAL: `rows[i].elements[j]` is the pair
 * (origin i, destination j). The pairs are keyed by INDEX, not by
 * coordinate, because a coordinate key would silently mismatch a re-sorted
 * request.
 */
export function parseMatrixResponse(
  response: NeshanMatrixResponse,
  fetchedAt: string,
): Map<string, MatrixOutcome> {
  const outcomes = new Map<string, MatrixOutcome>();

  const rows = response.rows ?? [];
  rows.forEach((row, originIndex) => {
    const elements = row.elements ?? [];
    elements.forEach((element, destinationIndex) => {
      const key = pairKey(originIndex, destinationIndex);

      switch (elementStatus(element)) {
        case 'Ok':
          outcomes.set(key, { kind: 'measured', measurement: toMeasurement(element, fetchedAt) });
          break;
        case 'NoRoute':
          // ★ The absence of a route means INFEASIBILITY — not a low cost
          // and not an instant journey. It is reported as unknown so the
          // participant is counted in `coverage.missing` rather than scored
          // as `u = 0` (TC-5).
          outcomes.set(key, { kind: 'no_route' });
          break;
        case 'UnknownError':
          outcomes.set(key, { kind: 'unknown' });
          break;
      }
    });
  });

  return outcomes;
}

/** The options the matrix adapter is built with. */
export type NeshanMatrixOptions = ProviderAdapterOptions

/**
 * The Neshan matrix adapter.
 *
 * Built by a factory rather than exported as a singleton, because the
 * transport and the key provider are injected: a test supplies stubs, the
 * client supplies neither, and the server supplies both.
 */
export function createNeshanMatrixAdapter(options: NeshanMatrixOptions): BatchTravelAdapter {
  const { transport, keys } = options;
  const now = options.now ?? ((): Date => new Date());
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const onRefusal = options.onRefusal;

  /** One request, with the documented retry policy applied. */
  async function attempt(url: string, key: string): Promise<NeshanMatrixAttempt> {
    let retried = false;

    for (let tries = 0; ; tries += 1) {
      let response: { status: number; body: string } | null = null;

      try {
        response = await transport(url, {
          method: 'GET',
          // ★ The key is a HEADER. A query string would put it in every proxy
          // log on the path.
          headers: { 'Api-Key': key },
        });
      } catch {
        // A timeout or a network failure has no HTTP status. It is treated
        // as the transient case, because a network fault is the one failure
        // a retry can actually fix.
        if (tries < PROVIDER_RETRY_COUNT) {
          retried = true;
          await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
          continue;
        }
        onRefusal?.(SERVICE, 'transient');
        return {
          status: null,
          action: { kind: 'retry_once_then_degrade' },
          outcomes: new Map(),
          retried,
        };
      }

      if (response.status >= 200 && response.status < 300) {
        let parsed: NeshanMatrixResponse;
        try {
          parsed = JSON.parse(response.body) as NeshanMatrixResponse;
        } catch {
          // A 200 with an unparseable body is not a measurement.
          return {
            status: response.status,
            action: { kind: 'degrade_immediately' },
            outcomes: new Map(),
            retried,
          };
        }
        return {
          status: response.status,
          action: { kind: 'retry_once_then_degrade' },
          outcomes: parseMatrixResponse(parsed, now().toISOString()),
          retried,
        };
      }

      const action = mapNeshanStatus(response.status);

      // ★ Only a transient error is retried. A config fault (480/483/484/485)
      // and an exhausted quota (481) cannot be fixed by asking again, and a
      // retry-on-reflex implementation spends its whole budget discovering
      // that.
      if (neshanActionRetries(action) && tries < PROVIDER_RETRY_COUNT) {
        retried = true;
        await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
        continue;
      }

      // ★ THE REFUSAL IS RECORDED WITH THE REASON THE TABLE IMPLIES.
      // 481 is a quota, 482 is a rate cap, 480/483/484/485 are config
      // faults, and 400 is a caller bug. Each needs a different bench: a
      // quota lasts for hours, a rate cap for a minute, and a config fault
      // until a deploy.
      onRefusal?.(SERVICE, refusalReasonFor(response.status, action));

      return { status: response.status, action, outcomes: new Map(), retried };
    }
  }

  return {
    name: 'neshan_matrix',
    rung: 1,
    service: SERVICE,

    supports(mode: TransportMode): boolean {
      return NESHAN_TYPE_BY_MODE[mode] !== undefined;
    },

    async measure(request: TravelRequest): Promise<TravelMeasurement | null> {
      const type = NESHAN_TYPE_BY_MODE[request.mode];
      if (!type) return null;

      const key = keys(SERVICE);
      // An absent key is not an error: the service is unconfigured, so the
      // ladder moves on. It is logged loudly by the server that owns the key.
      if (!key) return null;

      const result = await this.measureMatrix!({
        origins: [request.origin],
        destinations: [request.destination],
        mode: request.mode,
        departureBucket: request.departureBucket,
      });

      const outcome = result.outcomes.get(pairKey(0, 0));
      return outcome?.kind === 'measured' ? outcome.measurement : null;
    },

    async measureMatrix(request: MatrixRequest): Promise<MatrixResult> {
      const type = NESHAN_TYPE_BY_MODE[request.mode];
      if (!type) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      const key = keys(SERVICE);
      if (!key) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      const total = request.origins.length * request.destinations.length;
      if (total === 0) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      // The pair cap is applied to every provider, not just the one that
      // publishes a limit. Neshan's per-request limit is UNVERIFIED, so the
      // conservative bound applies to it too (PRD-05 §12.2).
      const origins = request.origins.slice(0, MATRIX_MAX_PAIRS);
      const destinations = request.destinations.slice(0, MATRIX_MAX_PAIRS);

      const url = buildMatrixUrl(origins, destinations, type);
      const attemptResult = await attempt(url, key);

      if (attemptResult.outcomes.size === 0 && attemptResult.status !== null) {
        // A documented failure. The outcomes are empty, so the ladder moves
        // to the next rung.
        return { outcomes: new Map(), resolved: 0, total };
      }

      const resolved = [...attemptResult.outcomes.values()].filter(
        (outcome) => outcome.kind === 'measured',
      ).length;

      return { outcomes: attemptResult.outcomes, resolved, total };
    },
  };
}
