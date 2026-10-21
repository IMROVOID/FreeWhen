/**
 * The travel interface.
 *
 * Phase 3 consumes these types; Phase 4 fills in the other rungs of the
 * degradation ladder. They are defined here, before any provider exists, so
 * that a provider failure is a config change rather than a rewrite
 * (PRD-10 §13.2).
 */

/**
 * How much the measurement can be trusted.
 *
 * - `high`   — live traffic-aware or a routed call, fresh
 * - `medium` — cached previously-live result
 * - `low`    — straight-line or modelled
 * - `unknown`— no data
 */
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

/** The transport modes a participant can travel by. */
export type TransportMode = 'car' | 'transit' | 'walk' | 'cycle' | 'taxi';

/** Where a measurement came from. */
export type TravelSource =
  | 'neshan_matrix'
  | 'neshan_direction'
  | 'ors'
  | 'straight_line'
  | 'none';

export interface TravelMeasurement {
  /** The primary travel time in minutes. */
  minutes: number;
  /** Present when not high-confidence. A `[lower, upper]` tuple, never a bare integer. */
  minutesRange: [number, number] | null;
  distanceMeters: number;
  transfers: number | null;
  walkMinutes: number | null;
  waitMinutes: number | null;
  /** `null` means unknown, NEVER 0 — unknown must not read as free (PRD-09 §13.3). */
  costIrr: number | null;
  parkingCostIrr: number | null;
  confidence: Confidence;
  source: TravelSource;
  /** ISO 8601 timestamp of when the measurement was produced. */
  fetchedAt: string;
}

/** A coordinate pair. */
export interface Coordinate {
  lat: number;
  lng: number;
}
