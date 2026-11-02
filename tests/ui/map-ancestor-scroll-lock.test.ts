/**
 * A vertical drag on the map moves the map, not the page.
 *
 * ★ THE REPORT.
 *
 * "When I drag the map vertically on the App on a scrollable page, the page
 * scrolls instead of the map moving. On pages that don't scroll (like the `Select
 * your Location` overlay) it works fine."
 *
 * ★ THE ASYMMETRY IS THE DIAGNOSIS, AND IT RULES OUT EVERY PREVIOUS FIX.
 *
 * The map already does three things on a device, and all three are HORIZONTAL-ONLY
 * in effect:
 *
 *   1. `touch-action: none` / `overscroll-behavior: none` in the document — stops
 *      the browser claiming the finger;
 *   2. `preventDefault()` on `touchmove` — stops the WebView's own compositor
 *      scrolling it;
 *   3. `nestedScrollEnabled={false}` — stops the WebView handing the drag up.
 *
 * None of them reaches React NATIVE's responder system on Android. `nestedScrollEnabled`
 * is an iOS-shaped prop (`UIScrollView`); on Android the ancestor `ReactScrollView`
 * intercepts a vertical drag as soon as it passes `touchSlop`, BEFORE the WebView's
 * gesture detector sees the `MotionEvent`. The page then scrolls and the map
 * receives `ACTION_CANCEL` — which is exactly "the page scrolls instead of the map
 * moving". On the location overlay there is no ancestor `ScrollView` over the map,
 * which is why that one works.
 *
 * ★ SO THE FIX MAKES THE ANCESTOR DECLINE; IT DOES NOT RACE IT.
 *
 * Three ancestor-gesture mechanisms were already measured and rejected against the
 * installed APK (`map-gesture.ts` records them), and the test below keeps them
 * rejected. What is added instead is a LOCK: while a finger is down on the map the
 * ancestor `ScrollView` is told `scrollEnabled = false`, so its `onInterceptTouchEvent`
 * returns `false` unconditionally and it cannot claim the drag. The `WebView` is
 * untouched and keeps every touch — which is the one thing the tap already proved
 * works. The lock is released the instant the finger lifts.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MAP_ANCESTOR_LOCK_KEY } from '@/src/components/ui/map-gesture';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const WEB = code('src/components/ui/InteractiveMap.web.tsx');
const TYPES = code('src/components/ui/InteractiveMap.tsx');

/* ── The prop exists, and both surfaces accept it ─────────────────────────── */

test('the surface can be told which ancestor scroll view must stand down', () => {
  // The lock has to name a scroll view, and the map cannot discover one: a
  // `WebView` is an opaque native view with no path up the responder chain.
  assert.match(TYPES, /ancestorScroll/, 'the shared props do not carry the ancestor');
  assert.ok(MAP_ANCESTOR_LOCK_KEY.length > 0, 'the lock key is empty');
});

test('the web surface accepts the prop and does nothing with it', () => {
  // ★ THE BROWSER NEVER NEEDED THIS, AND PRETENDING OTHERWISE WOULD BE A BUG.
  //
  // On web, `touch-action: none` plus `PullToSync`'s origin check already keep the
  // page still — that platform was reported working. Accepting the prop keeps the
  // call sites identical on both platforms.
  assert.match(WEB, /ancestorScroll/, 'the web surface rejects a prop its callers pass');
});

/* ── The lock is applied from the gesture report ──────────────────────────── */

test('a finger down on the map disables the ancestor scroll view', () => {
  // ★ THE REPORTED BRIDGE MESSAGE ALREADY EXISTS AND IS ALREADY TESTED.
  //
  // The document posts `{ type: 'gesture', active: true }` on touchstart and
  // `active: false` on touchend/touchcancel. That message was documented as
  // "diagnostics only" — this is the consumer it was always going to need.
  const gestureCase = /case 'gesture':([\s\S]*?)break;/.exec(NATIVE)?.[1] ?? '';
  assert.ok(gestureCase.length > 0, 'the gesture case is gone');

  // The case drives the lock from the message's own flag. It goes through a helper
  // because the lock body is shared with the unmount cleanup; what matters is that
  // the report reaches it and the flag is what decides.
  assert.match(gestureCase, /setAncestorScroll\(/, 'the gesture report does not reach the ancestor');
  assert.match(gestureCase, /message\.active/, 'the lock ignores whether the finger is down');
});

test('the helper writes scrollEnabled on the ancestor, not on the map', () => {
  const helper = /const setAncestorScroll = useCallback\(([\s\S]*?)\[ancestorScroll\]/.exec(NATIVE)?.[1] ?? '';
  assert.ok(helper.length > 0, 'the lock helper is gone');

  assert.match(helper, /ancestorScroll\?\.current/, 'the helper does not read the ancestor ref');
  assert.match(helper, /setNativeProps/, 'the ancestor is written through a slow re-render');
  assert.match(helper, /MAP_ANCESTOR_LOCK_KEY/, 'the lock writes an unnamed prop');
  assert.match(helper, /enabled/, 'the helper ignores the value it is given');
});

test('the lock follows the finger: on while down, off when released', () => {
  // A lock that is set but never cleared makes the page permanently unscrollable —
  // a worse defect than the one being fixed. Two exits release it: the document's
  // `active: false` report, and unmounting mid-touch.
  const gestureCase = /case 'gesture':([\s\S]*?)break;/.exec(NATIVE)?.[1] ?? '';
  assert.match(gestureCase, /!message\.active/, 'the lock does not invert the finger flag');
});

test('a cancelled touch and an unmount both release the lock', () => {
  // ★ `touchcancel` IS THE COMMON CASE, NOT THE EXCEPTION.
  //
  // A system gesture, an incoming call, or the parent claiming the responder can
  // all cancel the sequence — and if that path skips the release, the page is left
  // unscrollable until the screen is rebuilt. The document reports
  // `active: false` from BOTH `touchend` and `touchcancel`, so the lock rides on it.
  const documentCancel = /addEventListener\('touchcancel',[\s\S]*?\{ passive: \w+ \}\)/.exec(NATIVE)?.[0] ?? '';
  assert.ok(documentCancel.length > 0, 'the document has no touchcancel listener');
  assert.match(documentCancel, /type: 'gesture', active: false/, 'a cancelled touch is not reported');

  // The cleanup is what releases it on unmount; it must ask for ENABLED.
  const unmountRelease = /useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]*?\};/.exec(NATIVE)?.[0] ?? '';
  assert.ok(unmountRelease.length > 0, 'unmounting mid-touch leaves the page locked');
  assert.match(unmountRelease, /setAncestorScroll\(true\)/, 'the unmount cleanup does not unlock');
});

test('a settled camera also releases the lock, as a safety net', () => {
  // ★ THE UNLOCK RIDES ON A MESSAGE THE DOCUMENT HAS TO BE ALIVE TO SEND.
  //
  // If that report is ever lost — a WebView reload mid-gesture, a crashed document,
  // a `touchend` the compositor swallowed — the page would stay unscrollable until
  // the screen was rebuilt, which is worse than the defect. A `moveend` can only be
  // posted by a live document that has finished a gesture, so unlocking on it is
  // always safe: no finger is down by definition.
  const cameraCase = /case 'camera':([\s\S]*?)break;/.exec(NATIVE)?.[1] ?? '';
  assert.ok(cameraCase.length > 0, 'the camera case is gone');
  assert.match(cameraCase, /setAncestorScroll\(true\)/, 'a missed unlock is never recovered');
});
test('the lock is released to ENABLED, explicitly', () => {
  // `setNativeProps({ scrollEnabled: false })` and then never writing `true` is a
  // silent trap: React does not re-push a prop it believes is unchanged.
  assert.match(NATIVE, /setAncestorScroll\(true\)/, 'nothing ever re-enables the ancestor');
});

/* ── The rejected mechanisms stay rejected ────────────────────────────────── */

test('no ancestor gesture is reintroduced', () => {
  // ★ ALL THREE WERE MEASURED ON AN EMULATOR AGAINST THE INSTALLED APK.
  //
  // A `PanResponder` is asynchronous and loses the drag to the scroll view; a
  // gesture-handler `Gesture.Pan` on the wrapper takes the movement before the
  // WebView's recogniser sees it, so a DRAG moved neither the map nor the page.
  // The lock is a different mechanism: it removes the ancestor's authority instead
  // of competing for the finger.
  assert.doesNotMatch(NATIVE, /GestureDetector/, 'an ancestor gesture is back');
  assert.doesNotMatch(NATIVE, /Gesture\.Pan\(\)/, 'an ancestor pan gesture is back');
  assert.doesNotMatch(
    NATIVE,
    /from 'react-native-gesture-handler'/,
    'the map re-imported the gesture library',
  );
  assert.doesNotMatch(NATIVE, /PanResponder/, 'the asynchronous responder is back');
});

test('the WebView still does not forward the drag natively', () => {
  // The existing belt-and-braces stays: `nestedScrollEnabled={false}` is what keeps
  // iOS's `UIScrollView` from adopting the pan, and the lock covers Android.
  assert.match(NATIVE, /nestedScrollEnabled=\{false\}/);
  assert.match(NATIVE, /scrollEnabled=\{false\}/);
});

/* ── The call sites opt in ────────────────────────────────────────────────── */

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('every map that sits inside a scrollable page names that page', () => {
  // ★ THE DEFECT IS A PROPERTY OF THE ANCESTOR, NOT OF THE MAP.
  //
  // So the fix has to be applied where a `ScrollView` contains a map — and those
  // are precisely the surfaces the report names. A map with no scrolling ancestor
  // correctly passes nothing.
  for (const path of [
    'src/features/venues/components/EventRouteMap.tsx',
    'src/components/ui/LocationMapPicker.tsx',
    'src/features/proposals/components/ProposalRouteMap.tsx',
    // The ranked-venues page scrolls too, so its map has the same defect.
    'src/features/venues/components/VenueMap.native.tsx',
  ]) {
    assert.match(read(path), /ancestorScroll/, `${path} does not lock its ancestor`);
  }
});

test('the ranked-venues page hands its scroll view to its map', () => {
  // The map cannot discover the ancestor. A page that scrolls must name it, or the
  // lock has nothing to hold and the defect stays exactly as reported.
  const screen = read('app/event/[id]/map.tsx');
  assert.match(screen, /const scrollRef = useRef<ScrollViewInstance \| null>\(null\)/);
  assert.match(screen, /ancestorScroll=\{scrollRef\}/);
});
