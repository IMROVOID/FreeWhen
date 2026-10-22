/**
 * Per-person utility.
 *
 * `u(m, i) = 100 · max(0, 1 − combinedMinutes(m, i) / D_max(m))`
 *
 * The penalties are ADDED MINUTES applied BEFORE the transform, so they
 * degrade smoothly instead of creating cliffs (PRD-05 §4.2). Applying them
 * to the score directly would make a small change in travel time produce a
 * jump in utility.
 *
 * **Two things add NO penalty, deliberately:**
 *
 * - `unknown` accessibility. Penalising unknown would push the ranking
 *   toward venues that happen to have data — a selection bias, not a
 *   fairness improvement (PRD-05 §4.2).
 * - `confidence`. Confidence is metadata that travels with the result;
 *   adjusting the score for it makes the outcome unexplainable
 *   (PRD-05 §8.2, §20.8).
 */

import { ENGINE_CONFIG } from './config';
import type { ParticipantContext, TravelMeasurement } from './types';

/**
 * The base utility, clamped to `[0, 100]`.
 *
 * When `combinedMin` exceeds `dMax` the utility is `0` — never negative.
 */
export function computeUtility(combinedMin: number, dMax: number): number {
  if (dMax <= 0) return 0;
  return 100 * Math.max(0, 1 - combinedMin / dMax);
}

/** The participant's travel budget, falling back to the configured default. */
export function dMaxFor(member: ParticipantContext): number {
  return member.maxTravelMinutes ?? ENGINE_CONFIG.D_MAX_DEFAULT;
}

/**
 * Whether an event hour falls in the night window.
 *
 * The window is half-open and crosses midnight, so 21:00 and 05:59 are
 * night while 06:00 and 20:59 are not.
 */
export function isNightHour(eventHour: number): boolean {
  const [start, end] = ENGINE_CONFIG.NIGHT_HOURS;
  const hour = ((eventHour % 24) + 24) % 24;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * The minutes added by the walking portion of a journey.
 *
 * For a participant with `limitedWalking`, the walking minutes are scaled
 * FIRST, and the long-walk penalty is then applied to the scaled value
 * (PRD-05 §4.2). The order matters: it is the walk that is hard, and the
 * effort is what scales.
 */
export function walkingMinutes(measurement: TravelMeasurement, member: ParticipantContext): number {
  const raw = measurement.walkMinutes ?? 0;
  if (raw <= 0) return 0;
  if (!member.accessibility.limitedWalking) return raw;
  return raw * ENGINE_CONFIG.LIMITED_WALK_FACTOR;
}

/**
 * The long-walk penalty, in minutes.
 *
 * **The penalty applies only to a participant with `limitedWalking`.**
 *
 * This is the one place where PRD-05 §4.2 needs reading rather than
 * transcribing, and the normative §12A table settles it. Darya walks 35
 * minutes — well over the 10-minute threshold — and the table gives her V1
 * utility as 22.22, which is `100·(1 − 35/45)`. If the long-walk penalty
 * applied to every walker it would add `0.5 × (35 − 10) = 12.5` minutes to
 * her journey, push it past her 45-minute budget, and drive her utility to
 * `0` — contradicting the table, and with it V1's published floor of 22.22
 * and Balanced's choice of V2 (PRD-05 §12A, TC-3, TC-16).
 *
 * So the long-walk row of the penalty table is the SECOND half of the
 * limited-walking row — "walking minutes × 1.75, then the long-walk
 * penalty" — not a rule of its own. A participant who can walk without
 * difficulty is not penalised for a long walk; a participant whose walking
 * is limited is.
 */
export function longWalkPenalty(
  measurement: TravelMeasurement,
  member: ParticipantContext,
): number {
  if (!member.accessibility.limitedWalking) return 0;

  const walk = walkingMinutes(measurement, member);
  if (walk <= ENGINE_CONFIG.LONG_WALK_THRESHOLD_MIN) return 0;

  return (walk - ENGINE_CONFIG.LONG_WALK_THRESHOLD_MIN) * ENGINE_CONFIG.LONG_WALK_FACTOR;
}

/**
 * The travel time plus every penalty, in minutes.
 *
 * This is the `d` that `computeUtility` consumes.
 *
 * **The walking portion is NOT added to the travel time.** A measurement's
 * `minutes` already INCLUDES any walking; the walk is a component of the
 * journey, not an extra journey. It is read only to work out the
 * walk-related penalties.
 */
export function combinedMinutes(
  measurement: TravelMeasurement,
  member: ParticipantContext,
  eventHour: number,
): number {
  let minutes = measurement.minutes;

  // Transfers: every transfer BEYOND the first.
  const transfers = measurement.transfers ?? 0;
  if (transfers > 1) {
    minutes += (transfers - 1) * ENGINE_CONFIG.TRANSFER_PENALTY_MIN;
  }

  // The long walk, for a participant whose walking is limited.
  minutes += longWalkPenalty(measurement, member);

  // Night travel: a declared preference, never a safety claim.
  if (member.accessibility.avoidsNightTravel && isNightHour(eventHour)) {
    minutes += ENGINE_CONFIG.NIGHT_PENALTY_MIN;
  }

  return minutes;
}

/**
 * The utility of one participant for one venue.
 *
 * Full precision throughout: the utility is NOT rounded here. The utilities
 * are repeating decimals, and rounding them before the aggregate produces
 * a mean of 50.55 instead of 50.56 (PRD-05 TC-16, TC-17).
 */
export function utilityOf(
  measurement: TravelMeasurement,
  member: ParticipantContext,
  eventHour: number,
): number {
  return computeUtility(combinedMinutes(measurement, member, eventHour), dMaxFor(member));
}
