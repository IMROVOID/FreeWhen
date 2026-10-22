/**
 * How a travel time is presented (Plan 08 Task 1, PRD-04 §13.4, FR-4.18–FR-4.19).
 *
 * ★ THE TYPE SYSTEM IS THE GUARD, NOT THE CALLER.
 *
 * A low-confidence figure cannot be rendered as a precise integer because
 * `DisplayMinutes` has no member that carries a bare number in the
 * `range` or `unknown` case. If `minutes` were a plain `number` on the
 * render path, an estimate would be indistinguishable from a measurement
 * and the honesty claim in PRD-04 §8 would be a convention rather than a
 * constraint.
 *
 * ★ `unknown` IS A FOURTH STATE, NOT A ZERO-LENGTH RANGE.
 *
 * Zero minutes is a measurement — a venue at the participant's door. Unknown
 * is the absence of a measurement. Collapsing the two would render "no data"
 * as "next door", which is the single most damaging thing this screen could
 * say.
 */

import type { Confidence } from '@/src/engine/types';

/**
 * The presentation shape.
 *
 * `exact` may only be produced from a high-confidence measurement.
 * `range` carries a real interval. `unknown` carries nothing, because
 * anything it carried would be invented.
 */
export type DisplayMinutes =
  | { kind: 'exact'; minutes: number }
  | { kind: 'range'; low: number; high: number }
  | { kind: 'unknown' };

/**
 * The measurement shape this module reads.
 *
 * Structurally satisfied by both `TravelMeasurement` (routing) and
 * `ParticipantResult` (engine), so one function covers the map, the list and
 * the per-person breakdown. `minutes` is deliberately named `number` here —
 * it is the *input* to the decision, never the thing rendered.
 */
export interface MeasuredMinutes {
  confidence: Confidence;
  minutes: number;
  minutesRange: [number, number] | null;
}

/**
 * Decides how to present a measurement.
 *
 * Order matters. `unknown` confidence wins over a present `minutes`, because
 * a figure the pipeline itself does not trust must not be shown as a
 * measurement even when a number happens to be sitting next to it.
 */
export function displayMinutes(measurement: MeasuredMinutes): DisplayMinutes {
  if (measurement.confidence === 'unknown') return { kind: 'unknown' };

  // A range always wins over `minutes`: when both are present the range is
  // the honest one, and `minutes` is its midpoint.
  if (measurement.minutesRange) {
    const [low, high] = measurement.minutesRange;
    return { kind: 'range', low, high };
  }

  if (measurement.confidence === 'high') {
    return { kind: 'exact', minutes: measurement.minutes };
  }

  // medium/low confidence with no explicit range: derive one rather than
  // printing a false integer. The band is deliberately wide — a straight-line
  // estimate can be off by half again in Tehran traffic.
  const low = Math.max(0, Math.round(measurement.minutes * ESTIMATE_LOW_RATIO));
  const high = Math.round(measurement.minutes * ESTIMATE_HIGH_RATIO);
  return { kind: 'range', low, high };
}

/**
 * The derived band for an estimate that arrived without an explicit range.
 *
 * ±40% is not a calibrated confidence interval and does not claim to be: it
 * exists so the UI never renders a single number for a measurement nobody
 * measured. The engine supplies real ranges when it has them, and this
 * fallback only handles the medium/low-without-range case.
 */
const ESTIMATE_LOW_RATIO = 0.6;
const ESTIMATE_HIGH_RATIO = 1.4;

/**
 * The four confidence labels, as catalogue keys.
 *
 * Keys rather than strings: `زنده` / `تخمینی` / `فاصلهٔ مستقیم` / `نامشخص`
 * live in `confidence.*` in both catalogues (PRD-04 FR-4.19). A string here
 * would freeze the locale at module load.
 */
export const CONFIDENCE_KEY: Record<Confidence, string> = {
  high: 'confidence.high',
  medium: 'confidence.medium',
  low: 'confidence.low',
  unknown: 'confidence.unknown',
};

/**
 * Whether a confidence level is an estimate the user must be warned about.
 *
 * `medium` counts: a cached previously-live figure is still not a
 * measurement of this trip.
 */
export function isEstimated(confidence: Confidence): boolean {
  return confidence === 'medium' || confidence === 'low';
}

/**
 * Whether a display value carries enough information to render at all.
 *
 * The caller uses this to decide between a figure and `نامشخص`, so the
 * decision lives here rather than being re-derived at each call site.
 */
export function hasFigure(value: DisplayMinutes): boolean {
  return value.kind !== 'unknown';
}
