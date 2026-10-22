/**
 * The database-backed travel cache.
 *
 * ★ THE TABLE HOLDS NO PERSONAL DATA.
 *
 * `travel_measurement` is keyed by a snapped origin, a public destination, a
 * mode and a departure bucket. It is shared across events by design, and a
 * precise origin would turn it into a location store (PRD-09 AS9.2).
 *
 * ★ THE STORED CONFIDENCE IS THE ORIGINAL ONE.
 *
 * The downgrade to `medium` happens at READ time, not at write time: a
 * record written as `high` and read a week later must be downgraded, and a
 * record written as `medium` must not be upgraded by a later read. Storing
 * the served confidence would make the downgrade irreversible in the wrong
 * direction.
 */

import { servicePool } from './supabase';
import type { CachedMeasurement, TravelCacheStore } from '@/src/routing/cache';
import type { TravelMeasurement } from '@/src/routing/types';

/** The row shape of `travel_measurement`. */
interface TravelMeasurementRow {
  origin_lat: string;
  origin_lng: string;
  dest_lat: string;
  dest_lng: string;
  mode: string;
  departure_bucket: Date | string;
  minutes: number;
  minutes_high: number | null;
  distance_m: number;
  transfers: number | null;
  walk_minutes: number | null;
  wait_minutes: number | null;
  cost_irr: string | number | null;
  confidence: string;
  source: string;
  fetched_at: Date | string;
}

/** The parsed row. */
function toRecord(row: TravelMeasurementRow): CachedMeasurement {
  const minutes = row.minutes;

  // The table has ONE high column, so the stored range is the pair
  // (minutes, minutes_high). A measurement with no high bound stores the
  // low bound as null, which reads back as "no range".
  const minutesRange: [number, number] | null =
    row.minutes_high === null ? null : [minutes, row.minutes_high];

  const measurement: TravelMeasurement = {
    minutes,
    minutesRange,
    distanceMeters: row.distance_m,
    transfers: row.transfers,
    walkMinutes: row.walk_minutes,
    waitMinutes: row.wait_minutes,
    costIrr: row.cost_irr === null ? null : Number(row.cost_irr),
    parkingCostIrr: null,
    confidence: row.confidence as TravelMeasurement['confidence'],
    source: row.source as TravelMeasurement['source'],
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };

  return {
    measurement,
    departureBucket: new Date(row.departure_bucket).toISOString(),
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

/** The key components, split for the query. */
export interface CacheKeyParts {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: string;
  departureBucket: string;
}

/**
 * The database-backed cache store.
 *
 * The query is parameterised throughout: the key is data, and a
 * concatenated one would be an injection (PRD-08 §4).
 */
export function createDatabaseCacheStore(): TravelCacheStore {
  return {
    async get(key: string): Promise<CachedMeasurement | null> {
      // The key is the canonical string, so it is split back into its parts
      // rather than parsed out of a query string.
      const parts = key.split('|');
      if (parts.length !== 6) return null;

      const [originLat, originLng, destLat, destLng, mode, departureBucket] = parts as [
        string, string, string, string, string, string,
      ];

      const result = await servicePool().query<TravelMeasurementRow>(
        `select origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
                minutes, minutes_high, distance_m, transfers, walk_minutes,
                wait_minutes, cost_irr, confidence, source, fetched_at
           from travel_measurement
          where origin_lat = $1 and origin_lng = $2
            and dest_lat = $3 and dest_lng = $4
            and mode = $5 and departure_bucket = $6
          limit 1`,
        [
          Number(originLat),
          Number(originLng),
          Number(destLat),
          Number(destLng),
          mode,
          new Date(departureBucket),
        ],
      );

      const row = result.rows[0];
      return row ? toRecord(row) : null;
    },

    async set(key: string, record: CachedMeasurement): Promise<void> {
      const parts = key.split('|');
      if (parts.length !== 6) return;

      const [originLat, originLng, destLat, destLng, mode, departureBucket] = parts as [
        string, string, string, string, string, string,
      ];

      const { measurement } = record;
      // The stored confidence is the ORIGINAL one — the read-time downgrade
      // must remain reversible in the correct direction.
      const range = measurement.minutesRange;

      await servicePool().query(
        `insert into travel_measurement
           (origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
            minutes, minutes_high, distance_m, transfers, walk_minutes,
            wait_minutes, cost_irr, confidence, source, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket)
         do update set
             minutes = excluded.minutes,
             minutes_high = excluded.minutes_high,
             distance_m = excluded.distance_m,
             transfers = excluded.transfers,
             walk_minutes = excluded.walk_minutes,
             wait_minutes = excluded.wait_minutes,
             cost_irr = excluded.cost_irr,
             confidence = excluded.confidence,
             source = excluded.source,
             fetched_at = excluded.fetched_at`,
        [
          Number(originLat),
          Number(originLng),
          Number(destLat),
          Number(destLng),
          mode,
          new Date(departureBucket),
          measurement.minutes,
          range ? range[1] : null,
          measurement.distanceMeters,
          measurement.transfers,
          measurement.walkMinutes,
          measurement.waitMinutes,
          measurement.costIrr,
          measurement.confidence,
          measurement.source,
          new Date(record.fetchedAt),
        ],
      );
    },
  };
}
