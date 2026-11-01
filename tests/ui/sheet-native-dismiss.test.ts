/**
 * An overlay on the App can be dismissed and read.
 *
 * ★ THE REPORT.
 *
 * "When I open an overlay I can't close it by dragging the handle down or by clicking
 * outside, and I can't even scroll the overlay (like the big overlays, the Privacy
 * Policy). I can only use my phone's Back. It is like the controls are completely
 * disabled or focused on another page when overlays are open. Web is already fine."
 *
 * Three symptoms, one cause, and the cause is the same for all three:
 *
 * ★ A `MODAL` IS A SEPARATE WINDOW, AND A GESTURE HANDLER NEEDS A ROOT.
 *
 * `@gorhom/bottom-sheet` builds its pan-down, its backdrop press and its scroll
 * hand-off on `react-native-gesture-handler`. A handler only works inside a
 * `GestureHandlerRootView`. The app's root one does not cover this subtree: an
 * Android `Modal` is its own window with its own tree, and a react-native-web `Modal`
 * mounts into a portal wrapper outside the app root. So every gesture inside a sheet
 * was dead, while the Back button — which the OS routes to `onRequestClose`, not
 * through a gesture — still worked. That is exactly the reported asymmetry.
 *
 * ★ AND `BottomSheetView` COULD NOT SCROLL AT ALL.
 *
 * It sizes to its content, so a long document was clipped at one screen with nothing
 * to scroll. `BottomSheetScrollView` is the library's own scroll container, and it is
 * also what hands a downward drag at the top of the content to the pan-down gesture.
 *
 * Web is a different file (`BottomSheet.web.tsx`) with its own scrim click, Escape and
 * pointer drag — which is why it never had the defect.
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

const NATIVE = code('src/components/ui/BottomSheet.tsx');
const WEB = code('src/components/ui/BottomSheet.web.tsx');

/* ── The gesture root ─────────────────────────────────────────────────────── */

test('the sheet presents inside a gesture root', () => {
  // ★ THIS IS THE FIX FOR ALL THREE SYMPTOMS AT ONCE.
  assert.match(NATIVE, /GestureHandlerRootView/, 'the sheet has no gesture root, so every gesture in it is dead');
  assert.match(NATIVE, /<GestureHandlerRootView style=\{styles\.root\}>/);
  assert.match(NATIVE, /from 'react-native-gesture-handler'/);
});

test('the gesture root is a real box, not a zero-height wrapper', () => {
  const root = /root: \{([\s\S]*?)\n {2}\}/.exec(NATIVE)?.[1] ?? '';
  assert.match(root, /flex: 1/);
});

/* ── Tap outside ──────────────────────────────────────────────────────────── */

test('a tap outside closes the sheet', () => {
  // Arrange — the component's own header has always promised this on both platforms,
  // and the native sheet had no backdrop to press.
  assert.match(NATIVE, /backdropComponent=\{dismissible \? renderBackdrop : undefined\}/);
  assert.match(NATIVE, /BottomSheetBackdrop/);
});

test('the backdrop does not cover the panel', () => {
  // ★ `appearsOnIndex={-1}` means it is there only while the sheet is closed or on its
  // way out. Without it the scrim sits OVER the panel and the content is unreachable.
  const backdrop = /function renderBackdrop[\s\S]*?\n\}/.exec(NATIVE)?.[0] ?? '';

  assert.ok(backdrop.length > 0, 'the backdrop is gone');
  assert.match(backdrop, /appearsOnIndex=\{-1\}/);
  assert.match(backdrop, /disappearsOnIndex=\{0\}/);
});

test('a non-dismissible gate still has no backdrop and no pan-down', () => {
  // Assert — the nickname gate is a question the user must answer; it must not gain
  // three ways out because the sheet learned to close.
  assert.match(NATIVE, /backdropComponent=\{dismissible \? renderBackdrop : undefined\}/);
  assert.match(NATIVE, /enablePanDownToClose=\{dismissible\}/);
  assert.match(NATIVE, /if \(dismissible\) sheetRef\.current\?\.close\(\)/);
});

/* ── Scrolling the document ───────────────────────────────────────────────── */

test('the sheet’s content scrolls, so a long document is readable', () => {
  // ★ `BottomSheetView` cannot scroll. The privacy notice at `85%` was clipped at one
  // screen — the reported "I can't even scroll the overlay".
  assert.match(NATIVE, /BottomSheetScrollView/, 'the content is not a scroll view');
  assert.doesNotMatch(NATIVE, /BottomSheetView/, 'the non-scrolling view is still used');
});

test('the scroll view sizes to its content instead of claiming all the space', () => {
  // ★ `flex: 1` MADE THE SHEET'S CONTENT UNREACHABLE, AND THIS TEST USED TO DEMAND IT.
  //
  // With dynamic sizing the sheet measures its CONTENT, so a child asking for all the
  // free space gets none: the scroll view collapsed, its children were laid out into a
  // zero-height box, and every tap landed on nothing. On a device that read as a sheet
  // whose input never focused and whose keyboard never opened — found by tapping the
  // nickname field on an emulator and watching `mInputShown` stay false.
  const scroll = /scroll: \{([\s\S]*?)\n {2}\}/.exec(NATIVE)?.[1] ?? '';

  assert.ok(scroll.length > 0, 'the scroll style is gone');
  assert.match(scroll, /flexGrow: 0/, 'the scroll view still claims the free space and collapses');
  assert.match(scroll, /flexShrink: 1/, 'a long document can no longer shrink inside its snap point');
});

test('the content still carries the sheet’s padding', () => {
  assert.match(NATIVE, /contentContainerStyle=\{styles\.content\}/);
  const content = /content: \{([\s\S]*?)\n {2}\}/.exec(NATIVE)?.[1] ?? '';
  assert.match(content, /padding: space\[5\]/);
});

/* ── Nothing else regressed ───────────────────────────────────────────────── */

test('the open retry and the delayed teardown survive', () => {
  // Assert — both were hard-won fixes (a silently-gated `snapToIndex`, and a Modal
  // removed while still on screen leaving its window behind).
  assert.match(NATIVE, /sheetRef\.current\?\.snapToIndex\(0\)/);
  assert.match(NATIVE, /setTimeout\(\(\) => setMounted\(false\), dur\.base\)/);
  assert.match(NATIVE, /onLayout=\{requestOpen\}/);
});

test('the sheet still renders nothing while closed', () => {
  assert.match(NATIVE, /if \(!visible && !mounted\) return null;/);
});

test('the web sheet keeps its own dismissals', () => {
  // Assert — web was reported fine, and it is a different component: scrim press,
  // Escape, and a pointer drag on the grabber.
  assert.match(WEB, /onPress=\{onDismiss\}/);
  assert.match(WEB, /onKeyDown/);
  assert.match(WEB, /onPointerDown=\{onPointerDown\}/);
  assert.doesNotMatch(WEB, /GestureHandlerRootView/);
});
