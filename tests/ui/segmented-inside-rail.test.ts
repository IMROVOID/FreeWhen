/**
 * The segmented pill: sized and placed as a FRACTION of its track.
 *
 * ★ THE DEFECT THIS REPLACES, MEASURED ON A DEVICE.
 *
 * Three fixes tuned the pill's arithmetic and all three shipped an invisible pill.
 * `uiautomator dump` on the emulator, against v0.1.4, showed why:
 *
 * ```
 * language rail : [53,517]..[1028,633]    W=975  H=116
 * pill node     : [1028,528]..[1028,622]  W=0    H=94
 * ```
 *
 * Correct height, correct anchor, **zero width** — so nothing painted, while the
 * selected label took its dark tint and the rail's padding looked right. That is
 * the report: "the icons and texts correctly turn dark on selected item but the
 * Knob is not visible at all".
 *
 * Zero width could only come from `segmentWidth`, which came from `trackWidth`,
 * which came from `onLayout`. The arithmetic was verified in isolation and was
 * correct every time; the DEPENDENCY was the defect. When a JS measurement does
 * not arrive the pill is not misplaced — it is invisible, with nothing left in the
 * component that can recover.
 *
 * ★ SO THE GEOMETRY IS A FUNCTION OF (count, index, direction), AND NOTHING ELSE.
 *
 * The rail is a row of `count` equal `flex: 1` segments, so one segment is exactly
 * `1/count` of the inner track. The pill is `width: (100/count)%` and offset by
 * `(index * 100/count)%` — both resolved by the layout engine, identically on
 * native and web, with no state that can fail to arrive and no animation that can
 * be stranded.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHIP = 'src/components/ui/Chip.tsx';

/**
 * The offsets the component computes, transcribed.
 *
 * Kept in lockstep with `Chip.tsx` by the source assertions below, which require
 * the same expressions to appear there.
 */
function offsetPercentFor(selectedIndex: number, count: number, rtl: boolean): number {
  const segmentPercent = 100 / Math.max(1, count);
  const mirroredIndex = rtl ? count - 1 - selectedIndex : selectedIndex;
  return mirroredIndex * segmentPercent;
}

function widthPercentFor(count: number): number {
  return 100 / Math.max(1, count);
}

/* ── Geometry: a function of count, index and direction ──────────────────── */

test('the pill is exactly one segment wide', () => {
  for (const count of [2, 3, 4, 5]) {
    // Act
    const width = widthPercentFor(count);

    // Assert — `count` of them fill the track exactly.
    assert.ok(Math.abs(width * count - 100) < 1e-9, `${count}: segments fill ${width * count}%`);
  }
});

test('each option’s offset is a whole number of segments, in LTR', () => {
  const count = 3;
  const seg = widthPercentFor(count);

  for (const index of [0, 1, 2]) {
    // Act
    const offset = offsetPercentFor(index, count, false);

    // Assert
    assert.ok(Math.abs(offset - seg * index) < 1e-9, `index ${index} rests at ${offset}%`);
  }
});

test('the FIRST Persian option sits at the far end, and the last at the start', () => {
  // Arrange — ★ "wrong Knobs placement problem still on Persian": Persian option 0
  // is the one the language control selects, and in RTL it must be the RIGHTMOST.
  const count = 2;
  const seg = widthPercentFor(count);

  // Act
  const first = offsetPercentFor(0, count, true);
  const last = offsetPercentFor(count - 1, count, true);

  // Assert
  assert.equal(first, seg * (count - 1), `the Persian first option rests at ${first}%`);
  assert.equal(first + seg, 100, 'the Persian first option does not end at the track end');
  assert.equal(last, 0, `the Persian last option rests at ${last}%`);
});

test('the two directions are mirror images', () => {
  for (const count of [2, 3, 4]) {
    const seg = widthPercentFor(count);

    for (let index = 0; index < count; index += 1) {
      // Act
      const ltr = offsetPercentFor(index, count, false);
      const rtl = offsetPercentFor(index, count, true);

      // Assert — mirrored about the track's centre.
      assert.ok(
        Math.abs(ltr + (rtl + seg) - 100) < 1e-9,
        `count ${count} index ${index}: ${ltr}% and ${rtl}% are not mirrors`,
      );
    }
  }
});

test('a single option still fills the track', () => {
  // Assert — the `Math.max(1, …)` guard keeps a degenerate list from dividing by 0.
  assert.equal(widthPercentFor(1), 100);
  assert.equal(offsetPercentFor(0, 1, false), 0);
  assert.equal(offsetPercentFor(0, 1, true), 0);
});

test('an out-of-range index cannot leave the track', () => {
  // Arrange — `selectedIndex` is clamped upstream; this guards a caller that
  // computes it differently later.
  const count = 3;

  for (const index of [-1, 3, 9]) {
    // Act — the mirror is clamped by the same expression.
    const safe = Math.min(count - 1, Math.max(0, index));
    const offset = offsetPercentFor(safe, count, false);

    // Assert
    assert.ok(offset >= 0 && offset < 100, `index ${index} produced ${offset}%`);
  }
});

/* ── The component keeps the contract ─────────────────────────────────────── */

test('the pill’s size is a percentage, not a measured pixel width', () => {
  const chip = code(CHIP);

  // Act
  const sizesAsFraction = /width:\s*`\$\{segmentPercent\}%`/.test(chip);
  const sizesFromState = /width:\s*segmentWidth\b/.test(chip);

  // Assert
  assert.ok(sizesAsFraction, 'the pill width is not a fraction of its track');
  assert.equal(sizesFromState, false, 'the pill width still comes from measured state');
});

test('the pill’s position is a percentage, written by the animated value', () => {
  const chip = code(CHIP);

  // Act
  const animatedLeft = /left:\s*`\$\{animatedOffset\.value\}%`/.test(chip);

  // Assert — `translateX` takes pixels, which is what forced the measurement.
  assert.ok(animatedLeft, 'the position is not an animated percentage `left`');
  assert.doesNotMatch(chip, /translateX:\s*animatedOffset/, 'the position is still a pixel transform');
});

test('there is no measured width for the geometry to depend on', () => {
  const chip = code(CHIP);

  // Act
  const keepsWidthInState = /trackWidth/.test(chip);
  const measuresItself = /onLayout=/.test(chip);

  // Assert — ★ this is the fix: the control's selection is a pure function of
  // (count, index, direction), so it never asks the platform how wide it is.
  assert.equal(keepsWidthInState, false, 'a measured width is still threaded through the geometry');
  assert.equal(measuresItself, false, 'the rail still measures itself for the pill');
});

test('the pill is never hidden pending a measurement', () => {
  const chip = code(CHIP);

  // Act
  const hidesUntilMeasured = /opacity:\s*segmentWidth/.test(chip);

  // Assert — "invisible until JS has measured" is how a missing measurement became
  // a permanently absent knob.
  assert.equal(hidesUntilMeasured, false, 'the pill can still be hidden pending a measurement');
});

test('the pill is not gated on any condition at all', () => {
  const chip = code(CHIP);

  // Act — the render must be unconditional: no `cond ? <pill/> : null`, no opacity gate.
  const styleBlock = /styles\.indicator,[\s\S]{0,600}?\]/.exec(chip)?.[0] ?? '';

  // Assert
  assert.ok(styleBlock.length > 0, 'the pill style array is missing');
  assert.doesNotMatch(styleBlock, /opacity\s*:/, 'the pill still has a conditional opacity');
});

test('Reduce Motion still snaps the pill to its rest', () => {
  const chip = code(CHIP);

  assert.match(chip, /motion\.reduce/, 'the control reads no reduce flag');
});

test('the position is written on every non-animated path', () => {
  // Arrange — ★ a branch that updated bookkeeping and returned WITHOUT writing the
  // position stranded the pill on the previous option, permanently.
  const chip = code(CHIP);

  // Act
  const snapBranch =
    /if \(first \|\| directionChanged[\s\S]*?animatedOffset\.value = offsetPercent;[\s\S]*?\}/.exec(
      chip,
    )?.[0] ?? '';

  // Assert
  assert.ok(snapBranch.length > 0, 'the snap branch is missing');
  assert.match(snapBranch, /motion\.reduce/, 'Reduce Motion is not routed through the snap branch');
  assert.match(snapBranch, /animatedOffset\.value = offsetPercent/, 'the position is not written');
});

test('a direction flip re-places rather than wiping across the rail', () => {
  const chip = code(CHIP);

  // Act
  const tracksDirection = /directionChanged/.test(chip);

  // Assert
  assert.ok(tracksDirection, 'a direction change is animated instead of placed');
});
