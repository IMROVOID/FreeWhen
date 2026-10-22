/**
 * The degradation ladder.
 *
 * ★ THE LADDER NEVER FAILS; IT DEGRADES.
 *
 * PRD-05 §12.4: "Every rung is labeled honestly. The engine never fails; it
 * degrades." A `try/catch` that rethrows is a design violation, not an
 * implementation detail — a rethrow turns a degraded ranking into an error
 * screen, and an error screen leaves the group without a decision.
 *
 * ★ THE ORDER IS FIXED AND MUST NOT BE REORDERED.
 *
 *   1. Neshan matrix   — high. Iranian road data, live local traffic, and
 *                         ONE request for the whole matrix.
 *   2. Neshan direction — high. The per-pair fallback, bounded.
 *   3. ORS matrix      — high. The open fallback.
 *   4. ORS direction   — high.
 *   5. Straight-line   — low. Always available: no network, no key.
 *   6. No estimate     — unknown. "We have no number" as a stated state.
 *
 * Neshan comes first because it is the only provider with Iranian road data
 * and live local traffic. Straight-line comes before none because a labelled
 * estimate beats no answer at all.
 *
 * ★ NO RUNG MAY UPGRADE TRANSIT.
 *
 * Even if Neshan answers a car journey with `high` confidence, a transit
 * request returns `low` (TC-18). The guard lives HERE, at the ladder level,
 * so a future adapter cannot accidentally break it by being more confident
 * than the truth allows.
 */

import { estimateStraightLine } from './adapters/straight-line';
import { noEstimateAdapter } from './adapters/no-estimate';
import { mayKeepConfidence } from './transit';
import {
  pairKey,
  type BatchTravelAdapter,
  type MatrixOutcome,
  type MatrixRequest,
  type MatrixResult,
  type TravelRequest,
} from './provider';
import type { Coordinate, TransportMode, TravelMeasurement } from './types';

/** The rungs of the ladder, in order. */
export const LADDER_RUNG_COUNT = 6;

/**
 * Why the ladder stopped where it did.
 *
 * This is the `reason` on the `ranking_degraded` analytics event, and it is
 * a closed set so the metric can be counted (PRD-05 §16).
 */
export type DegradationReason =
  /** A provider served the measurement. */
  | 'served'
  /** The provider was not configured — no key. */
  | 'not_configured'
  /** The provider refused: a quota, a rate cap, or a config fault. */
  | 'provider_refused'
  /** The provider did not answer, or answered with something unusable. */
  | 'provider_unavailable'
  /** The provider answered, but not for this pair. */
  | 'no_route'
  /** The adapter does not serve this mode at all. */
  | 'mode_unsupported';

/** The outcome of one ladder walk. */
export interface LadderOutcome {
  /** The measurement the ladder settled on. */
  measurement: TravelMeasurement;
  /** The rung that produced it. 1 is the best. */
  levelReached: number;
  /** Why the ladder stopped there. */
  reason: DegradationReason;
  /** The name of the adapter that produced it. */
  source: string;
  /**
   * The pairs the provider could not resolve.
   *
   * A partial matrix is a success with partial coverage, and the coverage
   * is what the engine's `coverage.missing` is built from (PRD-05 §8.1).
   */
  coverage: { resolved: number; total: number };
}

/** The ladder's inputs. */
export interface LadderOptions {
  /**
   * The adapters, in order.
   *
   * Injected so a test can supply a ladder of failing adapters, and so the
   * order is the CALLER's decision — the default is the fixed order above.
   */
  adapters?: readonly BatchTravelAdapter[];
  /** The clock, injected so a test never reads the wall clock. */
  now?: () => Date;
}

/**
 * The default ladder.
 *
 * The provider rungs come first and the offline rungs last. A caller with
 * no configured providers gets the same ladder with the provider rungs
 * declining — which is the CLIENT's situation, and it correctly resolves
 * to the straight-line floor.
 */
export function defaultLadder(adapters: readonly BatchTravelAdapter[]): BatchTravelAdapter[] {
  return [
    ...adapters,
    {
      name: 'straight_line',
      rung: 5,
      async measure(request: TravelRequest): Promise<TravelMeasurement> {
        return estimateStraightLine({
          from: request.origin,
          to: request.destination,
          mode: request.mode,
          now: new Date(),
        });
      },
    },
    noEstimateAdapter,
  ];
}

/**
 * Walks the ladder for ONE journey.
 *
 * Never throws. Every rung is attempted in order, and the first one that
 * yields a usable measurement wins.
 */
export async function resolveTravel(
  request: TravelRequest,
  options: LadderOptions = {},
): Promise<LadderOutcome> {
  const now = options.now ?? ((): Date => new Date());
  const adapters = options.adapters ?? [];

  let lastReason: DegradationReason = 'provider_unavailable';

  for (const adapter of adapters) {
    // An adapter that does not serve this mode is skipped, not failed.
    if (adapter.supports && !adapter.supports(request.mode)) {
      lastReason = 'mode_unsupported';
      continue;
    }

    let measurement: TravelMeasurement | null = null;

    try {
      measurement = await adapter.measure(request);
    } catch {
      // ★ A throwing adapter is a failed rung, not a failed request. The
      // ladder moves on. This catch is the reason the ladder never fails.
      measurement = null;
    }

    if (!measurement) {
      lastReason = 'provider_unavailable';
      continue;
    }

    return {
      measurement: applyConfidenceGuard(request.mode, measurement),
      levelReached: adapter.rung,
      reason: 'served',
      source: adapter.name,
      coverage: { resolved: 1, total: 1 },
    };
  }

  // The offline rungs are the floor, and they cannot fail.
  const straightLine = estimateStraightLine({
    from: request.origin,
    to: request.destination,
    mode: request.mode,
    now: now(),
  });

  return {
    measurement: applyConfidenceGuard(request.mode, straightLine),
    levelReached: 5,
    reason: lastReason === 'mode_unsupported' ? 'mode_unsupported' : 'provider_unavailable',
    source: 'straight_line',
    coverage: { resolved: 1, total: 1 },
  };
}

/**
 * Runs an adapter that only implements `measure`, one pair at a time.
 *
 * ★ THE DOCUMENTED PROMISE: "A PROVIDER THAT CAN ONLY ANSWER ONE JOURNEY
 * AT A TIME IMPLEMENTS `measure` AND GETS `measureMatrix` FOR FREE."
 *
 * Without this, a single-pair adapter would be invisible to the matrix
 * path: the ladder would call it, get nothing, and fall through to the
 * straight-line floor — so a perfectly good provider would never serve a
 * matrix. That is a silent failure, which is the worst kind.
 *
 * The pairs are resolved SEQUENTIALLY, and the loop stops at the first
 * failure: a provider that cannot answer the first pair will not answer
 * the rest either, and asking 150 times would be worse than asking once.
 */
async function measureOneByOne(
  adapter: BatchTravelAdapter,
  request: MatrixRequest,
): Promise<MatrixResult> {
  const outcomes = new Map<string, MatrixOutcome>();
  const total = request.origins.length * request.destinations.length;
  let resolved = 0;

  outer: for (let originIndex = 0; originIndex < request.origins.length; originIndex += 1) {
    for (
      let destinationIndex = 0;
      destinationIndex < request.destinations.length;
      destinationIndex += 1
    ) {
      const key = pairKey(originIndex, destinationIndex);

      let measurement: TravelMeasurement | null = null;
      try {
        measurement = await adapter.measure({
          origin: request.origins[originIndex]!,
          destination: request.destinations[destinationIndex]!,
          mode: request.mode,
          departureBucket: request.departureBucket,
        });
      } catch {
        // A throwing adapter is a failed rung.
        break outer;
      }

      if (!measurement) {
        // The provider declined this pair. It will decline the rest.
        break outer;
      }

      outcomes.set(key, { kind: 'measured', measurement });
      resolved += 1;
    }
  }

  return { outcomes, resolved, total };
}

/**
 * Walks the ladder for a WHOLE MATRIX.
 *
 * ★ ONE CALL PER (MODE, DEPARTURE BUCKET), NOT ONE PER PAIR.
 *
 * At 10×15×3 unbounded calls this is the difference between 3 provider
 * requests and 450 (PRD-05 §12.1, layer 3).
 *
 * The matrix is resolved pair by pair INSIDE the ladder, so a provider that
 * resolves 6 of 8 pairs contributes those 6 and the rest fall through to
 * the next rung individually. A provider that resolves nothing contributes
 * nothing and the whole matrix moves down together.
 */
export async function resolveMatrix(
  request: MatrixRequest,
  options: LadderOptions = {},
): Promise<{
  results: Map<string, LadderOutcome>;
  coverage: { resolved: number; total: number };
  levelReached: number;
  reason: DegradationReason;
}> {
  const adapters = options.adapters ?? [];
  const results = new Map<string, LadderOutcome>();

  const total = request.origins.length * request.destinations.length;
  if (total === 0) {
    return { results, coverage: { resolved: 0, total: 0 }, levelReached: 0, reason: 'provider_unavailable' };
  }

  // The pairs that are still unresolved.
  let pending: Array<{ originIndex: number; destinationIndex: number }> = [];
  for (let originIndex = 0; originIndex < request.origins.length; originIndex += 1) {
    for (let destinationIndex = 0; destinationIndex < request.destinations.length; destinationIndex += 1) {
      pending.push({ originIndex, destinationIndex });
    }
  }

  let levelReached = 0;
  let reason: DegradationReason = 'provider_unavailable';

  for (const adapter of adapters) {
    if (pending.length === 0) break;

    if (adapter.supports && !adapter.supports(request.mode)) {
      reason = 'mode_unsupported';
      continue;
    }

    let matrix: MatrixResult;
    try {
      matrix = adapter.measureMatrix
        ? await adapter.measureMatrix({
            origins: request.origins,
            destinations: request.destinations,
            mode: request.mode,
            departureBucket: request.departureBucket,
          })
        : await measureOneByOne(adapter, request);
    } catch {
      // A throwing adapter is a failed rung. The ladder moves on.
      continue;
    }

    // ★ A MATRIX WITH NO MEASUREMENTS IS NOT NECESSARILY A FAILURE.
    //
    // A matrix where every pair came back `NoRoute` resolved every pair:
    // the provider answered, and its answer was "no road connects these
    // points". That is a fact about the world, not an outage, and it must
    // NOT be read as one — reading it as one would replace a known absence
    // with a straight-line estimate, which claims a journey exists where
    // the provider says none does.
    //
    // So the rung is skipped only when the provider produced NO OUTCOMES
    // at all. An outcome of any kind means the provider answered.
    if (matrix.outcomes.size === 0) {
      reason = 'provider_unavailable';
      continue;
    }

    // The rung was reached, but whether it SERVED anything is decided per
    // pair below. A matrix of pure `NoRoute` answers reaches the rung
    // without serving a measurement, and the level it reports is the
    // straight-line floor's — because that is the level the user is
    // actually looking at.
    let servedAnything = false;

    const stillPending: typeof pending = [];

    for (const pair of pending) {
      const key = pairKey(pair.originIndex, pair.destinationIndex);
      const outcome: MatrixOutcome | undefined = matrix.outcomes.get(key);

      if (outcome && outcome.kind === 'measured') {
        servedAnything = true;
        results.set(key, {
          measurement: applyConfidenceGuard(request.mode, outcome.measurement),
          levelReached: adapter.rung,
          reason: 'served',
          source: adapter.name,
          coverage: { resolved: matrix.resolved, total: matrix.total },
        });
        continue;
      }

      if (outcome && outcome.kind === 'no_route') {
        // The provider says no road connects these points. That is a fact
        // about the world, not a failure to measure — and it must not
        // become an instant journey or a zero cost. It is recorded as an
        // unknown measurement so the participant is reported in
        // `coverage.missing` rather than scored as `u = 0` (TC-5).
        results.set(key, {
          measurement: unknownMeasurement(),
          levelReached: adapter.rung,
          reason: 'no_route',
          source: adapter.name,
          coverage: { resolved: matrix.resolved, total: matrix.total },
        });
        continue;
      }

      stillPending.push(pair);
    }

    if (servedAnything) {
      levelReached = adapter.rung;
      reason = 'served';
    } else if (reason !== 'served') {
      // The provider answered, but with absences only. The rung was
      // reached; it did not serve a measurement. The level stays where it
      // was, and the reason says what happened.
      reason = 'no_route';
    }

    pending = stillPending;
  }

  // Everything still pending falls through to the straight-line floor.
  for (const pair of pending) {
    const key = pairKey(pair.originIndex, pair.destinationIndex);
    const origin = request.origins[pair.originIndex];
    const destination = request.destinations[pair.destinationIndex];
    // ★ EVERY PAIR GETS AN ENTRY, EVEN ONE THAT CANNOT BE RESOLVED.
    //
    // A pair whose origin or destination is missing is still a pair the
    // caller asked about, and dropping it silently would make the
    // coverage understate what was resolved — so the caller could not
    // tell the difference between "not measured" and "never asked".
    if (!origin || !destination) {
      results.set(key, {
        measurement: unknownMeasurement(),
        levelReached: 5,
        reason: 'provider_unavailable',
        source: 'none',
        coverage: { resolved: 0, total },
      });
      continue;
    }

    const measurement = estimateStraightLine({
      from: origin,
      to: destination,
      mode: request.mode,
      now: new Date(),
    });

    results.set(key, {
      measurement: applyConfidenceGuard(request.mode, measurement),
      levelReached: 5,
      reason: 'provider_unavailable',
      source: 'straight_line',
      coverage: { resolved: 0, total },
    });
  }

  // ★ THE COVERAGE IS THE SAME FOR EVERY PAIR.
  //
  // It describes the matrix as a whole, so a consumer reading it from any
  // pair gets the same numbers. Reporting the running count instead would
  // make pair 1 say "1 of 4 resolved" and pair 4 say "4 of 4" for the same
  // matrix, which is two different stories about one resolution.
  const resolvedCount = results.size;
  for (const [key, outcome] of results) {
    results.set(key, { ...outcome, coverage: { resolved: resolvedCount, total } });
  }

  return {
    results,
    coverage: { resolved: resolvedCount, total },
    levelReached: levelReached === 0 ? 5 : levelReached,
    reason,
  };
}

/**
 * The unknown measurement.
 *
 * Used when a provider says there is no route. It is `unknown`, not a
 * number: a missing measurement must never become an instant trip.
 */
function unknownMeasurement(): TravelMeasurement {
  return {
    minutes: 0,
    minutesRange: null,
    distanceMeters: 0,
    transfers: null,
    walkMinutes: null,
    waitMinutes: null,
    costIrr: null,
    parkingCostIrr: null,
    confidence: 'unknown',
    source: 'none',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * ★ THE TRANSIT GUARD.
 *
 * Applied to EVERY measurement the ladder produces, whatever adapter
 * produced it. A transit request is `low` unconditionally — a future
 * adapter cannot accidentally break that, because the guard is here rather
 * than in the adapter (PRD-05 TC-18).
 */
export function applyConfidenceGuard(
  mode: TransportMode,
  measurement: TravelMeasurement,
): TravelMeasurement {
  const confidence = mayKeepConfidence(mode, measurement.confidence);
  if (confidence === measurement.confidence) return measurement;

  return { ...measurement, confidence };
}

/**
 * The origins and destinations a matrix request covers, as flat pairs.
 *
 * A convenience for the caller, which needs the pair list to build the
 * engine's `measurements` map.
 */
export function matrixPairs(request: MatrixRequest): Array<{
  originIndex: number;
  destinationIndex: number;
  origin: Coordinate;
  destination: Coordinate;
}> {
  const pairs: Array<{
    originIndex: number;
    destinationIndex: number;
    origin: Coordinate;
    destination: Coordinate;
  }> = [];

  request.origins.forEach((origin, originIndex) => {
    request.destinations.forEach((destination, destinationIndex) => {
      pairs.push({ originIndex, destinationIndex, origin, destination });
    });
  });

  return pairs;
}
