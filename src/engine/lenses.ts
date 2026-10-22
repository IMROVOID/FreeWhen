/**
 * The four lenses.
 *
 * Arrow's impossibility theorem says no aggregation rule is universally
 * correct for three or more alternatives, so the product ships NAMED lenses
 * rather than "the fairest" one. Each lens is a different, defensible
 * answer, and the choice is explicit and reversible (PRD-05 §6.2).
 *
 *   Balanced  — argmax lexicographic (floor, mean). The default.
 *   Fastest   — argmin totalTime.
 *   Fairest   — argmin gap, FLOOR-GUARDED at 60% of the best floor.
 *   Cheapest  — argmin totalCost.
 *
 * **The aggregates are computed in full precision and rounded ONCE, at the
 * end** (PRD-05 §14). The utilities are repeating decimals; summing
 * pre-rounded values gives a mean of 50.55 where the exact sum gives 50.56
 * (TC-16, TC-17).
 */

import { ENGINE_CONFIG } from './config';
import type { Aggregate, Confidence, Lens } from './types';

/** Rounds to two decimal places, at the very end of a computation. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The confidence ordering, worst-first.
 *
 * The aggregate confidence is the MINIMUM across the participants — the
 * worst link governs (PRD-05 §8.2).
 */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** The weaker of two confidences. */
export function weakestConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/** One participant's contribution to a venue's aggregate. */
export interface MemberUtility {
  participantId: string;
  utility: number;
  minutes: number;
  /** `null` = unknown. NEVER 0. */
  costIrr: number | null;
  confidence: Confidence;
}

/**
 * Aggregates one venue's measurements.
 *
 * `totalCost` SKIPS null costs rather than treating them as zero. A venue
 * whose cost is unknown must not appear cheapest by omission — the count of
 * known costs travels with the aggregate so the caller can tell.
 */
export function aggregateVenue(
  venueId: string,
  members: MemberUtility[],
): Aggregate {
  const utilities = members.map((member) => member.utility);

  if (utilities.length === 0) {
    return {
      venueId,
      floor: 0,
      mean: 0,
      gap: 0,
      totalTime: 0,
      totalCost: null,
      costComplete: false,
      worstMinutes: 0,
      minutesGap: 0,
      confidence: 'unknown',
      utilities: [],
    };
  }

  const floor = Math.min(...utilities);
  const mean = utilities.reduce((total, value) => total + value, 0) / utilities.length;
  const gap = Math.max(...utilities) - floor;
  const totalTime = members.reduce((total, member) => total + member.minutes, 0);

  // The travel times, not the utilities. The reason line names minutes —
  // "nobody travels more than 18 minutes" — because minutes are the thing
  // a participant can picture.
  const times = members.map((member) => member.minutes);
  const worstMinutes = Math.max(...times);
  const minutesGap = worstMinutes - Math.min(...times);

  const knownCosts = members
    .map((member) => member.costIrr)
    .filter((cost): cost is number => cost !== null);
  const totalCost = knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null;
  const costComplete = knownCosts.length === members.length;

  const confidence = members.reduce<Confidence>(
    (weakest, member) => weakestConfidence(weakest, member.confidence),
    'high',
  );

  return {
    venueId,
    floor,
    mean,
    gap,
    totalTime,
    totalCost,
    costComplete,
    worstMinutes,
    minutesGap,
    confidence,
    utilities,
  };
}

/**
 * The Fairest lens's floor guard.
 *
 * Rejects any candidate whose floor is below 60% of the best available
 * floor. Without the guard, a venue where everyone scores 20 has a gap of
 * zero and wins outright — a uniformly miserable venue (PRD-05 §6.4).
 */
export function fairestSurvivors(list: Aggregate[]): Aggregate[] {
  if (list.length === 0) return [];

  const bestFloor = Math.max(...list.map((aggregate) => aggregate.floor));
  const gate = bestFloor * ENGINE_CONFIG.FAIREST_FLOOR_RATIO;
  const survivors = list.filter((aggregate) => aggregate.floor >= gate);

  return survivors.length > 0 ? survivors : list;
}

/**
 * The comparison key for a lens.
 *
 * Returns a comparator. A NEGATIVE result means `a` comes first.
 *
 * **Every lens is followed by the same tie-break chain** (PRD-05 §7), so
 * two distinct venues never tie and the result never depends on the order
 * the venues arrived in.
 */
export function comparatorFor(lens: Lens): (a: Aggregate, b: Aggregate) => number {
  switch (lens) {
    case 'balanced':
      // LEXICOGRAPHIC, not an average. The floor outranks the mean entirely.
      return (a, b) => {
        if (b.floor !== a.floor) return b.floor - a.floor;
        if (b.mean !== a.mean) return b.mean - a.mean;
        return tieBreak(a, b);
      };

    case 'fastest':
      return (a, b) => {
        if (a.totalTime !== b.totalTime) return a.totalTime - b.totalTime;
        return tieBreak(a, b);
      };

    case 'fairest':
      return (a, b) => {
        if (a.gap !== b.gap) return a.gap - b.gap;
        return tieBreak(a, b);
      };

    case 'cheapest':
      return (a, b) => {
        // A venue whose cost is only PARTIALLY known must never beat a venue
        // whose cost is fully known. Summing the known costs and comparing
        // the totals would let a venue win by omission — the omitted cost
        // is free money that nobody counted (PRD-05 §8, §4.2).
        //
        // So the comparison is two-stage: the complete costs first, by
        // total; then the incomplete ones, by the tie-break chain. A venue
        // with no known cost at all sorts after every venue with one.
        if (a.costComplete !== b.costComplete) {
          return a.costComplete ? -1 : 1;
        }
        if (a.totalCost !== null && b.totalCost !== null && a.totalCost !== b.totalCost) {
          return a.totalCost - b.totalCost;
        }
        return tieBreak(a, b);
      };
  }
}

/**
 * The tie-break chain (PRD-05 §7).
 *
 * 1. floor descending
 * 2. mean descending
 * 3. total time ascending
 * 4. venue id ascending
 *
 * **Step 4 uses the venue id, never the array position.** Array position
 * would break order-independence (TC-12).
 */
export function tieBreak(a: Aggregate, b: Aggregate): number {
  if (b.floor !== a.floor) return b.floor - a.floor;
  if (b.mean !== a.mean) return b.mean - a.mean;
  if (a.totalTime !== b.totalTime) return a.totalTime - b.totalTime;
  return a.venueId.localeCompare(b.venueId);
}

/**
 * Ranks the aggregates under a lens.
 *
 * The Fairest lens filters to its floor-guarded survivors first, then
 * ranks them. Every other lens ranks the whole list.
 */
export function rankAggregates(aggregates: Aggregate[], lens: Lens): Aggregate[] {
  const pool = lens === 'fairest' ? fairestSurvivors(aggregates) : aggregates;
  return [...pool].sort(comparatorFor(lens));
}
