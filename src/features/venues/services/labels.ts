/**
 * Enum tokens → catalogue keys (Plan 08 Task 9a, PRD-05 §11.1).
 *
 * ★ ENUM TOKENS ARE NEVER TRANSLATED SERVER-SIDE.
 *
 * `mode`, `confidence`, `accessibility`, `parking.type` and `lens` travel as
 * opaque tokens precisely so each locale can label them. A server-rendered
 * `"رانندگی"` would force English mode to display Persian, and the reverse.
 * These maps are the client's half of that contract.
 *
 * ★ A MAP, NOT A SWITCH.
 *
 * The token sets are closed by their TypeScript unions, so an unknown token
 * is a type error at the call site rather than a runtime fallthrough. The
 * lookup helpers below still accept a widened string, because a payload from
 * the network is not type-checked, and a missing label must degrade to
 * `نامشخص` rather than to `undefined` on screen.
 */

import type { Lens, TransportMode, TriState } from '@/src/engine/types';
import type { Confidence } from '@/src/routing/types';

/** The five transport modes. */
export const MODE_KEY: Record<TransportMode, string> = {
  car: 'venue.mode.car',
  transit: 'venue.mode.transit',
  walk: 'venue.mode.walk',
  cycle: 'venue.mode.cycle',
  taxi: 'venue.mode.taxi',
};

/** The four lenses, each with its plain-language meaning next to its name. */
export const LENS_KEY: Record<Lens, string> = {
  balanced: 'lens.balanced',
  fastest: 'lens.fastest',
  fairest: 'lens.fairest',
  cheapest: 'lens.cheapest',
};

/** The one-line explanation shown under the active lens name. */
export const LENS_MEANING_KEY: Record<Lens, string> = {
  balanced: 'lens.meaning.balanced',
  fastest: 'lens.meaning.fastest',
  fairest: 'lens.meaning.fairest',
  cheapest: 'lens.meaning.cheapest',
};

/** The four confidence levels. */
export const CONFIDENCE_LABEL_KEY: Record<Confidence, string> = {
  high: 'confidence.high',
  medium: 'confidence.medium',
  low: 'confidence.low',
  unknown: 'confidence.unknown',
};

/**
 * The tri-state accessibility value.
 *
 * `unknown` maps to `نامشخص` and never to `تأییدشده`. Implying accessible
 * when the data is absent is the failure this tri-state exists to prevent
 * (PRD-05 §3.3).
 */
export const ACCESSIBILITY_KEY: Record<TriState, string> = {
  confirmed_yes: 'venue.accessibility.confirmedYes',
  confirmed_no: 'venue.accessibility.confirmedNo',
  unknown: 'venue.accessibility.unknown',
};

/** The four price levels, rendered as a count so the scale is never a word. */
export const PRICE_LEVEL_KEY = 'venue.priceLevel';

/** The fallback every lookup degrades to. */
export const UNKNOWN_KEY = 'common.unknown';

/**
 * Looks up a token's catalogue key, degrading to `نامشخص`.
 *
 * Accepts a widened `string` because the value may have come off the wire.
 */
export function labelKey(
  map: Record<string, string>,
  token: string | null | undefined,
): string {
  if (token == null) return UNKNOWN_KEY;
  return map[token] ?? UNKNOWN_KEY;
}

/** One lens's name key. */
export function lensKey(lens: Lens): string {
  return LENS_KEY[lens];
}

/** One lens's plain-meaning key. */
export function lensMeaningKey(lens: Lens): string {
  return LENS_MEANING_KEY[lens];
}

/**
 * The four lenses in display order.
 *
 * Balanced is first because it is the default; the rest follow the order
 * PRD-11 S9 lists them, which is not alphabetical and not by any hidden
 * ranking — the switcher must not imply that `fairest` beats `fastest`.
 */
export const LENS_ORDER: readonly Lens[] = ['balanced', 'fastest', 'fairest', 'cheapest'];
