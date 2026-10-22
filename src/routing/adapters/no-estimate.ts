/**
 * The no-estimate rung — rung 6, the last one.
 *
 * ★ THIS RUNG EXISTS SO THAT "WE HAVE NO NUMBER" IS A STATED STATE.
 *
 * Without it, "no measurement" would have to become a `0`, and a `0` reads
 * as an instant journey — or, worse, as a free one. A missing measurement
 * must never become an instant trip, and it must never become a `0` cost
 * either (PRD-09 §13.3).
 *
 * A participant at this rung is reported in `coverage.missing`, NOT scored
 * as `u = 0` (TC-5). The engine owns that rule; this rung's job is to
 * produce a measurement that says "unknown" rather than a number that lies.
 */

import type { BatchTravelAdapter, TravelRequest } from '../provider';
import type { TravelMeasurement } from '../types';

/** Builds the unknown measurement. */
function unknownMeasurement(fetchedAt: string): TravelMeasurement {
  return {
    // A zero here would be a lie in the most literal sense: it would say the
    // journey takes no time.
    minutes: 0,
    // The range is null rather than `[0, 0]`, because a range of zero is
    // still a claim that the answer is zero.
    minutesRange: null,
    distanceMeters: 0,
    transfers: null,
    walkMinutes: null,
    waitMinutes: null,
    // Unknown is unknown. NEVER 0 — a zero cost makes a venue falsely
    // "cheapest" (PRD-09 §13.3).
    costIrr: null,
    parkingCostIrr: null,
    confidence: 'unknown',
    source: 'none',
    fetchedAt,
  };
}

/**
 * The no-estimate adapter.
 *
 * It always answers. That is what makes it the last rung: the ladder
 * cannot run out of rungs, so it cannot throw.
 */
export const noEstimateAdapter = {
  name: 'none',
  rung: 6,

  async measure(_request: TravelRequest): Promise<TravelMeasurement> {
    return unknownMeasurement(new Date().toISOString());
  },
} satisfies BatchTravelAdapter;
