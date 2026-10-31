/**
 * The viewer's own position, as the map draws it.
 *
 * ★ THE ORIGIN IS THE READER, NOT A PERSON IN A LIST.
 *
 * Everywhere else a marker is a proposal, coloured by whoever proposed it
 * (`colorForNickname`). The origin is different: it is the person holding the
 * phone, so it has one colour for everybody, and that colour has to be visible on
 * a light basemap and a dark one.
 *
 * ★ `theme.info` WAS BLACK ON THE LIGHT THEME, WHICH IS THE REPORTED "BLACK".
 *
 * `info` is `palette.lilac` on the dark theme — a pale violet, correct there — and
 * `palette.espresso` on the light one, which is `#170E0A`: near-black. The origin
 * pin and the route line both took `info`/`platform.primary`, so on the light theme
 * the reader's own position was drawn in the darkest colour on the map. The token
 * pair below is the fix, and it is theme-independent for the same reason
 * `map.markerRing` is: the basemap is not ours to match.
 *
 * ★ A CIRCLE, NOT A PIN.
 *
 * A pin says "this place is here" — it points, and its tip is the coordinate. The
 * origin is not a place somebody is going to; it is where the reader already is,
 * so it is drawn as the dot every map application uses for it, centred on the
 * coordinate.
 */

import { map as mapTokens } from '@/src/theme/tokens';
import type { Coordinate } from '@/src/routing/types';

/** The shape the surface draws for the viewer's own position. */
export const ORIGIN_SHAPE = 'circle' as const;

/** The colour of the origin marker and of every route line that starts there. */
export const ORIGIN_COLOR = mapTokens.originFill;

/**
 * The marker payload for the origin, so the three call sites cannot disagree.
 *
 * Returns `null` for a coordinate the projection cannot draw: a marker at
 * `NaN`/`(0,0)` is a dot in the Atlantic that reads as a real position.
 */
export function originMarker(
  coordinate: Coordinate | null,
  label: string,
): { id: 'origin'; coordinate: Coordinate; color: string; shape: 'circle'; label: string } | null {
  if (coordinate === null) return null;
  if (!Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lng)) return null;
  if (Math.abs(coordinate.lat) > 85.0511 || Math.abs(coordinate.lng) > 180) return null;

  return {
    id: 'origin',
    coordinate,
    color: ORIGIN_COLOR,
    shape: ORIGIN_SHAPE,
    label,
  };
}
