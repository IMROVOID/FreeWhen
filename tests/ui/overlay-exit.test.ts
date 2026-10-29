/**
 * Overlays slide OUT as well as in.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * Every overlay animated on the way in and vanished on the way out. On the web
 * sheet the cause was not the animation at all — it was the effect that runs the
 * exit. It is keyed on `rendered`, and a render-strength copy of it lives in the
 * component:
 *
 *     if (visible) { setRendered(true); return; }
 *     if (!rendered) return;
 *     ... animate out; setRendered(false) after dur.slow
 *
 * Setting `rendered` re-runs the effect. On the second pass `visible` is false
 * and the cleanup of the first pass has already cancelled the pending
 * `setRendered(false)`, so the branch animates out AGAIN and schedules a fresh
 * timer — which does the same thing again. The sheet never stops animating, and
 * the desktop Escape path (which closes, then unmounts) looked like a hard cut:
 * the exit was being restarted from zero on every frame.
 *
 * `ready` pins this: the exit runs when the sheet is rendered, and the teardown
 * timer is not keyed on the flag it sets.
 *
 * ★ AND A TOAST HAD NO ENTER OR EXIT AT ALL.
 *
 * `OverlayToast` returned `null` the instant `visible` went false, so the
 * confirmation a copy produced appeared and disappeared as a hard cut — in the
 * one component whose whole job is to tell the user that something happened.
 *
 * ★ AND A RAW `Modal` IS ALWAYS A HARD CUT.
 *
 * Two `Modal`s in the chat screen used the platform's own presentation, which
 * has no exit on either platform.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the web sheet runs its exit exactly once, and never loses its teardown', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.web.tsx');

  // Act — the teardown timer must not be re-armed by the flag it sets, AND it
  // must not be cancellable by an unrelated re-render.
  const guard = /const \[ready, setReady\] = useState\(visible\)/.test(sheet);
  const keyedOnReady = /if \(!ready\) \{/.test(sheet);
  const notKeyedOnRender = !/\[visible, rendered,/.test(sheet);

  /**
   * ★ THE ONE-SHOT MUST STILL SCHEDULE THE UNMOUNT.
   *
   * The guard used to `return` with nothing scheduled, and the effect's cleanup
   * ran on every dependency change. A re-render in the 420ms between the close
   * and the unmount — a parent's `setExpanded(false)`, a layout pass moving
   * `panelHeight` — therefore cancelled the only timer that would ever clear
   * `rendered`, and the sheet stayed mounted with a full-bleed scrim over the
   * page FOR EVER. That is "after closing an overlay I can't click anything".
   */
  const schedulesOnGuard = /if \(!ready\) \{\s*ensureUnmountScheduled\(\);/.test(sheet);
  const timerInRef = /const unmountTimer = useRef/.test(sheet);
  const notClearedByDeps = !/return \(\) => clearTimeout\(timer\)/.test(sheet);

  // Assert
  assert.ok(guard, 'the exit has no one-shot guard, so setting `rendered` re-runs it');
  assert.ok(keyedOnReady, 'the exit does not check the one-shot guard');
  assert.ok(notKeyedOnRender, 'the exit effect is still keyed on the flag it writes');
  assert.ok(schedulesOnGuard, 'the one-shot can return without scheduling the unmount');
  assert.ok(timerInRef, 'the teardown timer lives in the effect, where a re-render clears it');
  assert.ok(notClearedByDeps, 'a dependency change can still cancel the only teardown');
});

test('the web sheet keeps its slide, its scrim and its Reduce Motion path', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.web.tsx');

  // Act / Assert — the fix must not cost the entrance.
  assert.ok(/withTiming/.test(sheet), 'the sheet is not animated');
  assert.ok(/translateY/.test(sheet), 'the panel no longer slides');
  assert.ok(/progress\.value/.test(sheet), 'the scrim no longer fades');
  assert.ok(/motion\.reduce/.test(sheet), 'the sheet ignores Reduce Motion');
});

test('the native sheet teardown waits for the closing slide, and is idempotent', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.tsx');

  // Act — the teardown is deferred rather than instant, and guarded so a second
  // false cannot re-arm it.
  const deferred = /setTimeout\(\(\) => setMounted\(false\), dur\.base\)/.test(sheet);
  const guarded = /if \(!mounted\) return;/.test(sheet);

  // Assert — `260` was the literal here; it is `dur.base`, the same number the
  // library's own close takes.
  assert.ok(deferred, 'the native teardown is not deferred by the close duration');
  assert.ok(guarded, 'the native teardown re-arms on every false');
});

test('the toast fades both ways instead of snapping', () => {
  // Arrange
  const toast = code('src/components/ui/OverlayToast.tsx');

  // Act
  const keeps = /const \[rendered, setRendered\] = useState\(visible\)/.test(toast);
  const fadesIn = /withTiming\(1, \{ duration: dur\.fast/.test(toast);
  const fadesOut = /withTiming\(0, \{ duration: dur\.base/.test(toast);
  const notInstant = !/if \(!visible\) return null;/.test(toast);

  // Assert
  assert.ok(keeps, 'the toast unmounts the instant it is hidden');
  assert.ok(fadesIn, 'the toast has no entrance fade');
  assert.ok(fadesOut, 'the toast has no exit fade');
  assert.ok(notInstant, 'the toast is still a hard cut');
});

test('no overlay reaches for a raw platform Modal', () => {
  // Arrange — a bare `Modal` uses the OS presentation, which has no exit on
  // either platform, so an overlay built on one can only vanish.
  //
  // `BottomSheet` and `Popover` are the two sanctioned overlay primitives: both wrap a
  // transparent `Modal` in an absolutely-inset root and own their entrance and exit
  // timing. Using one of them IS the fix, so a file that renders through either is not
  // an offender.
  const offenders = [...tsxFiles('app'), ...tsxFiles('src')].filter((file) => {
    const source = code(file);
    return /<Modal\b/.test(source) && !/BottomSheet|Popover|useSheetTransition/.test(source);
  });

  // Assert
  assert.deepEqual(offenders, [], `these files render a raw Modal:\n${offenders.join('\n')}`);
});

/** Every `.tsx` under a directory, recursively, as repo-relative paths. */
function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) found.push(full.split('\\').join('/'));
  }
  return found;
}
