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

/**
 * The provider endpoints.
 *
 * **Neshan's direction endpoint is `/v4`.** The plan assumed `/v2`, but the
 * provider's own documentation lists `/v4/direction` as the current version
 * and `/v2` as a superseded one. The endpoints are configuration rather than
 * literals so a version bump is a one-line change, not a search.
 */
export const PROVIDER_ENDPOINTS = {
  neshanMatrix: 'https://api.neshan.org/v1/distance-matrix',
  neshanDirection: 'https://api.neshan.org/v4/direction',
  orsMatrix: 'https://api.openrouteservice.org/v2/matrix',
  orsDirections: 'https://api.openrouteservice.org/v2/directions',
} as const;

/**
 * The Neshan `type` parameter per mode.
 *
 * **`type` accepts only `car` and `motorcycle`** — there is no transit type,
 * and no walk type on this endpoint. That is the mechanism by which the
 * transit proxy is unavoidable rather than a limitation to work around
 * (PRD-05 §9, Research F2).
 *
 * A mode with no Neshan equivalent maps to `null`, and the adapter declines
 * it rather than sending a wrong `type`. The product's `TransportMode` has
 * no `motorcycle`, so only `car` is reachable today — but the type is
 * retained so adding the mode is a one-line change rather than a rewrite of
 * the adapter.
 */
export const NESHAN_TYPE_BY_MODE: Partial<Record<TransportMode, 'car' | 'motorcycle'>> = {
  car: 'car',
  taxi: 'car',
};

/**
 * The ORS routing profile per mode.
 *
 * ORS has car, bike, walk, hike, wheelchair and HGV — **and no transit**,
 * which confirms the proxy from a third direction (PRD-05 §9).
 */
export const ORS_PROFILE_BY_MODE: Partial<Record<TransportMode, string>> = {
  car: 'driving-car',
  taxi: 'driving-car',
  walk: 'foot-walking',
  cycle: 'cycling-regular',
};

/**
 * The straight-line pre-filter radius, in km.
 *
 * A venue whose MINIMUM member distance exceeds this is dropped as a
 * candidate (PRD-05 §12.1, layer 1).
 */
export const PRE_FILTER_MAX_KM = 25;

/**
 * The maximum number of venues scored per event.
 *
 * Bounds the matrix: at 10 participants × 15 venues × 3 modes, the difference
 * between a bounded and an unbounded matrix is 450 provider pairs and 3
 * requests (PRD-05 §12.1, layer 2).
 */
export const CANDIDATE_CAP = 15;

/**
 * The width of the departure bucket, in minutes.
 *
 * A journey's departure is snapped to this grid so that the cache key is
 * shared by everyone departing in the same quarter hour (PRD-05 §12.1,
 * layer 4).
 */
export const DEPARTURE_BUCKET_MINUTES = 15;

/**
 * The cache TTL per mode, in milliseconds.
 *
 * Traffic-aware driving is 1 hour because traffic forecasts are unstable;
 * walking and cycling are 7 days because a footpath does not change.
 *
 * **A transit measurement's TTL may be long, but its confidence never
 * improves** — the proxy is permanent (PRD-05 §12.1).
 */
export const CACHE_TTL_MS = {
  car: 60 * 60 * 1000,
  taxi: 60 * 60 * 1000,
  walk: 7 * 24 * 60 * 60 * 1000,
  cycle: 7 * 24 * 60 * 60 * 1000,
  transit: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * The provider request timeout, in milliseconds.
 *
 * A provider that does not answer within this is treated as down, because a
 * ranking that arrives late is worse than a ranking that arrives degraded.
 */
export const PROVIDER_TIMEOUT_MS = 8_000;

/**
 * The number of times a transient provider failure is retried.
 *
 * Exactly one — 500 `GenericError` is the only documented transient status
 * (PRD-05 §12.3). A quota error or a config fault must NOT be retried.
 */
export const PROVIDER_RETRY_COUNT = 1;

/**
 * The base delay before a retry, in milliseconds.
 *
 * Doubled per attempt. Long enough that a genuinely transient failure has
 * time to clear, short enough that a user is not left waiting.
 */
export const PROVIDER_BACKOFF_BASE_MS = 250;

/**
 * The maximum number of pairs a single matrix request may carry.
 *
 * ORS caps a matrix at 3,500 pairs per request; Neshan's per-request limit is
 * UNVERIFIED, so the smaller of the two bounds is applied to every provider
 * (PRD-05 §12.2).
 */
export const MATRIX_MAX_PAIRS = 3_500;

/**
 * The maximum number of pairs the per-pair direction fallback may request.
 *
 * The direction adapter is a FALLBACK, not the default path: at 10
 * participants × 15 venues it would be 150 individual requests. It is
 * bounded to the top candidates so a matrix outage cannot generate a burst
 * (Plan 04, Task 3).
 */
export const DIRECTION_FALLBACK_MAX_PAIRS = 60;
