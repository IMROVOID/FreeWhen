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

test('the geometry module exports its two functions', async () => {
  const geometry = await import('@/src/components/ui/segmented-geometry');

  // Assert — the numeric behaviour lives in `segmented-inside-rail.test.ts`, which
  // encodes the border-edge origin Yoga actually uses. This file keeps only the
  // source constraints, which that file cannot check.
  assert.equal(typeof geometry.indicatorLeftFor, 'function', 'indicatorLeftFor is not a function');
  assert.equal(typeof geometry.segmentWidthFor, 'function', 'segmentWidthFor is not a function');
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

test('the indicator is positioned by a transform, not by a layout inset', () => {
  // Arrange — every LAYOUT inset is mirrored by the layout direction, which is what
  // made the anchor direction-dependent in the first place: `insetInlineStart`
  // resolves against the document, an explicit `left` becomes the inline-END inset
  // in an RTL parent, and a nonzero inset would be measured from a different origin
  // on native than on the web.
  //
  // The pill therefore anchors at the rail's leading corner with a ZERO inset (the
  // one value that means the same thing on every origin) and the whole position is
  // an animated `translateX`, which no direction mirrors.
  const chip = code('src/components/ui/Chip.tsx');

  // Assert — no NONZERO logical inset, because that is what would flip or move.
  assert.doesNotMatch(
    chip,
    /insetInline(Start|End):\s*space\[/,
    'the indicator is anchored at a nonzero logical inset, which the direction flips',
  );
  assert.ok(
    /indicatorLeftFor\(/.test(chip),
    'the control does not use the shared geometry, so the two paths can drift',
  );
  assert.ok(
    /translateX:\s*animatedOffset\.value/.test(chip),
    'the position is not carried by a direction-independent transform',
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
  const animatesPosition = /animatedOffset\.value\s*=\s*withTiming\(/.test(chip);
  const hasDelta = /const delta\s*=/.test(chip);

  // Assert
  assert.ok(animatesPosition, 'the position is never interpolated, so the pill cannot slide');
  assert.equal(hasDelta, false, 'a transform delta is still applied on top of a styled position');
});
