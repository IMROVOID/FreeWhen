/**
 * Routing constants.
 *
 * All tunable values live here, in one place (PRD-10 §6). A value is never
 * hardcoded at a call site.
 */

import type { TransportMode } from './types';

/**
 * Straight-line distance underestimates the network distance. 1.35 is
 * conservative for a city street network (PRD-05 §9).
 */
export const DETOUR_FACTOR = 1.35;

/** The assumed transit speed in km/h, including stops (PRD-05 §9). */
export const ASSUMED_TRANSIT_SPEED_KMH = 18;

/** The assumed walk-to/from-stop time in minutes, when unknown (PRD-05 §9). */
export const WALK_ACCESS_MINUTES = 8;

/**
 * The assumed speed per mode, in km/h.
 *
 * Only the transit speed is specified by the PRD (PRD-05 §9); the others are
 * conservative urban averages used by the straight-line fallback, and are
 * labelled `low` confidence wherever they are used.
 */
export const MODE_SPEED_KMH: Record<TransportMode, number> = {
  car: 30,
  taxi: 30,
  transit: ASSUMED_TRANSIT_SPEED_KMH,
  walk: 4.5,
  cycle: 12,
};

/** The share of the estimated journey spent walking to and from a stop. */
export const WALK_ACCESS_SHARE = 0.15;

/**
 * The width of the range reported alongside a low-confidence estimate, as a
 * fraction of the estimate. An estimate without a range is false precision
 * (PRD-05 TC-18).
 */
export const MINUTES_RANGE_SPREAD = 0.25;

/** The Earth radius in metres, for the haversine calculation. */
export const EARTH_RADIUS_METERS = 6_371_000;

/** The maximum plausible straight-line distance, in metres. */
export const MAX_PLAUSIBLE_DISTANCE_METERS = 2_000_000;
