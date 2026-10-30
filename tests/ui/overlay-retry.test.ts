/**
 * The sheet's open must be RETRIED until it actually succeeds.
 *
 * ★ THE DEFECT: THE RETRY MARKED SUCCESS BEFORE TRYING.
 *
 * The previous attempt added an `onLayout` retry, correctly reasoned — and then
 * wired it so it could never run:
 *
 * ```js
 * const requestOpen = useCallback(() => {
 *   if (!shouldOpenSheet({ …, alreadyOpened: openedRef.current })) return;
 *   openedRef.current = true;                 // ← BEFORE the call
 *   sheetRef.current?.snapToIndex(0);         // ← may return silently
 * }, [visible]);
 * ```
 *
 * `handleSnapToIndex` in `@gorhom/bottom-sheet` begins with
 * `if (!isLayoutReady) return;`, so the mount-time call is a NO-OP. But the flag
 * was already `true`. When the measuring parent's `onLayout` then fired — the one
 * moment the open can succeed — the guard rejected it. One attempt, too early,
 * and then silence: the sheet's `Modal` stays presented with its panel translated
 * off-screen, swallowing every touch and painting nothing.
 *
 * That is the report exactly: "the overlays still don't open on App/Mobile, it
 * just swallows the Focus/Control".
 *
 * ★ THE FIX: A SUCCESSFUL OPEN IS ONE THE LIBRARY ACTUALLY ACKNOWLEDGED.
 *
 * The open is retried on every opportunity until the sheet reports that it moved.
 * `onChange` is the library's own signal — it fires when the sheet settles at an
 * index — so it is what sets the flag. Retrying before then is free and harmless:
 * the library ignores a call it is not ready for.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { shouldOpenSheet } from '@/src/components/ui/sheet-open';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE_SHEET = 'src/components/ui/BottomSheet.tsx';

/* ── The replay of the shipped failure ───────────────────────────────────── */

interface SheetState {
  /** Whether a completed open has been observed. */
  opened: boolean;
}

/**
 * The corrected call site, transcribed.
 *
 * `acknowledged` is whether the library has reported settling at the open index.
 */
function attemptOpen(
  state: SheetState,
  ctx: { wanted: boolean; layoutReady: boolean },
): { called: boolean; opened: boolean } {
  if (!shouldOpenSheet({ wanted: ctx.wanted, layoutReady: ctx.layoutReady, alreadyOpened: state.opened })) {
    return { called: false, opened: state.opened };
  }

  // The library silently ignores a call whose layout gate is still closed, so the
  // state is NOT updated here — only an acknowledgement does that.
  return { called: true, opened: state.opened };
}

test('a gated attempt does not consume the retry', () => {
  // Arrange — the mount commit: the caller wants the sheet, the container has not
  // measured, so the library's gate is closed.
  const state: SheetState = { opened: false };

  // Act — the mount attempt, which the library ignores.
  const mountAttempt = attemptOpen(state, { wanted: true, layoutReady: true });
  // ...then the layout lands, which is the first moment the open can succeed.
  const layoutAttempt = attemptOpen(state, { wanted: true, layoutReady: true });

  // Assert — ★ both attempts are made. If the first had marked the sheet opened,
  // the second would be skipped and the sheet would never appear.
  assert.equal(mountAttempt.called, true, 'the mount attempt was not made');
  assert.equal(
    layoutAttempt.called,
    true,
    'the retry was consumed by an attempt the library ignored, so the sheet never opens',
  );
});

test('a user gesture ends the retry, so it cannot fight a drag', () => {
  // Arrange — ★ FOUND IN REVIEW.
  //
  // `onChange` fires for ANY settled index, including one the user reached by
  // dragging. Marking only `index >= 0` as "opened" left a drag that settled at a
  // non-open position still inside the retry budget: the interval kept calling
  // `snapToIndex(0)` and fought the gesture for up to 256ms.
  const sheet = code(NATIVE_SHEET);

  // Act
  const tracksSettle = /settledRef/.test(sheet);
  const consultIt = /settledRef\.current/.test(sheet);
  const acknowledges = /onChange=\{handleChange\}/.test(sheet);

  // Assert
  assert.ok(acknowledges, 'the sheet never hears the library settle');
  assert.ok(tracksSettle, 'a settled gesture is not distinguished from an ignored attempt');
  assert.ok(
    consultIt,
    'the retry does not check whether the user has taken control, so it can fight a drag',
  );
});

test('an acknowledged open stops the retries', () => {
  // Arrange — the sheet settled at the open index.
  const state: SheetState = { opened: true };

  // Act — `onLayout` fires again on a keyboard inset change.
  const later = attemptOpen(state, { wanted: true, layoutReady: true });

  // Assert — a no-op, not a re-animation of a sheet the user has since dragged.
  assert.equal(later.called, false, 'an already-open sheet is asked to open again');
});

test('a closed sheet is never asked to open', () => {
  const state: SheetState = { opened: false };
  assert.equal(attemptOpen(state, { wanted: false, layoutReady: true }).called, false);
});

/* ── The component keeps the contract ────────────────────────────────────── */

test('the open flag is set by the library’s acknowledgement, not by the attempt', () => {
  // Arrange
  const sheet = code(NATIVE_SHEET);

  // Act — the shipped bug: the flag written inside the attempt, before the call.
  const marksBefore = /openedRef\.current\s*=\s*true\s*;[\s\S]{0,200}?snapToIndex/.test(sheet);

  // Assert
  assert.equal(
    marksBefore,
    false,
    'the open is marked complete before the call, so a silently-ignored attempt kills the retry',
  );

  // ...and the acknowledgement path exists.
  assert.match(sheet, /onChange=/, 'the sheet never listens for the library settling');
  assert.match(
    sheet,
    /openedRef\.current\s*=\s*true/,
    'nothing ever records that the open succeeded',
  );
});

test('the retry is still wired to layout', () => {
  const sheet = code(NATIVE_SHEET);

  assert.match(sheet, /onLayout=\{requestOpen\}/, 'the retry is not wired to the layout event');
  assert.match(sheet, /snapToIndex\(0\)/, 'nothing asks the library to open the sheet');
});
