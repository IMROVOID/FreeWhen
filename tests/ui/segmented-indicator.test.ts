/**
 * The segmented control's indicator must stay inside its rail in both directions.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * The indicator was positioned with `insetInlineStart: space[1]` and then moved by
 * a POSITIVE `translateX` of `segmentWidth * index`. That is only correct when the
 * rail's inline-start edge is its physical left edge. It is not: `app/+html.tsx`
 * sets `dir="rtl"` on `<html>`, so react-native-web compiles the inset to
 * `inset-inline-start`, which resolves against the RIGHT edge — and the pill is then
 * translated further right-to-left out of the rail.
 *
 * The observable result was the Settings theme control with its selection pill
 * hanging off the end of the track (dark theme, middle option drawn at the far
 * right and clipped). The same control is used for the language switch, the
 * List/Grid switch on "Suggested times", and the proposal type segment, so the
 * bug was on every one of them in a Persian layout.
 *
 * ★ THE ARITHMETIC IS EXTRACTED SO THIS CAN BE TESTED WITHOUT A GESTURE OR A DOM.
 *
 * `indicatorOffsetFor` is the whole geometry. Everything below calls it directly.
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

test('the geometry module exists and exports its two functions', async () => {
  const geometry = await import('@/src/components/ui/segmented-geometry');
  assert.equal(typeof geometry.indicatorLeftFor, 'function', 'indicatorLeftFor is not a function');
  assert.equal(typeof geometry.segmentWidthFor, 'function', 'segmentWidthFor is not a function');
});

test('LTR: the indicator walks forward, one segment per index', async () => {
  const segmentWidth = (TRACK - RAIL_INSET * 2) / COUNT;

  assert.equal((await boundsFor(0, { rtl: false })).left, RAIL_INSET);
  assert.ok(Math.abs((await boundsFor(1, { rtl: false })).left - (RAIL_INSET + segmentWidth)) < 0.001);
  assert.ok(Math.abs((await boundsFor(2, { rtl: false })).left - (RAIL_INSET + segmentWidth * 2)) < 0.001);
});

test('RTL: the first option is against the physical RIGHT edge', async () => {
  const segmentWidth = (TRACK - RAIL_INSET * 2) / COUNT;
  const first = await boundsFor(0, { rtl: true });

  // Assert — the rail's first segment sits at its right end in a right-to-left
  // layout, so index 0's right edge is the rail's inner right edge.
  assert.ok(
    Math.abs(first.right - (TRACK - RAIL_INSET)) < 0.001,
    `RTL index 0 ends at ${first.right}, expected ${TRACK - RAIL_INSET}`,
  );
  assert.ok(
    Math.abs(first.left - (TRACK - RAIL_INSET - segmentWidth)) < 0.001,
    `RTL index 0 starts at ${first.left}`,
  );
});

test('RTL: the last segment still sits fully inside the rail', async () => {
  // Arrange — index 2 is where the theme control's selection was seen hanging off
  // the end of the track in the screenshot.
  const last = await boundsFor(2, { rtl: true });

  // Assert
  assert.ok(
    last.left >= RAIL_INSET - 0.001,
    `the pill starts at ${last.left}, inside the rail's own inset (${RAIL_INSET})`,
  );
  assert.ok(
    last.right <= TRACK - RAIL_INSET + 0.001,
    `the pill ends at ${last.right}, past the rail's inner edge (${TRACK - RAIL_INSET})`,
  );
});

test('LTR: every segment sits fully inside the rail', async () => {
  for (const index of [0, 1, 2]) {
    const bounds = await boundsFor(index, { rtl: false });
    assert.ok(bounds.left >= RAIL_INSET - 0.001, `LTR ${index}: left edge ${bounds.left}`);
    assert.ok(bounds.right <= TRACK - RAIL_INSET + 0.001, `LTR ${index}: right edge ${bounds.right}`);
  }
});

test('RTL: every segment sits fully inside the rail', async () => {
  for (const index of [0, 1, 2]) {
    const bounds = await boundsFor(index, { rtl: true });
    assert.ok(bounds.left >= RAIL_INSET - 0.001, `RTL ${index}: left edge ${bounds.left}`);
    assert.ok(bounds.right <= TRACK - RAIL_INSET + 0.001, `RTL ${index}: right edge ${bounds.right}`);
  }
});

test('the two directions are mirror images of each other', async () => {
  // Arrange — a mirrored layout puts option `index` the same distance from its own
  // reading-start edge, so the physical edges must add up to the inner width.
  const inner = TRACK - RAIL_INSET * 2;

  for (const index of [0, 1, 2]) {
    const ltr = await boundsFor(index, { rtl: false });
    const rtl = await boundsFor(index, { rtl: true });

    // Assert
    assert.ok(
      Math.abs(ltr.left - RAIL_INSET + (rtl.right - RAIL_INSET) - inner) < 0.001,
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
  // direction: the far right in LTR, the far left in RTL.
  assert.ok(beyondRtl.left >= RAIL_INSET - 0.001, `over-large RTL index escapes: ${beyondRtl.left}`);
  assert.ok(
    Math.abs(beyondLtr.right - (TRACK - RAIL_INSET)) < 0.001,
    `clamping did not hold at the LTR far end: ${beyondLtr.right}`,
  );
  assert.ok(
    Math.abs(beyondRtl.left - RAIL_INSET) < 0.001,
    `clamping did not hold at the RTL far end: ${beyondRtl.left}`,
  );
  assert.ok(below.left >= RAIL_INSET - 0.001, `negative index escapes: ${below.left}`);
  assert.ok(
    Math.abs(below.left - RAIL_INSET) < 0.001,
    `a negative index did not clamp to the first option: ${below.left}`,
  );
});

test('an unmeasured rail produces no travel', async () => {
  // Arrange — `onLayout` has not fired yet on the first render.
  const geometry = await import('@/src/components/ui/segmented-geometry');

  // Assert
  assert.equal(geometry.segmentWidthFor({ trackWidth: 0, inset: RAIL_INSET, count: COUNT }), 0);
  assert.equal(
    geometry.indicatorLeftFor(2, { trackWidth: 0, inset: RAIL_INSET, count: COUNT, rtl: true }),
    RAIL_INSET,
  );
});

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
    /indicatorLeftFor/.test(chip),
    'the control does not use the shared geometry, so the two paths can drift',
  );
});
