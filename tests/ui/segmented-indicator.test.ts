/**
 * The segmented control's indicator must stay inside its rail, and must sit over
 * the OPTION THAT IS SELECTED, in both directions.
 *
 * ★ THE DEFECTS THIS PINS — TWO, AND THE SECOND SHIPPED ALONE.
 *
 * 1. `2b11784`-era: the indicator was anchored with `insetInlineStart: space[1]`
 *    and then moved by a POSITIVE `translateX` of `segmentWidth * index`. That is
 *    only correct when the rail's inline-start edge is its physical left edge. It
 *    is not: `app/+html.tsx` sets `dir="rtl"` on `<html>`, so react-native-web
 *    compiles the inset to `inset-inline-start`, which resolves against the RIGHT
 *    edge — and the pill was then translated further out of the rail. Observable as
 *    the Settings theme control's selection hanging off the end of the track.
 *
 * 2. The shipped one: the pill was placed with a `{ right }` object under RTL over
 *    a base style that already declared `left: 0`. React Native MERGES those, so
 *    the node carried both keys and CSS gave `left` precedence — the mirror was
 *    silently discarded. Rendered evidence, before the fix:
 *
 *      en: style="…;left:4px;transform:translateX(0px)"
 *      fa: style="…;right:-4px;transform:translateX(0px)"
 *
 *    With `left` winning, an RTL rail's first segment sits at its RIGHT end while
 *    the pill was laid out from the left, so index 1 of 3 (Settings' `Auto`) was
 *    drawn over `Light`. That is the report exactly.
 *
 * ★ AND THE ORIGIN IS THE RAIL'S PADDING BOX.
 *
 * The rail is `position: relative` with `padding: space[1]`, so an absolute
 * child's `left: 0` is the rail's PADDING edge, not its border edge. Adding
 * `inset` to every offset (which the arithmetic used to) spent the padding twice
 * and left a matching gap at the far end — "the pill has an extra offset and the
 * group has no padding on the sides".
 *
 * ★ THE ARITHMETIC IS EXTRACTED SO THIS CAN BE TESTED WITHOUT A GESTURE OR A DOM.
 *
 * `indicatorLeftFor` / `indicatorPlacementFor` are the whole geometry.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const RAIL_INSET = 4;
const TRACK = 300;
const COUNT = 3;

/** The inner track, which is what the segments divide. */
const INNER = TRACK - RAIL_INSET * 2;

/** One segment's width. */
const SEGMENT = INNER / COUNT;

/**
 * The pill's physical bounds, from the geometry module.
 *
 * Loaded lazily so a missing export fails in the first test rather than at import
 * time, which would collapse the whole file into one opaque error.
 */
async function boundsFor(
  index: number,
  options: { rtl: boolean; track?: number; count?: number },
) {
  const geometry = await import('@/src/components/ui/segmented-geometry');
  const trackWidth = options.track ?? TRACK;
  const count = options.count ?? COUNT;

  const segmentWidth = geometry.segmentWidthFor({ trackWidth, inset: RAIL_INSET, count });
  const left = geometry.indicatorLeftFor(index, {
    trackWidth,
    inset: RAIL_INSET,
    count,
    rtl: options.rtl,
  });

  return { left, right: left + segmentWidth, segmentWidth };
}

test('the geometry module exports its three functions', async () => {
  const geometry = await import('@/src/components/ui/segmented-geometry');
  assert.equal(typeof geometry.indicatorLeftFor, 'function', 'indicatorLeftFor is not a function');
  assert.equal(typeof geometry.segmentWidthFor, 'function', 'segmentWidthFor is not a function');
  assert.equal(
    typeof geometry.indicatorPlacementFor,
    'function',
    'indicatorPlacementFor is not a function',
  );
});

test('LTR: the indicator walks forward, one segment per index', async () => {
  assert.equal((await boundsFor(0, { rtl: false })).left, 0);
  assert.ok(Math.abs((await boundsFor(1, { rtl: false })).left - SEGMENT) < 0.001);
  assert.ok(Math.abs((await boundsFor(2, { rtl: false })).left - SEGMENT * 2) < 0.001);
});

test('RTL: the first option is against the inner RIGHT edge', async () => {
  const first = await boundsFor(0, { rtl: true });

  // Assert — the rail's first segment sits at its right end in a right-to-left
  // layout, so index 0's right edge is the rail's inner right edge.
  assert.ok(
    Math.abs(first.right - INNER) < 0.001,
    `RTL index 0 ends at ${first.right}, expected ${INNER}`,
  );
  assert.ok(
    Math.abs(first.left - (INNER - SEGMENT)) < 0.001,
    `RTL index 0 starts at ${first.left}`,
  );
});

test('RTL: a middle option is over the MIDDLE segment, not the far one', async () => {
  // Arrange — this is the reported case. `Auto` is index 1 of 3 on the theme
  // control; with `left` winning over `right` it was drawn over index 0.
  const middle = await boundsFor(1, { rtl: true });

  // Assert
  assert.ok(
    Math.abs(middle.left - (INNER - SEGMENT * 2)) < 0.001,
    `RTL index 1 starts at ${middle.left}, expected ${INNER - SEGMENT * 2}`,
  );
  assert.ok(
    Math.abs(middle.right - (INNER - SEGMENT)) < 0.001,
    `RTL index 1 ends at ${middle.right}, expected ${INNER - SEGMENT}`,
  );
});

test('RTL: the last segment still sits fully inside the rail', async () => {
  // Arrange — index 2 is where the theme control's selection was seen hanging off
  // the end of the track in the screenshot.
  const last = await boundsFor(2, { rtl: true });

  // Assert
  assert.ok(last.left >= -0.001, `the pill starts at ${last.left}, outside the track`);
  assert.ok(
    last.right <= INNER + 0.001,
    `the pill ends at ${last.right}, past the rail's inner edge (${INNER})`,
  );
});

test('LTR: every segment sits fully inside the track, with no double inset', async () => {
  for (const index of [0, 1, 2]) {
    const bounds = await boundsFor(index, { rtl: false });
    assert.ok(bounds.left >= -0.001, `LTR ${index}: left edge ${bounds.left}`);
    assert.ok(bounds.right <= INNER + 0.001, `LTR ${index}: right edge ${bounds.right}`);
  }

  // Assert — and the FIRST option starts flush at the track's leading edge. Adding
  // `inset` here is what spent the padding twice.
  assert.equal((await boundsFor(0, { rtl: false })).left, 0, 'the first pill is inset twice');
});

test('RTL: every segment sits fully inside the rail', async () => {
  for (const index of [0, 1, 2]) {
    const bounds = await boundsFor(index, { rtl: true });
    assert.ok(bounds.left >= -0.001, `RTL ${index}: left edge ${bounds.left}`);
    assert.ok(bounds.right <= INNER + 0.001, `RTL ${index}: right edge ${bounds.right}`);
  }
});

test('the two directions are mirror images of each other', async () => {
  // Arrange — a mirrored layout puts option `index` the same distance from its own
  // reading-start edge, so the physical edges must add up to the inner width.
  for (const index of [0, 1, 2]) {
    const ltr = await boundsFor(index, { rtl: false });
    const rtl = await boundsFor(index, { rtl: true });

    // Assert
    assert.ok(
      Math.abs(ltr.left + rtl.right - INNER) < 0.001,
      `index ${index}: ${ltr.left} and ${rtl.right} are not mirror positions`,
    );
  }
});

test('an out-of-range index is clamped rather than leaving the rail', async () => {
  // Arrange — `selectedIndex` already clamps, so this guards a caller that computes
  // it differently later.
  const beyondRtl = await boundsFor(9, { rtl: true });
  const beyondLtr = await boundsFor(9, { rtl: false });
  const below = await boundsFor(-3, { rtl: false });

  // Assert — clamping lands on the LAST option, whose physical edge depends on the
  // direction: the far end of the track in LTR, the near end in RTL.
  assert.ok(beyondRtl.left >= -0.001, `over-large RTL index escapes: ${beyondRtl.left}`);
  assert.ok(
    Math.abs(beyondLtr.right - INNER) < 0.001,
    `clamping did not hold at the LTR far end: ${beyondLtr.right}`,
  );
  assert.ok(
    Math.abs(beyondRtl.left) < 0.001,
    `clamping did not hold at the RTL far end: ${beyondRtl.left}`,
  );
  assert.ok(below.left >= -0.001, `negative index escapes: ${below.left}`);
  assert.equal(below.left, 0, 'a negative index did not clamp to the first option');
});

test('an unmeasured rail produces no travel', async () => {
  // Arrange — `onLayout` has not fired yet on the first render.
  const geometry = await import('@/src/components/ui/segmented-geometry');

  // Assert — the pill renders at `opacity: 0` in this state, so the value only has
  // to be a safe number inside the rail rather than the measured-segment answer.
  assert.equal(geometry.segmentWidthFor({ trackWidth: 0, inset: RAIL_INSET, count: COUNT }), 0);
  assert.equal(
    geometry.indicatorLeftFor(2, { trackWidth: 0, inset: RAIL_INSET, count: COUNT, rtl: true }),
    0,
  );
});

/* ── The placement pair ──────────────────────────────────────────────────── */

test('LTR: the placement anchors LEFT and parks the right side', async () => {
  const geometry = await import('@/src/components/ui/segmented-geometry');

  // Act
  const placement = geometry.indicatorPlacementFor(1, {
    trackWidth: TRACK,
    inset: RAIL_INSET,
    count: COUNT,
    rtl: false,
  });

  // Assert
  assert.equal(placement.right, 'auto', 'the LTR pill also declares a right offset');
  assert.ok(Math.abs((placement.left as number) - SEGMENT) < 0.001);
});

test('RTL: the placement anchors RIGHT and parks the left side', async () => {
  const geometry = await import('@/src/components/ui/segmented-geometry');

  // Act
  const placement = geometry.indicatorPlacementFor(1, {
    trackWidth: TRACK,
    inset: RAIL_INSET,
    count: COUNT,
    rtl: true,
  });

  // Assert — ★ BOTH keys are emitted every time, and the unused one is `auto`.
  //
  // The shipped bug was a `{ right }` object over a base `left: 0`: React Native
  // merges them, the node ends up with both, and CSS gives `left` precedence. A
  // pair that always names both is the only shape that cannot disagree.
  assert.equal(placement.left, 'auto', 'the RTL pill still declares a left offset');
  assert.ok(
    Math.abs((placement.right as number) - (INNER - SEGMENT * 2)) < 0.001,
    `RTL index 1 rests ${placement.right} from the right edge`,
  );
});

test('the placement pair always names both sides', async () => {
  // Arrange
  const geometry = await import('@/src/components/ui/segmented-geometry');

  for (const rtl of [false, true]) {
    for (const index of [0, 1, 2]) {
      // Act
      const placement = geometry.indicatorPlacementFor(index, {
        trackWidth: TRACK,
        inset: RAIL_INSET,
        count: COUNT,
        rtl,
      });

      // Assert
      assert.ok('left' in placement, `rtl=${rtl} ${index}: no left key`);
      assert.ok('right' in placement, `rtl=${rtl} ${index}: no right key`);

      const parked = [placement.left, placement.right].filter((value) => value === 'auto');
      assert.equal(parked.length, 1, `rtl=${rtl} ${index}: both sides are anchored`);
    }
  }
});

test('the placement and the bounds agree in both directions', async () => {
  // Arrange — the physical distance from the right edge that `indicatorLeftFor`
  // implies must be the number `indicatorPlacementFor` hands the `right` key.
  const geometry = await import('@/src/components/ui/segmented-geometry');

  for (const rtl of [false, true]) {
    for (const index of [0, 1, 2]) {
      // Act
      const bounds = await boundsFor(index, { rtl });
      const placement = geometry.indicatorPlacementFor(index, {
        trackWidth: TRACK,
        inset: RAIL_INSET,
        count: COUNT,
        rtl,
      });

      // Assert
      const fromRight = rtl ? (placement.right as number) : (placement.left as number);
      const expectedFromRight = rtl ? INNER - bounds.right : bounds.left;
      assert.ok(
        Math.abs(fromRight - expectedFromRight) < 0.001,
        `rtl=${rtl} ${index}: placement says ${fromRight}, bounds say ${expectedFromRight}`,
      );
    }
  }
});

/* ── Source constraints ──────────────────────────────────────────────────── */

test('the control subscribes to the direction, and asks no platform manager', () => {
  // Arrange — two separate mistakes are possible here and both shipped:
  //
  //  - `I18nManager.isRTL` is a hardcoded `false` stub on react-native-web, and on
  //    native it only changes after an OS restart — so reading it reintroduces the
  //    bug on one platform or the other.
  //  - `isRtlLayout(i18n.language)` returns the right ANSWER but does not
  //    re-render the component when the direction changes under it, so the pill
  //    keeps RTL geometry on an LTR rail and sits over the wrong option —
  //    "clicking the right button activates the left one".
  const chip = code('src/components/ui/Chip.tsx');

  // Assert
  assert.ok(
    /useLayoutDirection\(\)/.test(chip),
    'the segmented control does not subscribe to the direction',
  );
  assert.ok(
    !/I18nManager/.test(chip),
    'the segmented control reads I18nManager, which is always LTR on web',
  );
  assert.ok(
    !/isRtlLayout\(i18n\.language\)/.test(chip),
    'the segmented control snapshots the direction from the render-time locale',
  );
});

test('the indicator is anchored physically, so no inline-prop can flip it', () => {
  // Arrange — `insetInlineStart` is what made the anchor direction-dependent in the
  // first place, and it cannot be corrected by the offset alone.
  const chip = code('src/components/ui/Chip.tsx');

  // Assert
  assert.ok(
    !/insetInline(Start|End)/.test(chip),
    'the indicator or rail still uses a logical inline inset',
  );
  assert.ok(
    /indicatorLeftFor\(/.test(chip),
    'the control does not use the shared geometry, so the two paths can drift',
  );
});

test('the base indicator style declares no horizontal anchor of its own', () => {
  // Arrange — ★ THIS IS THE RTL DEFECT ITSELF.
  //
  // A `left` in the base is merged with, not replaced by, the call site's offset.
  // A node with both `left` and `right` resolves `left` first, so the mirror is
  // discarded and the pill anchors on the wrong edge in Persian.
  const chip = code('src/components/ui/Chip.tsx');
  const indicator = /indicator:\s*\{([\s\S]*?)\n {2}\},/.exec(chip)?.[1] ?? '';

  // Assert
  assert.ok(indicator.length > 0, 'the indicator style block is missing');
  assert.doesNotMatch(indicator, /(^|\s)left:\s*0/, 'the base style still declares `left`');
  assert.doesNotMatch(indicator, /(^|\s)right:\s*\d/, 'the base style declares `right`');
});

test('the slide interpolates the position itself, with no extra direction sign', () => {
  // Arrange — ★ THE DELTA IS GONE ENTIRELY, AND THAT IS THE FIX.
  //
  // The pill used to animate a `translateX` delta on top of a `left` that was
  // rewritten in style on the same commit. Two assignments to the shared value in
  // one block meant the travel was discarded before a frame rendered, so the pill
  // teleported and then settled from an overshoot. The position is the animated
  // value now, so there is no delta and no sign to get wrong.
  const chip = code('src/components/ui/Chip.tsx');

  // Act
  const animatesPosition = /animatedLeft\.value\s*=\s*withTiming\(/.test(chip);
  const hasDelta = /const delta\s*=/.test(chip);

  // Assert
  assert.ok(animatesPosition, 'the position is never interpolated, so the pill cannot slide');
  assert.equal(hasDelta, false, 'a transform delta is still applied on top of a styled position');
});
