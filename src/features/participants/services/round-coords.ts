/**
 * Client-side coordinate rounding (Plan 05, PRD-08 FR-8.11, FR-8.14).
 *
 * ★ ROUNDING HAPPENS BEFORE THE NETWORK CALL, ON THE DEVICE.
 *
 * Where the rounding lives is the whole privacy property. Rounding on the
 * server would mean the precise fix had already crossed the network, been
 * written into an access log, been captured by any TLS terminator in front of
 * the API, and possibly reached a geocoding provider. Rounding here means the
 * exact position of someone's home never exists outside the phone.
 *
 * Two decimals is roughly 1.1 km at Tehran's latitude — the granularity the
 * ranking actually needs, and it matches `start_point.numeric(5,2)`, which
 * physically cannot store a third decimal.
 */

/** Decimal places kept. Named because it is a privacy parameter, not a format. */
export const COORD_DECIMALS = 2;

/** 10^COORD_DECIMALS, derived so the constant and the arithmetic cannot drift. */
const MULTIPLIER = 10 ** COORD_DECIMALS;

/**
 * The coarse accuracy the app claims for a rounded fix.
 *
 * 1200 m matches the `start_point.accuracy_m` default, and it is what makes the
 * map draw an approximate-area circle rather than a pin (FR-8.16).
 */
export const COARSE_ACCURACY_M = 1200;

export type StartPointSourceToken = 'gps_coarse' | 'manual' | 'none';

/** Exactly the body `PUT /api/participants/me/start-point` accepts. */
export interface StartPointPayload {
  lat: number;
  lng: number;
  accuracy_m: number;
  source: StartPointSourceToken;
  label: string | null;
}

/**
 * Rounds to two decimal places.
 *
 * `Math.round` on `value * 100` rather than `toFixed`, because `toFixed`
 * returns a STRING that every caller would then have to parse back — and
 * `parseFloat(x.toFixed(2))` reintroduces exactly the float noise it was meant
 * to remove.
 */
export function roundToHundredths(value: number): number {
  return Math.round(value * MULTIPLIER) / MULTIPLIER;
}

/**
 * The payload for a current-location start point.
 *
 * `label` is REQUIRED, and it is supplied by the caller from the catalogue.
 *
 * The label is what other participants read, so it is user-facing content and
 * it belongs in `fa.json`/`en.json` like every other user-facing string — a
 * Persian default baked in here would ship a Persian label to an English
 * guest, and would put a hardcoded user-facing string in a service module
 * (the phase's completion checklist forbids exactly that).
 *
 * The phrase is an approximate-area description rather than a reverse-geocoded
 * street address: geocoding the rounded point would send it to a third party
 * and would store something far more identifying than "approximate area"
 * (FR-8.13).
 */
export function roundedStartPoint(
  lat: number,
  lng: number,
  label: string,
): StartPointPayload {
  return {
    lat: roundToHundredths(lat),
    lng: roundToHundredths(lng),
    accuracy_m: COARSE_ACCURACY_M,
    source: 'gps_coarse',
    label,
  };
}

/**
 * The payload for a manually chosen point — a map pin or a neighbourhood.
 *
 * Same rounding, different `source`: the ranking treats a hand-picked point as
 * deliberate and a GPS fix as estimated, and the coverage report distinguishes
 * them.
 */
export function roundedManualStartPoint(
  lat: number,
  lng: number,
  label: string | null = null,
): StartPointPayload {
  return {
    lat: roundToHundredths(lat),
    lng: roundToHundredths(lng),
    accuracy_m: COARSE_ACCURACY_M,
    source: 'manual',
    label,
  };
}
