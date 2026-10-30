/**
 * The segmented control's indicator geometry.
 *
 * ★ THE INDICATOR IS PLACED BY A PHYSICAL OFFSET, COMPUTED IN ONE PLACE.
 *
 * The pill used to be anchored with `insetInlineStart` and then translated by
 * `segmentWidth * index`. Two things were wrong at once:
 *
 *  1. `insetInlineStart` compiles to `inset-inline-start` under react-native-web,
 *     which resolves against the DOCUMENT direction. `app/+html.tsx` puts
 *     `dir="rtl"` on `<html>`, so in Persian this anchored the pill to the rail's
 *     RIGHT edge.
 *  2. The translate stayed positive regardless of direction.
 *
 * The anchor and the offset disagreed about which way "start" pointed, so the pill
 * walked out of the track — the Settings theme control with its selection hanging
 * off the end of the rail.
 *
 * ★ SO THE OFFSET IS AN ABSOLUTE `left`, NOT A DELTA FROM A LOGICAL EDGE.
 *
 * A signed translate from a fixed physical anchor cannot express both directions
 * without the anchor itself moving. Returning the pill's actual left edge removes
 * the ambiguity: the component applies it as a transform from `left: 0`, and no
 * inline property is involved.
 *
 * Pure, so the arithmetic is tested without a gesture or a DOM — see
 * `tests/ui/segmented-indicator.test.ts`.
 */

export interface IndicatorGeometryOptions {
  /** The rail's measured width, including its own inner padding on both sides. */
  trackWidth: number;
  /** The padding the rail applies at each end. */
  inset: number;
  /** How many options the rail holds. */
  count: number;
  /** Whether the interface reads right-to-left. */
  rtl: boolean;
}

/** The width of one segment, or 0 before the rail has measured. */
export function segmentWidthFor({ trackWidth, inset, count }: Omit<IndicatorGeometryOptions, 'rtl'>): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  if (!Number.isFinite(count) || count <= 0) return 0;

  return Math.max(0, (trackWidth - inset * 2) / count);
}

/**
 * The indicator's left edge, as a distance from the rail's PADDING box origin.
 *
 * ★ THE FIRST OPTION IS AT THE PHYSICAL LEFT IN LTR AND THE PHYSICAL RIGHT IN RTL.
 *
 * A right-to-left rail lays its first segment against its right edge, which is why
 * the offset subtracts rather than adds there. Clamping the index means a caller
 * that computes it differently later cannot walk the pill out of the track.
 *
 * ★ THE ORIGIN IS THE RAIL'S PADDING BOX, WHICH IS WHERE AN ABSOLUTE `left` IS
 *   MEASURED FROM.
 *
 * `inset` is the rail's own horizontal padding, and the rail is `position:
 * relative`, so an absolutely-positioned child's `left: 0` sits at the rail's
 * padding edge — NOT at its border edge. The padding is therefore already spent
 * by the box model and must not be added again: the first segment's left edge is
 * `0`, and every other value is a distance from there. Adding `inset` here (as
 * this function used to) shifted the whole rail one padding step inward and left
 * a matching gap at the far end — the reported "the pill has an extra offset and
 * the group has no padding on the sides".
 */
export function indicatorLeftFor(index: number, options: IndicatorGeometryOptions): number {
  const { trackWidth, inset, count, rtl } = options;
  const segmentWidth = segmentWidthFor({ trackWidth, inset, count });

  // Before the rail has measured there is no track to place against. The call
  // site renders the pill at `opacity: 0` in that state, so the value only has to
  // be a safe, non-negative number inside the rail.
  if (segmentWidth <= 0) return 0;

  const raw = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safeIndex = Math.min(count - 1, Math.max(0, raw));

  const travel = segmentWidth * safeIndex;
  const inner = trackWidth - inset * 2;

  return rtl ? inner - segmentWidth - travel : travel;
}

/**
 * The side the pill is positioned from, and its distance, as ONE style object.
 *
 * ★ THE PILL IS ALWAYS ANCHORED ON A SINGLE PHYSICAL SIDE.
 *
 * Returning `{ right }` under RTL looked equivalent and was not: the base style
 * already declares `left: 0` so the absolute node has a defined anchor, and React
 * Native MERGES the call-site object over it. The node then carried both `left: 0`
 * and `right: n`, and CSS resolves the pair by giving `left` precedence — the
 * mirror was silently discarded, the pill was laid out from the physical left on
 * a right-to-left rail, and the offset (computed for the right edge) put it over
 * the opposite option. That is the reported "Auto is selected but the knob is on
 * Light".
 *
 * So the placement is a pair that can never disagree with itself: both keys are
 * always emitted, one of them is `auto`, and the other is the distance from the
 * edge it names. The returned object is spread onto the node directly.
 */
export function indicatorPlacementFor(
  index: number,
  options: IndicatorGeometryOptions,
): { left: number | 'auto'; right: number | 'auto' } {
  const { trackWidth, inset, count, rtl } = options;

  const left = indicatorLeftFor(index, options);

  if (rtl) {
    const segmentWidth = segmentWidthFor({ trackWidth, inset, count });
    const fromRight = segmentWidth > 0 ? trackWidth - inset * 2 - left - segmentWidth : 0;
    // rtl-ok: both keys are emitted so the mirror cannot half-apply.
    return { left: 'auto', right: fromRight };
  }

  // rtl-ok: a PHYSICAL side pair; see the RTL branch above.
  return { left, right: 'auto' };
}
