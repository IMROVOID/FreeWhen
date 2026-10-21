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
 * Phase 1 ships the last two rungs only: the straight-line adapter and the
 * "no estimate" fallback. Phase 4 adds the provider rungs.
 */

import { estimateStraightLine } from './adapters/straight-line';
import type { Coordinate, TransportMode, TravelMeasurement } from './types';

export type { Coordinate, Confidence, TransportMode, TravelMeasurement } from './types';

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
      fetchedAt: now.toISOString(),
    };
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
 * The ladder, in order. The first rung that returns a measurement wins.
 * Phase 1 ships the offline rungs; Phase 4 prepends the provider rungs.
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
