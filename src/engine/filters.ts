/**
 * The hard filters.
 *
 * A hard filter removes a venue outright, and every removal is RECORDED with
 * a reason so the client can render "what was excluded and why"
 * (PRD-05 §5.2).
 *
 * **Three rules hold across every filter here:**
 *
 * 1. **Only `confirmed_no` excludes on accessibility.** `unknown` is kept
 *    and surfaced (PRD-05 §3.3 rule 2).
 * 2. **Never filter on `low` confidence travel.** A straight-line estimate
 *    over budget is not proof the real trip is (PRD-05 §5.2).
 * 3. **Absent hours ≠ closed.** `openingHours === null` applies no closure
 *    filter at all (PRD-05 §8).
 */

import { ENGINE_CONFIG } from './config';
import { dMaxFor, walkingMinutes } from './utility';
import type { ExclusionReason, ParticipantContext, TravelMeasurement, VenueContext } from './types';

/**
 * Whether the venue's accessibility rules the participant out.
 *
 * ONLY a `confirmed_no` on an attribute the participant actually needs
 * excludes. `unknown` never does.
 */
export function accessibilityBlocks(
  venue: VenueContext,
  member: ParticipantContext,
): boolean {
  const attributes = venue.accessibility;
  if (!attributes) return false;

  if (member.accessibility.needsStepFree && attributes.stepFreeEntrance === 'confirmed_no') {
    return true;
  }

  if (
    member.accessibility.limitedWalking &&
    attributes.limitedWalkingSuitable === 'confirmed_no'
  ) {
    return true;
  }

  return false;
}

/**
 * Whether the travel time rules the participant out.
 *
 * The confidence guard is the whole point: a low-confidence estimate that
 * exceeds the budget is NOT proof. Such a venue is kept, and the member
 * decides.
 */
export function travelBudgetBlocks(
  measurement: TravelMeasurement | null,
  member: ParticipantContext,
): boolean {
  if (!measurement) return false;
  if (measurement.confidence !== 'high' && measurement.confidence !== 'medium') {
    return false;
  }
  return measurement.minutes > dMaxFor(member);
}

/**
 * Whether the walking portion rules the participant out.
 *
 * A walk limit is a declared physical limit, so unlike the travel budget it
 * applies regardless of confidence — but only when the limit is declared.
 */
export function walkLimitBlocks(
  measurement: TravelMeasurement | null,
  member: ParticipantContext,
): boolean {
  if (!measurement) return false;
  const limit = member.accessibility.maxWalkMinutes;
  if (limit === null) return false;
  return walkingMinutes(measurement, member) > limit;
}

/**
 * Whether walking alone at night rules the participant out.
 *
 * A declared constraint, treated as a constraint (PRD-05 §4.2).
 */
export function walkAloneAtNightBlocks(
  measurement: TravelMeasurement | null,
  member: ParticipantContext,
  eventHour: number,
): boolean {
  if (!measurement) return false;
  const cutoff = member.accessibility.noWalkAloneAfter;
  if (cutoff === null) return false;

  const walk = measurement.walkMinutes ?? 0;
  if (walk <= 0) return false;

  // The walk happens at the event hour, so the cutoff is compared against it.
  const hour = ((eventHour % 24) + 24) % 24;
  return hour >= cutoff;
}

/**
 * Whether the venue is closed at the event hour.
 *
 * `openingHours === null` means the hours are unknown, and unknown is not
 * closed (PRD-05 §8, TC-7).
 */
export function closedBlocks(venue: VenueContext, eventHour: number): boolean {
  const hours = venue.openingHours;
  if (!hours) return false;

  const hour = ((eventHour % 24) + 24) % 24;
  const { open, close } = hours;

  // Closing time later than opening time: a normal day.
  if (open < close) return hour < open || hour >= close;

  // Closing time at or before opening time: the venue passes midnight.
  if (open === close) return false;

  return hour < open && hour >= close;
}

/** The outcome of applying every filter to one venue. */
export interface FilterOutcome {
  /** The venues that survive, in the order they were given. */
  kept: VenueContext[];
  /** Every exclusion, each with a reason and the affected participant. */
  excluded: Array<{ venue: VenueContext; reason: ExclusionReason; participantId: string | null }>;
}

/** The measurement lookup for one participant and venue. */
export type MeasurementLookup = (
  participantId: string,
  venueId: string,
) => TravelMeasurement | null;

/**
 * Applies every hard filter to every venue.
 *
 * A venue survives if it survives for EVERY participant. The first
 * participant whose constraint rules it out produces the recorded
 * exclusion, so the reason names a real person.
 */
export function applyHardFilters(
  venues: VenueContext[],
  participants: ParticipantContext[],
  lookup: MeasurementLookup,
  eventHour: number,
  dealbreakers: Record<string, string[]> = {},
): FilterOutcome {
  const kept: VenueContext[] = [];
  const excluded: FilterOutcome['excluded'] = [];

  for (const venue of venues) {
    let exclusion: FilterOutcome['excluded'][number] | null = null;

    for (const member of participants) {
      // A dealbreaker is a hard `no` from a participant (PRD-02 FR-2.17).
      if (dealbreakers[member.id]?.includes(venue.id)) {
        exclusion = { venue, reason: 'dealbreaker', participantId: member.id };
        break;
      }

      if (accessibilityBlocks(venue, member)) {
        exclusion = { venue, reason: 'accessibility', participantId: member.id };
        break;
      }

      const measurement = lookup(member.id, venue.id);

      if (travelBudgetBlocks(measurement, member)) {
        exclusion = { venue, reason: 'travel_budget', participantId: member.id };
        break;
      }

      if (walkLimitBlocks(measurement, member)) {
        exclusion = { venue, reason: 'walk_limit', participantId: member.id };
        break;
      }

      if (walkAloneAtNightBlocks(measurement, member, eventHour)) {
        exclusion = { venue, reason: 'walk_alone_at_night', participantId: member.id };
        break;
      }
    }

    // The closure check is per venue, not per participant.
    if (!exclusion && closedBlocks(venue, eventHour)) {
      exclusion = { venue, reason: 'closed', participantId: null };
    }

    if (exclusion) {
      excluded.push(exclusion);
    } else {
      kept.push(venue);
    }
  }

  return { kept, excluded };
}

/**
 * The suggestions to offer when nothing survives.
 *
 * They are derived from what actually blocked the venues, so the advice
 * matches the cause rather than listing everything (PRD-05 §5.3).
 */
export function suggestionsFor(excluded: FilterOutcome['excluded']): Array<
  'relax_max_travel' | 'relax_accessibility' | 'add_venue' | 'remove_dealbreaker'
> {
  const reasons = new Set(excluded.map((entry) => entry.reason));
  const suggestions: Array<
    'relax_max_travel' | 'relax_accessibility' | 'add_venue' | 'remove_dealbreaker'
  > = [];

  if (reasons.has('travel_budget') || reasons.has('walk_limit')) {
    suggestions.push('relax_max_travel');
  }
  if (reasons.has('accessibility')) {
    suggestions.push('relax_accessibility');
  }
  if (reasons.has('dealbreaker')) {
    suggestions.push('remove_dealbreaker');
  }
  if (reasons.has('closed') || reasons.has('walk_alone_at_night')) {
    suggestions.push('add_venue');
  }

  // The suggestion list is never empty: there is always something to try.
  if (suggestions.length === 0) {
    suggestions.push('add_venue');
  }

  return suggestions;
}

/** The pre-filter radius in km, re-exported so the caller reads it from one place. */
export const PRE_FILTER_MAX_KM = ENGINE_CONFIG.PRE_FILTER_MAX_KM;
