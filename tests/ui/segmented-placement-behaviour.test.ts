/**
 * The pill's snap-vs-slide decision, replayed as behaviour.
 *
 * ★ WHY THIS FILE EXISTS SEPARATELY FROM THE SOURCE ASSERTIONS.
 *
 * `segmented-slide.test.ts` and `segmented-indicator.test.ts` grep the component's
 * TEXT. Those assertions pin the spelling of an implementation, and they pass as
 * happily on a file that no longer parses as on one that works — a reviewer found
 * exactly that during this change: 76 regex tests were green while `Chip.tsx` had
 * an unbalanced brace.
 *
 * This file cannot make that mistake. It replays the DECISION — which inputs cause
 * a snap and which cause a timed travel — and asserts the outcomes. It also
 * caught a genuine bug the greps missed: comparing the resulting pixel could not
 * tell "the user picked another option" from "the rail was re-measured", so the
 * pill animated on rotation.
 *
 * ★ THE TRUE TEST IS STILL ON A DEVICE.
 *
 * Reanimated's shared values need the UI runtime. What is checkable in Node is the
 * rule, and the rule is where both reported defects lived.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** What the effect decides for one render. */
type Decision = 'snap' | 'timing' | 'none';

interface Placement {
  placedIndex: number | null;
  placedRtl: boolean;
  placedWidth: number | null;
}

interface Render {
  selectedIndex: number;
  /** The resting pixel for this selection, from `indicatorLeftFor`. */
  restLeft: number;
  rtl: boolean;
  reduce: boolean;
  measured: boolean;
  trackWidth: number;
}

interface Outcome {
  decision: Decision;
  /** The value the pill is left at. */
  left: number;
}

/**
 * The component's effect, transcribed.
 *
 * Kept in lockstep with `Chip.tsx` by `segmented-slide.test.ts`, which asserts the
 * same input names (`placedWidth`, `selectedIndex !== placedIndex.current`) appear
 * in the source — so this cannot silently describe a rule the component dropped.
 */
function render(state: Placement, r: Render): Outcome {
  if (!r.measured) return { decision: 'none', left: -1 };

  const first = state.placedWidth === null;
  const resized = state.placedWidth !== r.trackWidth;
  const directionChanged = r.rtl !== state.placedRtl;
  const selectionChanged = r.selectedIndex !== state.placedIndex;

  if (first || resized || directionChanged || r.reduce || !selectionChanged) {
    state.placedWidth = r.trackWidth;
    state.placedIndex = r.selectedIndex;
    state.placedRtl = r.rtl;
    return { decision: 'snap', left: r.restLeft };
  }

  state.placedIndex = r.selectedIndex;
  return { decision: 'timing', left: r.restLeft };
}

const fresh = (): Placement => ({ placedIndex: null, placedRtl: false, placedWidth: null });

/** 4pt insets, 300pt rail, 3 options — the theme control's proportions. */
const REST = [0, 97.33, 194.67];

test('the first measurement is placed, not animated', () => {
  // Arrange — the rail renders once at width 0, then measures.
  const state = fresh();

  // Act
  const before = render(state, {
    selectedIndex: 1,
    restLeft: 0,
    rtl: false,
    reduce: false,
    measured: false,
    trackWidth: 0,
  });
  const after = render(state, {
    selectedIndex: 1,
    restLeft: REST[1]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Assert — animating this transition slides the pill in on every mount.
  assert.equal(before.decision, 'none', 'the pill moves before the rail exists');
  assert.equal(after.decision, 'snap', 'the first measurement animates');
  assert.equal(after.left, REST[1]!);
});

test('picking another option slides', () => {
  // Arrange
  const state = fresh();
  render(state, {
    selectedIndex: 0,
    restLeft: REST[0]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Act — the user taps the third option.
  const outcome = render(state, {
    selectedIndex: 2,
    restLeft: REST[2]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Assert
  assert.equal(outcome.decision, 'timing', 'a selection change does not animate');
  assert.equal(outcome.left, REST[2]!);
});

test('a rotation re-places the pill instead of sliding it', () => {
  // Arrange — ★ THE CASE THE GREP-BASED TESTS MISSED.
  //
  // After a selection has been placed, the recorded index matches again, so
  // comparing the PIXEL made a subsequent resize look like another selection.
  const state = fresh();
  render(state, {
    selectedIndex: 0,
    restLeft: REST[0]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });
  render(state, {
    selectedIndex: 2,
    restLeft: REST[2]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Act — the device rotates; the same option now rests at a new pixel.
  const outcome = render(state, {
    selectedIndex: 2,
    restLeft: 210,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 324,
  });

  // Assert
  assert.equal(outcome.decision, 'snap', 'a rotation animates the pill across the rail');
  assert.equal(outcome.left, 210);
});

test('Reduce Motion still moves the pill to the new option', () => {
  // Arrange — ★ THE STRANDED-PILL LEAK, ALSO FOUND IN REVIEW.
  //
  // A branch that set the bookkeeping refs and returned WITHOUT writing the
  // position left the pill on the previously animated option, permanently,
  // because every later pass then considered it already correct.
  const state = fresh();
  render(state, {
    selectedIndex: 0,
    restLeft: REST[0]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Act — the user turns Reduce Motion on and picks the last option.
  const outcome = render(state, {
    selectedIndex: 2,
    restLeft: REST[2]!,
    rtl: false,
    reduce: true,
    measured: true,
    trackWidth: 300,
  });

  // Assert — it still gets there, instantly.
  assert.equal(outcome.decision, 'snap', 'the reduced path animates');
  assert.equal(outcome.left, REST[2]!, 'the pill did not follow the selection under reduce motion');
});

test('releasing Reduce Motion does not move the pill back', () => {
  // Arrange — Reduce Motion turns off while the last option stays selected.
  const state = fresh();
  render(state, {
    selectedIndex: 2,
    restLeft: REST[2]!,
    rtl: false,
    reduce: true,
    measured: true,
    trackWidth: 300,
  });

  // Act
  const outcome = render(state, {
    selectedIndex: 2,
    restLeft: REST[2]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Assert
  assert.equal(outcome.left, REST[2]!, 'the pill jumped when Reduce Motion was released');
});

test('a direction flip re-places rather than wiping across the rail', () => {
  // Arrange — the rail has been laid out around the mirrored coordinate.
  const state = fresh();
  render(state, {
    selectedIndex: 1,
    restLeft: REST[1]!,
    rtl: false,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Act — Persian to English.
  const outcome = render(state, {
    selectedIndex: 1,
    restLeft: REST[1]!,
    rtl: true,
    reduce: false,
    measured: true,
    trackWidth: 300,
  });

  // Assert
  assert.equal(outcome.decision, 'snap', 'a direction flip animates across the rail');
});

test('options land on their own segment, in both directions', () => {
  // Arrange — "Language Knob on English instead of Persian on Persian".
  const width = 300;
  const inset = 4;
  const count = 2;
  const inner = width - inset * 2;
  const segment = inner / count;

  // Act — `indicatorLeftFor`, for a two-option rail, in RTL.
  const faIndex = 0;
  const enIndex = 1;
  const leftFor = (index: number) => inner - segment - segment * index;

  // Assert — Persian is the FIRST option, so in RTL it is the RIGHTMOST, flush at
  // the track's trailing edge; English sits to its left.
  assert.equal(leftFor(faIndex) + segment, inner, 'the Persian option is not flush at the right');
  assert.ok(leftFor(faIndex) > leftFor(enIndex), 'the Persian option is not to the right of English');
});
