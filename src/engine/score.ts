/**
 * The engine's single entrypoint.
 *
 * `scoreVenues` is a PURE function (PRD-05 §2):
 *
 * - Deterministic: the same input always gives the same output.
 * - Order-independent: permuting the participants or the venues does not
 *   change the result.
 * - No I/O: the travel data arrives already resolved.
 * - No wall-clock read, no randomness, no logging.
 *
 * The order of operations is fixed (PRD-05 §5.1):
 *
 *   1. straight-line pre-filter  — candidate reduction, cheap and offline
 *   2. hard filters               — dealbreakers, constraints, closure
 *   3. utility computation
 *   4. aggregation by lens
 *   5. ranking and tie-breaks
 *
 * Filters run BEFORE aggregation, so a filtered venue never appears in a
 * ranking that pretends to have considered it.
 */

import { computeCoverage } from './coverage';
import { ENGINE_CONFIG } from './config';
import { applyHardFilters, suggestionsFor } from './filters';
import { buildConflictReason, buildExclusionReason, buildReason } from './explain';
import { aggregateVenue, rankAggregates, round2 } from './lenses';
import { haversineKm } from './transit-proxy';
import { utilityOf } from './utility';
import type {
  Aggregate,
  Conflict,
  EngineOptions,
  Exclusion,
  Lens,
  NoVenueMeetsThreshold,
  ParticipantContext,
  ParticipantResult,
  RankedVenue,
  ScoreResult,
  ScoreSuccess,
  TravelMeasurement,
  VenueContext,
} from './types';

/** The default event hour, when the caller does not supply one. */
const DEFAULT_EVENT_HOUR = 19;

/**
 * Ranks the venues for a group under a lens.
 *
 * Returns the ranked venues, or the `NoVenueMeetsThreshold` state when no
 * venue survives the filters. **Never `[]`, `null`, or a throw** — an empty
 * candidate set is a documented failure mode, and returning nothing leaves
 * the user with no way forward (PRD-05 §5.3, TC-9).
 */
export function scoreVenues(
  participants: ParticipantContext[],
  venues: VenueContext[],
  lens: Lens,
  options: EngineOptions = {},
): ScoreResult {
  const eventHour = options.eventHour ?? DEFAULT_EVENT_HOUR;
  const measurements = options.measurements ?? {};
  const dealbreakers = options.dealbreakers ?? {};

  // The participants are put in a CANONICAL ORDER — by id — before
  // anything is computed.
  //
  // This is what makes the result order-independent all the way down. The
  // ranking itself is already order-independent (the tie-break chain ends
  // on the venue id), but the per-venue breakdown, the coverage's missing
  // list and the excluded array would otherwise be in whatever order the
  // caller happened to pass. Sorting once, here, means the whole payload
  // is a function of the SET of inputs, not of their order
  // (PRD-05 §14, TC-12).
  const ordered = [...participants].sort((a, b) => a.id.localeCompare(b.id));
  const orderedVenues = [...venues].sort((a, b) => a.id.localeCompare(b.id));

  const lookup = (participantId: string, venueId: string): TravelMeasurement | null =>
    measurements[participantId]?.[venueId] ?? null;

  const coverage = computeCoverage(ordered, measurements);

  // 1. The straight-line pre-filter. It is a CANDIDATE REDUCTION only: the
  //    distance it computes is never displayed as a travel time.
  const candidates = preFilter(orderedVenues, ordered);

  // 2. The hard filters.
  const { kept, excluded } = applyHardFilters(
    candidates,
    ordered,
    lookup,
    eventHour,
    dealbreakers,
  );

  // The exclusions are sorted by venue id, and each names the
  // lowest-id blocking participant, so the array does not depend on the
  // order the participants arrived in (PRD-05 §14, order independence).
  const exclusions: Exclusion[] = excluded
    .map((entry) => ({
      venueId: entry.venue.id,
      reason: entry.reason,
      participantId: entry.participantId,
      detail: buildExclusionReason(
        entry.reason,
        entry.participantId === null
          ? null
          : ordered.find((member) => member.id === entry.participantId)?.name ?? null,
      ),
    }))
    .sort((a, b) => a.venueId.localeCompare(b.venueId));

  // Nothing survives → the explicit state, never an empty array.
  if (kept.length === 0) {
    const noViable: NoVenueMeetsThreshold = {
      state: 'NoVenueMeetsThreshold',
      excluded: exclusions,
      suggestions: suggestionsFor(excluded),
      coverage,
    };
    return noViable;
  }
  // 3 and 4. The utility per participant, then the aggregate per venue.
  const aggregates: Aggregate[] = [];
  const breakdowns = new Map<string, ParticipantResult[]>();
  const conflicts = new Map<string, Conflict[]>();

  for (const venue of kept) {
    const participantsForVenue: ParticipantResult[] = [];
    const memberUtilities: Array<{
      participantId: string;
      utility: number;
      minutes: number;
      costIrr: number | null;
      confidence: TravelMeasurement['confidence'];
    }> = [];

    for (const member of ordered) {
      const measurement = lookup(member.id, venue.id);

      // No measurement → the participant is NOT measured and NOT scored as
      // zero. They are reported in `coverage.missing` (PRD-05 §8).
      if (!measurement) continue;

      const utility = utilityOf(measurement, member, eventHour);

      memberUtilities.push({
        participantId: member.id,
        utility,
        minutes: measurement.minutes,
        costIrr: measurement.costIrr,
        confidence: measurement.confidence,
      });

      participantsForVenue.push({
        id: member.id,
        name: member.name,
        mode: member.modes[0] ?? 'walk',
        minutes: measurement.minutes,
        minutesRange: measurement.minutesRange,
        costIrr: measurement.costIrr,
        confidence: measurement.confidence,
        utility,
        unmet: unmetReason(venue, member, measurement),
      });

      // An `unknown` accessibility attribute is SURFACED, never excluded and
      // never scored (PRD-05 §3.3 rule 1 and 2).
      if (needsStepFree(member) && venue.accessibility.stepFreeEntrance === 'unknown') {
        const conflict: Conflict = {
          type: 'accessibility_unknown',
          venueId: venue.id,
          participantId: member.id,
          detail: buildConflictReason('accessibility_unknown', member.name),
        };
        conflicts.set(venue.id, [...(conflicts.get(venue.id) ?? []), conflict]);
      }
    }

    // A venue nobody could be measured for is not ranked. It is neither a
    // good venue nor a bad one.
    if (memberUtilities.length === 0) continue;

    aggregates.push(aggregateVenue(venue.id, memberUtilities));
    breakdowns.set(venue.id, participantsForVenue);
  }

  if (aggregates.length === 0) {
    const noViable: NoVenueMeetsThreshold = {
      state: 'NoVenueMeetsThreshold',
      excluded: exclusions,
      suggestions: suggestionsFor(excluded),
      coverage,
    };
    return noViable;
  }
  // 5. The ranking and the tie-breaks.
  const ranked = rankAggregates(aggregates, lens);
  const venuesById = new Map(kept.map((venue) => [venue.id, venue]));

  const rankedVenues: RankedVenue[] = ranked.map((aggregate, index) => {
    const venue = venuesById.get(aggregate.venueId);
    const participantsForVenue = breakdowns.get(aggregate.venueId) ?? [];
    const venueConflicts = conflicts.get(aggregate.venueId) ?? [];

    // The headline number is the WORST-OFF member's time — the number the
    // decision hinges on (PRD-05 §11.3).
    const worst = participantsForVenue.reduce<ParticipantResult | null>(
      (worstSoFar, current) =>
        worstSoFar === null || current.minutes > worstSoFar.minutes ? current : worstSoFar,
      null,
    );

    const minutes: number | [number, number] = worst
      ? worst.minutesRange ?? worst.minutes
      : aggregate.totalTime;

    const lowConfidence =
      aggregate.confidence === 'low' || aggregate.confidence === 'unknown';

    return {
      venueId: aggregate.venueId,
      name: venue?.name ?? aggregate.venueId,
      rank: index + 1,
      floor: round2(aggregate.floor),
      mean: round2(aggregate.mean),
      gap: round2(aggregate.gap),
      minutes,
      totalCost: aggregate.totalCost,
      confidence: aggregate.confidence,
      reason: buildReason(lens, aggregate, {
        coverageMissing: coverage.missing.length,
        lowConfidence,
      }),
      participants: participantsForVenue,
      conflicts: venueConflicts,
    };
  });

  // The success result IS the ranked array, and it also carries the
  // envelope. Both are needed: `result[0]` is the top venue, and
  // `result.coverage` is what stops a ranking over 6 of 8 people from being
  // presented as 8 (PRD-05 §20.11).
  const success = rankedVenues as ScoreSuccess;
  success.state = 'ok';
  success.lens = lens;
  success.coverage = coverage;
  success.excluded = exclusions;
  success.conflicts = [...conflicts.values()].flat();

  return success;
}

/**
 * The straight-line pre-filter.
 *
 * Drops a venue whose MINIMUM member distance exceeds the configured
 * radius. The "minimum" is deliberate: a venue is only out of reach if it is
 * far from EVERYONE.
 *
 * The distance computed here is never displayed. It is a candidate
 * reduction (PRD-05 §12.1).
 */
export function preFilter(
  venues: VenueContext[],
  participants: ParticipantContext[],
): VenueContext[] {
  const located = participants.filter((participant) => participant.startPoint !== null);

  // With no located participant there is no basis for a distance cut, so
  // nothing is dropped. Absence of a location is not a rejection.
  if (located.length === 0) return [...venues];

  const maxKm = ENGINE_CONFIG.PRE_FILTER_MAX_KM;

  const withinRadius = venues.filter((venue) => {
    const target = { lat: venue.lat, lng: venue.lng };
    const nearest = Math.min(
      ...located.map(
        (participant) => haversineKm(participant.startPoint!, target),
      ),
    );
    return nearest <= maxKm;
  });

  // The candidate cap bounds the matrix (PRD-05 §12.1). It is applied
  // AFTER the distance cut, so the cap keeps the nearest candidates.
  if (withinRadius.length <= ENGINE_CONFIG.CANDIDATE_CAP) return withinRadius;

  return [...withinRadius]
    .sort((a, b) => nearestDistance(a, located) - nearestDistance(b, located))
    .slice(0, ENGINE_CONFIG.CANDIDATE_CAP);
}

/** The distance from a venue to the nearest located participant, in km. */
function nearestDistance(venue: VenueContext, participants: ParticipantContext[]): number {
  const target = { lat: venue.lat, lng: venue.lng };
  return Math.min(
    ...participants.map((participant) => haversineKm(participant.startPoint!, target)),
  );
}

/** Whether a participant needs a step-free entrance. */
function needsStepFree(member: ParticipantContext): boolean {
  return member.accessibility.needsStepFree;
}

/**
 * The constraint a participant did not meet, as a template.
 *
 * `null` means the participant met everything that could be checked. A
 * `low`-confidence travel time that exceeds the budget is NOT an unmet
 * constraint — the estimate is not proof (PRD-05 §5.2).
 */
function unmetReason(
  venue: VenueContext,
  member: ParticipantContext,
  measurement: TravelMeasurement,
): ParticipantResult['unmet'] {
  if (
    member.accessibility.needsStepFree &&
    venue.accessibility.stepFreeEntrance === 'confirmed_no'
  ) {
    return buildExclusionReason('accessibility', member.name);
  }

  if (
    member.accessibility.needsStepFree &&
    venue.accessibility.stepFreeEntrance === 'unknown'
  ) {
    return buildConflictReason('accessibility_unknown', member.name);
  }

  const limit = member.maxTravelMinutes ?? ENGINE_CONFIG.D_MAX_DEFAULT;
  const confident = measurement.confidence === 'high' || measurement.confidence === 'medium';
  if (confident && measurement.minutes > limit) {
    return buildExclusionReason('travel_budget', member.name);
  }

  return null;
}
