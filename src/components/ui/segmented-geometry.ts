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
 * The indicator's left edge, in the rail's own coordinate space.
 *
 * ★ THE FIRST OPTION IS AT THE PHYSICAL LEFT IN LTR AND THE PHYSICAL RIGHT IN RTL.
 *
 * A right-to-left rail lays its first segment against its right edge, which is why
 * the offset subtracts rather than adds there. Clamping the index means a caller
 * that computes it differently later cannot walk the pill out of the track.
 */
export function indicatorLeftFor(index: number, options: IndicatorGeometryOptions): number {
  const { trackWidth, inset, count, rtl } = options;
  const segmentWidth = segmentWidthFor({ trackWidth, inset, count });

  if (segmentWidth <= 0) return inset;

  const raw = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safeIndex = Math.min(count - 1, Math.max(0, raw));

  const travel = segmentWidth * safeIndex;

  return rtl ? inset + ((trackWidth - inset * 2) - segmentWidth - travel) : inset + travel;
}
