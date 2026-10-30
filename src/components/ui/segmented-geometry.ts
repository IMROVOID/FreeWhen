/**
 * The segmented control's indicator geometry.
 *
 * ★ THE PILL IS PLACED BY PHYSICAL PIXELS, NEVER BY A LAYOUT INSET.
 *
 * Three insets were tried and every one of them changed meaning under a
 * right-to-left rail:
 *
 *  - `insetInlineStart` resolves against the DOCUMENT direction, so on the web
 *    build (`dir="rtl"` on `<html>`) it anchored the pill to the wrong edge;
 *  - an explicit `left` is the inline-END inset in an RTL parent, which makes Yoga
 *    take a different branch than it does for English;
 *  - forcing the rail itself to `direction: 'ltr'` fixed that branch but also laid
 *    the LABELS out left-to-right — putting `fa` on the wrong side — and it is a
 *    native-only knob (react-native-web derives direction from the `dir` PROP,
 *    and rejects `direction` as a style).
 *
 * A `transform: translateX` is the one horizontal position that no direction
 * mirrors, and it is identical on native and web. So the pill anchors at its
 * parent's origin and the numbers here are the whole distance from it.
 *
 * ★ AND THE ORIGIN IS THE PADDING EDGE, WHICH IS WHY THE PILL DECLARES NO INSET.
 *
 * `ReactCommon/yoga/yoga/algorithm/AbsoluteLayout.cpp` resolves an absolute child's
 * origin from two different branches:
 *
 *  - child HAS an explicit inset → `inset + parent BORDER + margin`;
 *  - child has NO inset         → `parent BORDER + parent PADDING + margin`.
 *
 * Only the second agrees with the browser, where an absolutely positioned element's
 * containing block is the padding box. The pill therefore declares no horizontal
 * inset, and every value below is measured from the rail's PADDING edge — i.e. from
 * the inner track, which is exactly what the labels are laid out in.
 *
 * Pure, so the arithmetic is tested without a gesture or a DOM — see
 * `tests/ui/segmented-inside-rail.test.ts`.
 */

export interface IndicatorGeometryOptions {
  /** The rail's measured width, INCLUDING its own padding (Yoga's border box). */
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
 * The indicator's offset from the inner track's leading edge, in pixels.
 *
 * ★ MEASURED FROM THE PADDING EDGE, WHICH IS WHERE THE PILL ANCHORS.
 *
 * The pill declares no horizontal inset, so its origin is the rail's padding edge
 * — the inner track the labels are laid out in. `0` is therefore the first
 * segment's leading edge, and no `inset` is added here.
 *
 * ★ THE FIRST OPTION IS AT THE LEADING END OF THE READING DIRECTION.
 *
 * Left-to-right: the first segment starts at the inner track's left edge, so the
 * pill's left is `0`.
 *
 * Right-to-left: the rail lays its children out right-to-left, so the first
 * segment sits at the inner track's RIGHT edge and the pill's left is
 * `(trackWidth - 2·inset) - segmentWidth` — the mirror, folded in here so the
 * caller never applies a sign.
 *
 * Clamping the index means a caller that computes it differently later cannot walk
 * the pill out of the track.
 */
export function indicatorLeftFor(index: number, options: IndicatorGeometryOptions): number {
  const { trackWidth, inset, count, rtl } = options;
  const segmentWidth = segmentWidthFor({ trackWidth, inset, count });

  // Before the rail has measured there is no track to place against. The call
  // site renders the pill at `opacity: 0` in that state, so the value only has to
  // be a safe number inside the rail.
  if (segmentWidth <= 0) return 0;

  const raw = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safeIndex = Math.min(count - 1, Math.max(0, raw));

  const travel = segmentWidth * safeIndex;
  const inner = trackWidth - inset * 2;

  return rtl ? inner - segmentWidth - travel : travel;
}
