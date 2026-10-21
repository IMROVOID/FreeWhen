/**
 * The straight-line adapter — the floor of the degradation ladder.
 *
 * It is always available: no network, no provider, no API key. Its result is
 * a MODEL, not a measurement, and it says so: `confidence: 'low'`, a
 * `minutesRange`, and `costIrr: null` (PRD-05 §9, PRD-05 §12.4).
 */

import {
  DETOUR_FACTOR,
  EARTH_RADIUS_METERS,
  MAX_PLAUSIBLE_DISTANCE_METERS,
  MINUTES_RANGE_SPREAD,
  MODE_SPEED_KMH,
  WALK_ACCESS_MINUTES,
  WALK_ACCESS_SHARE,
} from '../config';
import type { Coordinate, TransportMode, TravelMeasurement } from '../types';

/** The haversine great-circle distance between two coordinates, in metres. */
export function haversineMeters(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export interface StraightLineOptions {
  from: Coordinate;
  to: Coordinate;
  mode: TransportMode;
  /** The instant the measurement is attributed to. Defaults to now. */
  now?: Date;
}

/**
 * Estimates a journey with the straight-line model.
 *
 * The result is deterministic for a given input: the same coordinates and
 * mode always produce the same minutes, so the UI never flickers between
 * renders.
 */
export function estimateStraightLine(options: StraightLineOptions): TravelMeasurement {
  const { from, to, mode, now = new Date() } = options;

  const straightLineMeters = haversineMeters(from, to);
  const networkMeters = straightLineMeters * DETOUR_FACTOR;

  const speedKmh = MODE_SPEED_KMH[mode];
  const travelMinutes = (networkMeters / 1000 / speedKmh) * 60;

  // A transit journey includes walking to and from the stops.
  const walkMinutes = mode === 'transit' ? WALK_ACCESS_MINUTES : 0;
  const minutes = travelMinutes + walkMinutes;

  const spread = minutes * MINUTES_RANGE_SPREAD;
  const lower = Math.max(0, Math.floor(minutes - spread));
  const upper = Math.ceil(minutes + spread);

  return {
    minutes: Math.round(minutes),
    minutesRange: [lower, upper],
    distanceMeters: Math.round(networkMeters),
    transfers: null,
    walkMinutes: mode === 'transit' ? walkMinutes : null,
    waitMinutes: null,
    // Unknown is unknown. A `0` here would make a venue falsely "cheapest"
    // (PRD-09 §13.3).
    costIrr: null,
    parkingCostIrr: null,
    confidence: STRAIGHT_LINE_CONFIDENCE,
    source: 'straight_line',
    fetchedAt: now.toISOString(),
  };
}

/**
 * The confidence a straight-line measurement may carry: `low`, always.
 *
 * Transit in particular is `low` UNCONDITIONALLY — no input (a short trip, a
 * dense corridor, high-confidence car data for other participants) may raise
 * it (PRD-05 TC-18). A later rung of the ladder may raise the other modes,
 * but never transit, and never this adapter.
 */
export const STRAIGHT_LINE_CONFIDENCE = 'low' as const;

export { MAX_PLAUSIBLE_DISTANCE_METERS, WALK_ACCESS_SHARE };
