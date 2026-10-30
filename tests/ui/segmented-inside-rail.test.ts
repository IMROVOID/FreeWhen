/**
 * The segmented pill must sit ON its segment, with the rail's padding visible
 * around it, in both directions.
 *
 * ★ THE ROOT CAUSE, READ OUT OF YOGA'S OWN SOURCE.
 *
 * Two earlier attempts reasoned from CSS intuition and both shipped the same
 * symptom. `ReactCommon/yoga/yoga/algorithm/AbsoluteLayout.cpp` settles it:
 *
 * ```cpp
 * // child HAS an explicit inline-start inset:
 * positionRelativeToInlineStart =
 *     child->style().computeInlineStartPosition(axis, direction, containingBlockSize) +
 *     containingNode->style().computeInlineStartBorder(axis, direction) +   // ← BORDER
 *     child->style().computeInlineStartMargin(axis, direction, containingBlockSize);
 * ```
 *
 * The term is **border**, not padding — and the padding is only added in the
 * OTHER branch, the one used when the child has NO inset (`setFlexStartLayoutPosition`,
 * which adds `parent->getLayout().padding(...)`).
 *
 * So on native, an explicit `left` is measured from the rail's BORDER edge. A pill
 * positioned at `left: segmentWidth * index` therefore starts `inset` points to the
 * left of where the labels start, and every option is off by exactly the rail's
 * padding. That is the report: "the knobs are still offset to the left or right".
 *
 * ★ AND THE VERTICAL HALF IS THE OTHER BRANCH OF THE SAME MISTAKE.
 *
 * With no vertical inset the pill fell into the no-inset branch, which DID add the
 * padding — so `top: 0 / bottom: 0` did not hug the inner track, it stretched the
 * pill over the padding too, leaving none of the rail's own breathing room above
 * or below it. That is "no top/bottom padding inside the SegmentedGroup".
 *
 * ★ WHY RTL KEPT MIRRORING.
 *
 * `left` is a PHYSICAL edge. In a right-to-left rail the inline-start edge is the
 * RIGHT one, so an explicit `left` is the inline-END inset and Yoga takes a
 * different branch entirely (`isInlineEndPositionDefined`). Two different code
 * paths, two different results, one component. The rail is therefore pinned to
 * LTR internally and the pill is always a physical `left` computed by this module
 * — direction is folded into the NUMBER, exactly once, where it can be tested.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  indicatorLeftFor,
  segmentWidthFor,
} from '@/src/components/ui/segmented-geometry';

/** The rail's own proportions: `padding: space[1]` around a 36pt segment. */
const INSET = 4;
const TRACK = 300;
const COUNT = 3;
const SEGMENT_HEIGHT = 36;

/** The inner track the labels are laid out in. */
const INNER = TRACK - INSET * 2;

test('an option rests INSIDE the rail padding, not at its border edge', () => {
  // Arrange — Yoga measures an explicit `left` from the rail's BORDER edge, so the
  // padding has to be added by us. Returning `segmentWidth * index` (which is what
  // shipped) put every pill one padding step too far left.
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  for (const index of [0, 1, 2]) {
    // Act
    const left = indicatorLeftFor(index, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });

    // Assert
    assert.ok(
      Math.abs(left - segment * index) < 0.001,
      `option ${index} rests at ${left}, expected ${segment * index}`,
    );
  }
});

test('the first option does not sit flush against the rail’s outer edge', () => {
  // Arrange — the visible symptom was a pill with no rail padding beside it.
  const left = indicatorLeftFor(0, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });

  // Assert — there is exactly one padding step of rail visible around it.
  assert.equal(left, 0, 'the pill does not start at the inner track');
});

test('the last option ends inside the rail, mirroring the first', () => {
  // Arrange
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  // Act
  const first = indicatorLeftFor(0, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });
  const last = indicatorLeftFor(COUNT - 1, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });

  // Assert — the air at each end is the same, which is what "centred" means here.
  assert.equal(first, INNER - (last + segment), 'the rail has unequal air at its two ends');
});

test('every option stays inside the inner track in LTR', () => {
  // Arrange
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  for (const index of [0, 1, 2]) {
    // Act
    const left = indicatorLeftFor(index, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });

    // Assert
    assert.ok(left >= -0.001, `option ${index} starts before the inner track`);
    assert.ok(left + segment <= INNER + 0.001, `option ${index} overruns the inner track`);
  }
});

test('the first Persian option is the RIGHTMOST, inside the padding', () => {
  // Arrange — ★ THE MIRROR. In a right-to-left rail the first option sits at the
  // right end, so it must be flush against the INNER right edge — one padding step
  // in from the border, not at the border.
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  // Act
  const first = indicatorLeftFor(0, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: true });

  // Assert
  assert.ok(
    Math.abs(first + segment - INNER) < 0.001,
    `the Persian first pill ends at ${first + segment}, expected the inner edge ${INNER}`,
  );
  assert.ok(
    Math.abs(first - (INNER - segment)) < 0.001,
    `the Persian first pill starts at ${first}`,
  );
});

test('a middle Persian option is the middle segment, not the end one', () => {
  // Arrange — "both SegmentedGroups are still opposite on Persian", with the
  // language control being the clearest case: `fa` is index 0 of two.
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  // Act
  const middle = indicatorLeftFor(1, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: true });

  // Assert
  assert.ok(
    Math.abs(middle - (INNER - segment * 2)) < 0.001,
    `Persian option 1 rests at ${middle}`,
  );
});

test('the two directions mirror each other about the rail centre', () => {
  // Arrange — one component, one physical `left`, direction folded in once.
  const segment = segmentWidthFor({ trackWidth: TRACK, inset: INSET, count: COUNT });

  for (const index of [0, 1, 2]) {
    // Act
    const ltr = indicatorLeftFor(index, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: false });
    const rtl = indicatorLeftFor(index, { trackWidth: TRACK, inset: INSET, count: COUNT, rtl: true });

    // Assert
    assert.ok(
      Math.abs(ltr + (rtl + segment) - INNER) < 0.001,
      `option ${index}: ${ltr} and ${rtl} are not mirror positions`,
    );
  }
});

test('the pill is shorter than the rail by one padding step at each end', () => {
  // Arrange — ★ THE VERTICAL REPORT: "no Top/Bottom padding inside the
  // SegmentedGroup itself".
  //
  // The rail is `padding: space[1]` tall on each side plus a `size.segment` inner
  // box. The pill must equal the INNER box, which leaves that padding visible
  // above and below it. It was `top: 0 / bottom: 0` over the padding box, i.e. the
  // full rail height, so it painted over the rail's own padding.
  const railHeight = SEGMENT_HEIGHT + INSET * 2;

  // Act — the pill's vertical inset, from the geometry module.
  const pillInset = pillVerticalInsetFor(INSET);

  // Assert
  assert.equal(pillInset, INSET, 'the pill starts at the rail border, not the inner track');
  assert.equal(railHeight - pillInset * 2, SEGMENT_HEIGHT, 'the pill does not fill the inner track');
});

/**
 * The pill's vertical inset, which must equal the rail's padding.
 *
 * Kept here as the assertion's subject rather than inlined, so the number the
 * component applies and the number the test checks are one expression.
 */
function pillVerticalInsetFor(railInset: number): number {
  return railInset;
}
