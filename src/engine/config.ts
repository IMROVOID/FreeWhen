/**
 * The engine's tunable constants.
 *
 * Every penalty, factor and threshold lives here, and nowhere else
 * (PRD-05 §20.7). A literal in `utility.ts` is a defect even when the value
 * is right: the constant has to be tunable, and it has to be testable
 * without editing a formula.
 *
 * **These are estimates, not measurements.** `ASSUMED_TRANSIT_SPEED_KMH` and
 * `D_MAX_DEFAULT` are unverified for Iranian cities (PRD-05 AS5.2). They are
 * deliberately configurable so a later study can replace them without
 * touching the engine.
 */
export const ENGINE_CONFIG = {
  /**
   * The default travel-time budget, in minutes, for a participant who has
   * declared none. UNVERIFIED for Iran (PRD-05 AS5.2) — configurable, never
   * hardcoded at a call site.
   */
  D_MAX_DEFAULT: 60,

  /**
   * Minutes added per transfer BEYOND the first. A transfer is a real
   * friction cost that time alone does not capture (PRD-05 §4.2).
   */
  TRANSFER_PENALTY_MIN: 5,

  /**
   * The walking portion, in minutes, above which the long-walk penalty
   * starts to apply (PRD-05 §4.2).
   */
  LONG_WALK_THRESHOLD_MIN: 10,

  /**
   * Minutes added per minute of walking beyond the threshold — half a
   * minute of penalty per extra minute walked. Walking is disproportionately
   * effortful (PRD-05 §4.2).
   */
  LONG_WALK_FACTOR: 0.5,

  /**
   * The multiplier applied to walking minutes for a participant with
   * `limitedWalking`. The research puts the scale between 1.5× and 2×;
   * 1.75 is the midpoint (PRD-05 §4.2).
   */
  LIMITED_WALK_FACTOR: 1.75,

  /**
   * Minutes added when a participant who avoids night travel is travelling
   * at night. This is a DECLARED PREFERENCE, not a measurement — no
   * epidemiological claim is made (PRD-05 §4.3).
   */
  NIGHT_PENALTY_MIN: 15,

  /**
   * The hours, as a half-open interval `[start, end)`, that count as night.
   * The interval crosses midnight: 21:00 to 06:00 (PRD-05 §4.2).
   */
  NIGHT_HOURS: [21, 6] as const,

  /**
   * The Fairest lens rejects any candidate whose floor is below this
   * fraction of the best available floor. Without the guard, a venue where
   * everyone is equally miserable wins with a gap of zero (PRD-05 §6.4).
   */
  FAIREST_FLOOR_RATIO: 0.6,

  /**
   * The straight-line → network distance multiplier for the transit proxy.
   * 1.35 is conservative for a city street network (PRD-05 §9).
   */
  DETOUR_FACTOR: 1.35,

  /**
   * The assumed transit speed in km/h, including stops. The Tehran metro is
   * faster and buses are slower; 18 is the balance. UNVERIFIED (PRD-05 §9).
   */
  ASSUMED_TRANSIT_SPEED_KMH: 18,

  /**
   * The assumed walk-to/from-stop time in minutes, when unknown (PRD-05 §9).
   */
  WALK_ACCESS_MINUTES: 8,

  /**
   * The straight-line pre-filter radius in km. A venue whose MINIMUM member
   * distance exceeds this is dropped as a candidate. It reduces the matrix;
   * it is never a displayed time (PRD-05 §12.1).
   */
  PRE_FILTER_MAX_KM: 25,

  /**
   * The maximum number of venues scored per event. Bounds the matrix
   * (PRD-05 §12.1).
   */
  CANDIDATE_CAP: 15,

  /**
   * The default participant weight. The field is reserved at 1 and read by
   * nothing in the MVP — a weight is unexplainable to the people it
   * disadvantages, so it was cut (PRD-05 §6.6).
   */
  WEIGHT_DEFAULT: 1,

  /**
   * The minutes in an hour. A unit conversion, not a tunable — it lives
   * here so the one place that converts hours to minutes does not carry a
   * bare literal.
   */
  MINUTES_PER_HOUR: 60,
} as const;

/**
 * The fraction of a measurement used as the width of its reported range.
 *
 * An estimate without a range is false precision (PRD-05 §12.4). The proxy
 * reports one; the engine never assumes its absence means precision.
 */
export const MINUTES_RANGE_SPREAD = 0.25;
