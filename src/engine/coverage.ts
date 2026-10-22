/**
 * Coverage — how much of the group the ranking actually covers.
 *
 * The central rule of this engine is **absence ≠ zero** (PRD-05 §8).
 * A participant with no location, or a participant whose routing failed, is
 * NOT scored as `u = 0`:
 *
 * - Scoring them zero would make every venue look terrible, and would
 *   punish the person who chose privacy.
 * - Excluding them silently would present a ranking over 6 of 8 people as
 *   if it covered 8.
 *
 * So they are excluded from the aggregation AND reported. The client is
 * required to state the gap.
 */

import type { Coverage, ParticipantContext, TravelMeasurement } from './types';

/**
 * The spread, in km, beyond which a group is treated as spanning cities.
 *
 * Two people 400 km apart are not choosing a Tehran venue — they are
 * choosing something else, and the ranking should say so rather than
 * pretend a single-city recommendation applies (PRD-05 TC-6).
 */
export const WIDE_GEOGRAPHY_KM = 100;

/** The haversine great-circle distance between two points, in km. */
function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const EARTH_RADIUS_KM = 6371;
  return EARTH_RADIUS_KM * c;
}

/**
 * The greatest distance between any two participants who shared a location.
 *
 * Returns 0 when fewer than two participants have a location.
 */
export function groupSpreadKm(participants: ParticipantContext[]): number {
  const located = participants.filter(
    (participant): participant is ParticipantContext & { startPoint: { lat: number; lng: number; accuracyM: number } } =>
      participant.startPoint !== null,
  );

  let spread = 0;
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const distance = haversineKm(located[i]!.startPoint, located[j]!.startPoint);
      if (distance > spread) spread = distance;
    }
  }

  return spread;
}

/**
 * Computes the coverage of a ranking.
 *
 * `compared` is the number of participants the ranking could measure, and
 * `total` is the number of participants in the group. `missing` names the
 * participants that could not be measured.
 *
 * The coverage is present on EVERY result, including the
 * `NoVenueMeetsThreshold` state (PRD-05 §20.11).
 */
export function computeCoverage(
  participants: ParticipantContext[],
  measurements: Record<string, Record<string, TravelMeasurement>> = {},
): Coverage {
  const missing: string[] = [];
  let compared = 0;

  for (const participant of participants) {
    // No location shared: the participant is not measured, and is NOT zero.
    if (participant.startPoint === null) {
      missing.push(participant.id);
      continue;
    }

    const byVenue = measurements[participant.id];
    const resolvable = byVenue
      ? Object.values(byVenue).filter((measurement) => measurement !== null).length
      : 0;

    if (resolvable > 0) {
      compared += 1;
    } else {
      missing.push(participant.id);
    }
  }

  return {
    compared,
    total: participants.length,
    missing,
    wideGeography: groupSpreadKm(participants) > WIDE_GEOGRAPHY_KM,
  };
}
