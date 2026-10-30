/**
 * The sheet must actually OPEN, not just mount.
 *
 * ★ THE DEFECT THIS PINS: EVERY OVERLAY IN THE APP OPENED AND PAINTED NOTHING.
 *
 * `@gorhom/bottom-sheet` is driven by its `index` prop. Its internal effect is
 *
 * ```js
 * useEffect(() => {
 *   if (animateOnMount && !didAnimateOnMount.value) return;
 *   handleSnapToIndex(_providedIndex);
 * }, [animateOnMount, _providedIndex, didAnimateOnMount, handleSnapToIndex]);
 * ```
 *
 * and `handleSnapToIndex` opens with `if (!isLayoutReady) return;`. The effect's
 * dependencies are the `index` VALUE and two mount flags — NOT layout readiness —
 * so on the commit that mounts the sheet (`index` goes `-1 → 0`, the container has
 * not measured) the call returns, and when the measurement finally lands nothing
 * re-runs: `_providedIndex` is still `0` and the flags are unchanged. The sheet
 * stays at `index −1` for ever.
 *
 * The failure is not cosmetic. The sheet's `Modal` is PRESENTED — a real
 * `TYPE_APPLICATION` window on Android — while the panel inside it is translated
 * off-screen. The window eats every touch and paints nothing, which is the report
 * exactly: "the input is swallowed by the overlay but the overlay itself is not
 * visible".
 *
 * ★ WHY THE TEST IS ON A PURE MODULE.
 *
 * The open path lives inside a native library and a `Modal`; the Node runner can
 * do neither. `sheet-open.ts` holds the decision, so "does the open survive a late
 * measurement" is a question with an answer a test can check — and the source
 * assertions below make sure the component keeps using it.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { shouldOpenSheet, sheetIndexFor } from '@/src/components/ui/sheet-open';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE_SHEET = 'src/components/ui/BottomSheet.tsx';

/* ── The decision ─────────────────────────────────────────────────────────── */

test('the open is retried once the layout arrives', () => {
  // Arrange — the exact shipped sequence: the caller wants the sheet, the mount
  // commit happens before the container has measured.
  const mountCommit = shouldOpenSheet({ wanted: true, layoutReady: false, alreadyOpened: false });

  // Act — `onLayout` then fires, which is the moment the library's gate can pass.
  const layoutCommit = shouldOpenSheet({ wanted: true, layoutReady: true, alreadyOpened: false });

  // Assert
  assert.equal(mountCommit, false, 'the open should not be attempted before layout exists');
  assert.equal(layoutCommit, true, 'the open is never retried, so the sheet stays closed');
});

test('a delivered open is not repeated', () => {
  // Arrange — `onLayout` fires again on every keyboard inset, rotation and
  // font-scale change.
  const again = shouldOpenSheet({ wanted: true, layoutReady: true, alreadyOpened: true });

  // Assert — a second call would re-animate a sheet the user has since dragged.
  assert.equal(again, false, 'the retry is not idempotent');
});

test('a sheet nobody wants is never opened', () => {
  // Arrange / Act / Assert — the retry runs on layout, which can happen while
  // `visible` is false.
  assert.equal(shouldOpenSheet({ wanted: false, layoutReady: true, alreadyOpened: false }), false);
});

test('the controlled index is closed until the sheet is both wanted and mounted', () => {
  // Assert — `-1` is closed, `0` is the first snap point. The value is still
  // supplied; it is what the library reads, it is just not sufficient on its own.
  assert.equal(sheetIndexFor({ visible: false, mounted: false }), -1);
  assert.equal(sheetIndexFor({ visible: false, mounted: true }), -1);
  assert.equal(sheetIndexFor({ visible: true, mounted: false }), -1);
  assert.equal(sheetIndexFor({ visible: true, mounted: true }), 0);
});

/* ── The component keeps using it ─────────────────────────────────────────── */

test('the sheet still passes its index, and retries through it', () => {
  // Arrange
  const sheet = code(NATIVE_SHEET);

  // Assert — the controlled value...
  assert.match(
    sheet,
    /const openIndex = sheetIndexFor\(/,
    'the sheet no longer derives its index from the shared rule',
  );
  assert.match(sheet, /index=\{openIndex\}/, 'the index is not passed to the library');

  // ...and the retry.
  assert.match(sheet, /shouldOpenSheet\(/, 'the sheet does not use the shared open rule');
  assert.match(
    sheet,
    /sheetRef\.current\?\.snapToIndex\(0\)/,
    'nothing ever asks the library to open the sheet',
  );
});

test('the open is retried from the measuring parent’s layout event', () => {
  // Arrange — `onLayout` on the sheet's measuring parent is precisely the moment
  // the library's `isLayoutCalculated` becomes true. Without it the retry never
  // happens at all.
  const sheet = code(NATIVE_SHEET);

  // Act
  const retriedOnLayout = /<View style=\{styles\.modalRoot\} onLayout=\{requestOpen\}>/.test(sheet);

  // Assert
  assert.ok(retriedOnLayout, 'the sheet never retries its open after the layout lands');
});

test('the web sheet is a different component and is not assumed to share this path', () => {
  // Arrange — `BottomSheet.web.tsx` renders a plain document overlay and has no
  // library layout gate to satisfy. A fix applied to the native file leaves the
  // web file untouched, which is the opposite of four earlier commits that edited
  // the native file while the browser rendered the other one.
  const web = code('src/components/ui/BottomSheet.web.tsx');

  // Assert
  assert.doesNotMatch(web, /@gorhom\/bottom-sheet/, 'the web sheet imports the gesture library');
  assert.doesNotMatch(web, /sheetIndexFor|shouldOpenSheet/, 'the web sheet adopted a native-only path');
});
