/**
 * The segmented control's labels must be readable ON the indicator.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * "Suggested times" uses the control for its List/Grid switch, and there the
 * labels were hard to read. The selected segment was painted with
 * `t.onPrimary` — the colour meant to sit on `t.primary` — and that is right for
 * the SELECTED label. But the unselected labels were `t.textMuted`, which is
 * only 4.80:1 on `surface3` and 5.47:1 on `surface2` in the dark theme, and at
 * the control's small body size that reads as grey-on-grey rather than as
 * something you can press.
 *
 * The pair has to be chosen so the selected label clears the indicator whether
 * or not the accent is dark, and the unselected one clears the rail:
 *
 *  - selected / unselected labels share the same font weight, so a reader never
 *    has to infer the choice from weight alone;
 *  - the unselected label uses `t.text` (15.52:1 on `surface2`), not `textMuted`;
 *  - the indicator's own fill is opaque, so a mid-flight slide can never show
 *    two labels half-on a translucent pill.
 *
 * ★ AND THE INDICATOR HAS TO BE WIDE ENOUGH TO READ.
 *
 * Its width comes from `trackWidth - space[1] * 2`, so if the container ever
 * reports zero the pill is not rendered at all and the selected label turns
 * into plain text on the rail — which is the other way this control loses its
 * selection cue.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('an unselected label is full-strength text, not textMuted', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act — the tint is chosen once per segment and feeds both the label and the
  // icon, so the two can never disagree about the selection.
  const tint = /const tint = isSelected \? ([^:]+): ([^;]+);/.exec(chip);

  // Assert
  assert.ok(tint, 'the segment has no conditional tint');
  const selected = (tint[1] ?? '').trim();
  const unselected = (tint[2] ?? '').trim();
  assert.match(selected, /onPrimary/, 'the selected label does not use the on-accent colour');
  assert.ok(
    /t\.text\b/.test(unselected) && !/textMuted/.test(unselected),
    `the unselected label uses ${unselected}, which is too faint on the rail`,
  );
});

test('the two label weights match, so the choice is not read from weight', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act
  const segmentLabel =
    /<Text\s+variant="body"[\s\S]{0,400}?\{option\.label\}[\s\S]{0,40}?<\/Text>/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(segmentLabel.length > 0, 'the segment label markup was not found');
  assert.ok(
    !/weight=\{/.test(segmentLabel),
    'the labels carry per-segment weights, so selection is encoded twice and inconsistently',
  );
});

test('a mid-flight slide never shows a translucent indicator', () => {
  // Arrange — the pill crosses the other label on the way, and a translucent
  // fill would leave both half-legible for the duration of the animation.
  const chip = code('src/components/ui/Chip.tsx');

  // Act — the only opacity the pill may carry is the binary measured/unmeasured
  // switch; any interpolated value would fade it mid-slide.
  const fades = /opacity:\s*(?:withTiming|interpolate|offset\.value|[a-zA-Z0-9_.]+\s*\*\s*0\.)/.test(
    chip,
  );

  // Assert
  assert.ok(!fades, 'the indicator fades, so two labels overlap unreadably');
  assert.ok(
    /backgroundColor:\s*t\.primary/.test(chip) || /backgroundColor:\s*t\.accent/.test(chip),
    'the indicator has no opaque fill',
  );
  // The one legitimate opacity is 0-or-1, never a fraction.
  assert.match(
    chip,
    /opacity:\s*segmentWidth\s*>\s*0\s*\?\s*1\s*:\s*0/,
    'the visibility gate is not a binary measured/unmeasured switch',
  );
});

test('the pill is placed from measured state, and the selection is always visible', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act / Assert
  //
  // ★ THE SLIDE WAS REMOVED, DELIBERATELY, AND THIS RECORDS WHY.
  //
  // The pill used to be positioned by a Reanimated `translateX`, which made its
  // geometry depend on the UI-runtime mapper running. On the device the rail drew
  // its track and both labels while the pill never appeared — the selection was
  // simply invisible, in both languages. Restoring a correct, always-visible pill
  // was worth more than the slide, so the position is now a plain style computed
  // from the measured rail and the resolved direction.
  //
  // What must hold now: the REST is derived from state, so a pill is always
  // correctly placed whether or not any animation runs; the slide may only ever
  // add travel on top of that rest.
  assert.ok(/indicatorLeftFor/.test(chip), 'the pill position is not computed from the geometry');
  assert.ok(/indicatorPlacement/.test(chip), 'the computed placement never reaches the pill');
  assert.ok(/indicatorStyle/.test(chip), 'the slide is no longer applied');
  // The placement and the slide are separate entries, so the slide cannot move the
  // pill away from a position that is already correct.
  const styleArray = /styles\.indicator,[\s\S]{0,600}?\]/.exec(chip)?.[0] ?? '';
  assert.ok(/indicatorPlacement/.test(styleArray), 'the placement is not in the pill style array');
  assert.ok(/indicatorStyle/.test(styleArray), 'the slide is not in the pill style array');
});

test('the indicator is hidden until the track has measured, but still rendered', () => {
  // Arrange
  const chip = code('src/components/ui/Chip.tsx');

  // Act — a zero-width pill would draw a sliver at the leading edge, so it must
  // not be VISIBLE at zero width.
  const hidden = /opacity:\s*segmentWidth\s*>\s*0\s*\?\s*1\s*:\s*0/.test(chip);

  // Assert
  //
  // ★ IT IS HIDDEN RATHER THAN NOT RENDERED, AND THAT DISTINCTION IS THE BUG.
  //
  // The pill used to be unmounted while unmeasured (`segmentWidth > 0 ? <pill/> :
  // null`). A track whose measurement never arrived therefore had NO selection at
  // all — while the rail's labels rendered normally, so it read as "the pill is
  // missing" rather than "the pill is unmeasured". Hiding it keeps a zero-width
  // pill from drawing a sliver without making its existence conditional.
  assert.ok(hidden, 'a zero-width indicator would draw a sliver at the leading edge');
  assert.doesNotMatch(
    chip,
    /segmentWidth\s*>\s*0\s*\?\s*\(?\s*<Animated\.View/,
    'the indicator is unmounted while unmeasured, so an unmeasured track has no selection',
  );
});

/**
 * ★ THE NATIVE MEASUREMENT MUST COME FROM THE LAYOUT EVENT, NOT THE DOM.
 *
 * `onLayout` was wired to a handler that began by checking
 * `typeof node.getBoundingClientRect === 'function'` and returned early when it
 * was absent. On native that is ALWAYS absent — a view is a native peer, not a DOM
 * element — so every layout event was received and discarded, `trackWidth` stayed
 * at zero, and every segmented control in the app rendered its labels with no
 * selection pill at all.
 *
 * Measured on the emulator: 0 pill pixels in both languages, before and after a
 * fresh launch, while the labels laid out correctly.
 */
/**
 * ★ RN MIRRORS A HORIZONTAL OFFSET IN A RIGHT-TO-LEFT PARENT.
 *
 * `indicatorLeftFor` returns the pill's physical LEFT edge, which is what a
 * left-to-right layout wants. In a right-to-left layout React Native mirrors it,
 * so the same number lands 185.7 from the RIGHT instead — measured on the device
 * as the pill covering the OPPOSITE option from the selected one, while the
 * logged offset was correct.
 *
 * The placement therefore converts to the equivalent distance from the right edge
 * and names that side explicitly, so the number and the edge always agree.
 */
test('the pill names the physical side it measures from, in both directions', () => {
  const chip = code('src/components/ui/Chip.tsx');

  // Assert — RTL computes from the right edge, LTR from the left.
  assert.match(
    chip,
    /right:\s*trackWidth\s*-\s*\(\s*restingOffset\s*\+\s*segmentWidth\s*\)/,
    'the RTL placement does not convert the left edge into a right-edge distance',
  );
  assert.match(chip, /left:\s*restingOffset/, 'the LTR placement does not use the left edge');
});

test('the rail measures from the layout event on native, not from a DOM read', () => {
  const chip = code('src/components/ui/Chip.tsx');

  // Assert — `onLayout` reads its own event.
  assert.match(
    chip,
    /onLayout=\{\(event\)\s*=>\s*recordWidth\(event\.nativeEvent\.layout\.width\)\}/,
    'onLayout does not read the layout event it is given',
  );
  // ...and the DOM read is a SEPARATE handler, so it can never swallow the event.
  assert.doesNotMatch(
    chip,
    /onLayout=\{measureFromNode\}/,
    'onLayout is wired to the DOM-only reader, which returns early on native',
  );
});
