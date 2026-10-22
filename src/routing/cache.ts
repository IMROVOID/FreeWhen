/**
 * The travel cache.
 *
 * ★ THE CACHE HOLDS NO PERSONAL DATA.
 *
 * It is keyed by GEOGRAPHY and TIME, never by user: the origin is snapped
 * to 2 dp (~200 m) and the destination is a public venue. The table is
 * shared across events by design, and a precise origin would turn it into
 * a location store (PRD-09 AS9.2, PRD-05 §12.1).
 *
 * ★ SERVING STALE DATA SILENTLY IS A LIE.
 *
 * A cache hit beyond its freshness window means `high` becomes `medium`,
 * which renders as «تخمینی» and not «زنده». The ORIGINAL `fetchedAt` is
 * kept, so the client can say how old the figure is (PRD-05 §5.5, §8.2).
 *
 * The cache is a PURE key/value contract here: the storage is injected.
 * The server supplies a database-backed store; a test supplies a map. The
 * storage interface is deliberately tiny so a wrong implementation cannot
 * smuggle personal data in.
 */

import { CACHE_TTL_MS, MINUTES_RANGE_SPREAD } from './config';
import type { TravelMeasurement } from './types';

/**
 * A cache record.
 *
 * It carries the measurement, the bucket it was fetched for, and the instant
 * it was fetched. Nothing else — a record with a user id in it would make
 * the table a personal-data store.
 */
export interface CachedMeasurement {
  measurement: TravelMeasurement;
  /** The departure bucket the measurement was fetched for. */
  departureBucket: string;
  /** When the measurement was produced. */
  fetchedAt: string;
}

/**
 * The cache's storage.
 *
 * A lookup returns the record or `null`; a write stores one. There is no
 * delete and no enumeration, so a store cannot be walked to reveal who
 * travelled where.
 */
export interface TravelCacheStore {
  get(key: string): Promise<CachedMeasurement | null>;
  set(key: string, record: CachedMeasurement): Promise<void>;
}

/** Rounds a coordinate to 2 decimal places — a ~200 m snap. */
export function snapCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The precision a destination is stored at.
 *
 * ★ THE KEY'S PRECISION MUST NOT EXCEED THE COLUMN'S.
 *
 * `travel_measurement.dest_lat` is `numeric(7,5)` and `venue.lat` is
 * `numeric(9,6)`, so a 6-decimal destination is ROUNDED on insert. A lookup
 * with the un-rounded value compares `35.123456` against a stored
 * `35.12346` and matches nothing — so the cache would never hit, and every
 * request would re-spend provider quota on the one thing the cache exists
 * to prevent.
 *
 * The key therefore carries the destination at the COLUMN's precision. The
 * ~1 m difference is far below the ~200 m origin snap, and it is what makes
 * the key and the column agree.
 */
export const DESTINATION_PRECISION = 5;

/** Rounds a coordinate to the destination precision — 5 decimal places. */
export function snapDestination(value: number): number {
  const factor = 10 ** DESTINATION_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * The cache key.
 *
 * Keyed by GEOGRAPHY and TIME, never by a user: the origin is snapped to 2
 * dp (~200 m), the destination to the column's precision, the mode is the
 * travel mode, and the departure is a 15-minute bucket.
 */
export function cacheKey(input: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: string;
  departureBucket: string;
}): string {
  return [
    snapCoordinate(input.origin.lat),
    snapCoordinate(input.origin.lng),
    snapDestination(input.destination.lat),
    snapDestination(input.destination.lng),
    input.mode,
    input.departureBucket,
  ].join('|');
}

/**
 * The freshness window for a mode, in milliseconds.
 *
 * The transit TTL is long because the proxy's inputs do not change — but the
 * transit measurement's CONFIDENCE never improves, whatever its TTL
 * (PRD-05 §12.1).
 */
export function ttlFor(mode: string): number {
  return CACHE_TTL_MS[mode as keyof typeof CACHE_TTL_MS] ?? CACHE_TTL_MS.car;
}

/**
 * Whether a cached record is still fresh.
 */
export function isFresh(
  record: CachedMeasurement,
  mode: string,
  now: Date,
): boolean {
  const fetchedAt = Date.parse(record.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;

  return now.getTime() - fetchedAt < ttlFor(mode);
}

/**
 * The confidence a cached record is served with.
 *
 * ★ A FRESH `high` RECORD IS SERVED AS `medium`.
 *
 * Even a record fetched a second ago is a CACHED result, and the PRD
 * distinguishes «زنده» (live) from «تخمینی» (estimated). Serving a cached
 * measurement as `high` would tell the user a traffic-aware live figure
 * when they are looking at a stored one. The `medium` label is the honest
 * one.
 */
export function servedConfidence(
  record: CachedMeasurement,
  mode: string,
  now: Date,
): TravelMeasurement['confidence'] {
  // A transit measurement is `low` whatever the cache says. Its TTL may be
  // long; its confidence never improves.
  if (mode === 'transit') return 'low';

  if (isFresh(record, mode, now)) {
    // A cache hit is a cached result: `high` becomes `medium`.
    return record.measurement.confidence === 'high' ? 'medium' : record.measurement.confidence;
  }

  // A stale record is served at `low` — a straight-line grade of honesty
  // for a figure we can no longer vouch for.
  return 'low';
}

/**
 * Serves a record from the cache, downgraded to its honest confidence.
 *
 * The original `fetchedAt` is KEPT: the client needs to know how old the
 * figure is, and a rewritten timestamp would hide that.
 */
export function serveFromCache(
  record: CachedMeasurement,
  mode: string,
  now: Date,
): TravelMeasurement {
  const confidence = servedConfidence(record, mode, now);

  return {
    ...record.measurement,
    confidence,
    // A downgraded measurement is no longer exact, so it needs a range: a
    // bare integer would read as a measurement (PRD-05 §12.4).
    //
    // ★ A DEGENERATE RANGE IS FALSE PRECISION.
    //
    // `[25, 25]` says "exactly 25 minutes", which is a claim the cache
    // cannot make about a figure it has downgraded. So when the record
    // carries no range of its own, the range is DERIVED from the same
    // spread the straight-line model uses — the honest width for a figure
    // whose precision is no longer known.
    minutesRange:
      confidence === 'high'
        ? record.measurement.minutesRange
        : record.measurement.minutesRange ?? derivedRange(record.measurement.minutes),
  };
}

/**
 * The range a figure of unknown precision is reported with.
 *
 * The same 25% spread the straight-line model uses: a quarter either side
 * of the estimate. It is an ESTIMATE and says so — which is exactly what
 * `low` confidence means.
 */
function derivedRange(minutes: number): [number, number] {
  const spread = minutes * MINUTES_RANGE_SPREAD;
  return [Math.max(0, Math.floor(minutes - spread)), Math.ceil(minutes + spread)];
}

/**
 * A cache store backed by a `Map`.
 *
 * For tests and for a single-process server. It holds the same records the
 * database store holds — the geography key and no user id — so the two
 * cannot diverge in what they are allowed to contain.
 */
export function createMemoryCacheStore(): TravelCacheStore {
  const entries = new Map<string, CachedMeasurement>();

  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, record) {
      entries.set(key, record);
    },
  };
}
