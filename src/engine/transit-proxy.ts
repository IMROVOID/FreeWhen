/**
 * The transit proxy — the honest fallback.
 *
 * **No evaluated provider offers Iranian public-transit routing**
 * (PRD-05 §9). Neshan has car, motorcycle and pedestrian only; ORS has no
 * transit; Google has transit but is contractually unavailable. And no
 * usable Tehran GTFS feed exists — Transitland returns zero Iranian
 * operators, and the single real feed carries no licence, so it cannot be
 * redistributed.
 *
 * **This proxy is PERMANENT, not a stopgap.** It is not a TODO waiting for a
 * feed. If a feed is ever obtained, `getTravelTime(_, _, 'transit')` is
 * replaced and the proxy goes with it — the engine is untouched either way.
 *
 * The single most important property: **`confidence` is `low`
 * unconditionally.** No input — a short trip, a dense corridor,
 * high-confidence car data for the other participants — may produce `high`
 * or `medium` (PRD-05 TC-18). A transit estimate rendered like a
 * measurement is the failure mode that destroys the product's credibility.
 */

import { ENGINE_CONFIG, MINUTES_RANGE_SPREAD } from './config';
import type { TravelMeasurement } from './types';

/**
 * The confidence the proxy may carry: `low`, always.
 *
 * Declared as a literal type so that it cannot be widened by accident.
 */
export const TRANSIT_PROXY_CONFIDENCE = 'low' as const;

/** The haversine great-circle distance between two points, in metres. */
export function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
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

/** The inputs to a transit proxy estimate. */
export interface TransitProxyOptions {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** The instant the measurement is attributed to. */
  fetchedAt: string;
}

/**
 * Estimates a transit journey with the straight-line model.
 *
 * `(haversineKm × DETOUR_FACTOR) / ASSUMED_TRANSIT_SPEED_KMH` hours, plus
 * the fixed walk-to/from-stop time.
 *
 * The result always carries a `minutesRange` — a bare integer reads as a
 * measurement — and always leaves `costIrr` as `null`, because the fare is
 * unknown and unknown must not read as free.
 */
export function estimateTransitProxy(options: TransitProxyOptions): TravelMeasurement {
  const { from, to, fetchedAt } = options;

  const straightLineKm = haversineKm(from, to);
  const networkKm = straightLineKm * ENGINE_CONFIG.DETOUR_FACTOR;

  const travelMinutes =
    (networkKm / ENGINE_CONFIG.ASSUMED_TRANSIT_SPEED_KMH) * ENGINE_CONFIG.MINUTES_PER_HOUR;
  const minutes = travelMinutes + ENGINE_CONFIG.WALK_ACCESS_MINUTES;

  const spread = minutes * MINUTES_RANGE_SPREAD;
  const lower = Math.max(0, Math.floor(minutes - spread));
  const upper = Math.ceil(minutes + spread);

  return {
    minutes: Math.round(minutes),
    minutesRange: [lower, upper],
    distanceMeters: Math.round(networkKm * 1000),
    // A straight-line model knows nothing about the network's transfers.
    transfers: null,
    walkMinutes: ENGINE_CONFIG.WALK_ACCESS_MINUTES,
    waitMinutes: null,
    // Unknown is unknown. A `0` here would make a venue falsely "cheapest".
    costIrr: null,
    parkingCostIrr: null,
    // UNCONDITIONAL. See the module note.
    confidence: TRANSIT_PROXY_CONFIDENCE,
    source: 'straight_line',
    fetchedAt,
  };
}
