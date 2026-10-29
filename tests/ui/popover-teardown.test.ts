/**
 * The menu must actually go away, and it must not select text on the way.
 *
 * ★ THE POPOVER KEPT ITS SCRIM OVER THE PAGE FOR EVER.
 *
 * `Popover` armed its teardown timer inside the exit effect's `return` cleanup, and
 * `ready` — which the same effect sets — is one of that effect's dependencies. So
 * the effect ran a second time immediately, its cleanup cancelled the only timer
 * that would ever set `rendered` back to false, and the popover stayed mounted with
 * a full-bleed scrim. The page looked dimmed and nothing responded: "I close the
 * event menu by clicking outside and the menu still stays focused — I can't click
 * anywhere and everything is dark".
 *
 * The fix is the one `BottomSheet.web` already needed for the same reason: the
 * timer lives in a ref that a dependency change cannot clear, and the effect owns
 * only the animation. `tests/ui/overlay-exit.test.ts` pins the sheet's half.
 *
 * ★ AND A DRAG ON A SHEET'S HEADER SELECTED THE TEXT INSIDE IT.
 *
 * `touch-action: none` stops the browser's SCROLL gesture, not its selection
 * gesture: a slow downward drag on the grabber started a text selection across the
 * panel's own title.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const POPOVER = code('src/components/ui/Popover.tsx');
const SHEET = code('src/components/ui/BottomSheet.web.tsx');

/* ── The teardown ─────────────────────────────────────────────────────────── */

test('the teardown timer is held in a ref, not in the effect', () => {
  // Arrange — a timer created inside the effect and returned as its cleanup is
  // cleared by the effect's OWN re-run, and `ready` guarantees that re-run happens.
  const ref = /const unmountTimer = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(
    POPOVER,
  );

  // Act — the timer must be armed through the ref-producing helper.
  const armed = /ensureUnmountScheduled\(\)/.test(POPOVER);

  // Assert
  assert.ok(ref, 'the teardown timer is not held in a ref');
  assert.ok(armed, 'the teardown is not scheduled through a ref that survives a re-render');
});

test('the scheduled unmount runs only when nothing is armed', () => {
  // Arrange — a second schedule must not overwrite the first, or a re-render could
  // push the unmount out indefinitely.
  const helper = /const ensureUnmountScheduled = useCallback\(\(\) => \{([\s\S]*?)\}, \[motion\.reduce\]\);/.exec(
    POPOVER,
  )?.[1] ?? '';

  // Act / Assert
  assert.ok(/if \(unmountTimer\.current !== null\) return;/.test(helper), 'a second schedule re-arms the timer');
  assert.ok(/setRendered\(false\)/.test(helper), 'the scheduled teardown never unmounts');
  assert.ok(/unmountTimer\.current = null/.test(helper), 'the ref is never cleared, so it never re-arms');
});

test('the effect clears the timer only on unmount', () => {
  // Arrange — an empty dependency list is the point: nothing a re-render does can
  // reach this cleanup.
  const cleanup = /useEffect\(\s*\(\) => \(\) => \{([\s\S]*?)\},\s*\[\],\s*\);/.exec(POPOVER)?.[1] ?? '';

  // Act / Assert
  assert.ok(cleanup.length > 0, 'there is no unmount-only cleanup');
  assert.ok(/clearTimeout\(unmountTimer\.current\)/.test(cleanup), 'the unmount does not clear the timer');
});

test('the one-shot guards the animation, not the unmount', () => {
  // Arrange — this is the defect exactly: `if (!ready) return;` placed BEFORE the
  // teardown means a re-run leaves nothing scheduled.
  const exitBranch = /if \(ready\) \{([\s\S]*?)\}/.exec(POPOVER)?.[1] ?? '';

  // Act
  const guarded = /progress\.value = motion\.reduce \? 0/.test(exitBranch);
  const earlyReturn = /if \(!ready\) return;/.test(POPOVER);
  const schedulesOutside = /if \(ready\) \{[\s\S]*?\}\s*\n\s*ensureUnmountScheduled\(\);/.test(POPOVER);

  // Assert
  assert.ok(guarded, 'the exit animation is not guarded');
  assert.ok(!earlyReturn, 'the early return still leaves nothing scheduled on a re-run');
  assert.ok(schedulesOutside, 'the teardown is inside the one-shot, so a re-run can lose it');
});

test('the sheet keeps its Modal presented until the exit has run', () => {
  // Arrange — the Android half of the same bug: removing a presented `Modal` leaves
  // its window over the app, swallowing every touch.
  const sheet = /if \(!rendered\) return null;/.test(SHEET);

  // Act / Assert
  assert.ok(sheet, 'the sheet keys its mount on `visible` rather than on its own exit');
  assert.ok(
    !/if \(!visible\) return null;/.test(SHEET),
    'the sheet unmounts on the same tick it is told to close',
  );
});

/* ── The drag ─────────────────────────────────────────────────────────────── */

test('a drag on the grabber cannot select the panel’s text', () => {
  // Act
  const row = /grabberRow:\s*\{([\s\S]*?)\},\n\s*grabberRowActive/.exec(SHEET)?.[1] ?? '';

  // Assert — `touch-action` stops scrolling, not selection.
  assert.ok(/touchAction:\s*'none'/.test(row), 'the browser can still claim the drag as a scroll');
  assert.ok(/userSelect:\s*'none'/.test(row), 'a drag on the handle selects the text inside the sheet');
  assert.ok(/WebkitUserSelect:\s*'none'/.test(row), 'Safari still selects on the drag');
});

test('the panel’s own content keeps normal selection', () => {
  // Act — the suppression must be on the handle, not on the panel.
  const panel = /panel:\s*\{([\s\S]*?)\n {2}\},/.exec(SHEET)?.[1] ?? '';
  const content = /content:\s*\{([^}]*)\}/.exec(SHEET)?.[1] ?? '';

  // Assert
  assert.ok(!/userSelect/.test(panel), 'the whole panel lost its text selection');
  assert.ok(!/userSelect/.test(content), 'the sheet’s content lost its text selection');
});
