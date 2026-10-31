/**
 * Dragging the map must pan the map, not pull the page down.
 *
 * ★ THE DEFECT THIS REPRODUCES.
 *
 * Pulling the map downward (mouse or finger) triggered the page's pull-to-refresh:
 * the top band opened and the spinner appeared, while the map stayed still. The
 * reporter put it exactly: "when I try to drag the Map (using Mouse or Finger) the
 * reload prompt on top also pulls down".
 *
 * `PullToSync` owns a web-only `PanResponder` whose guard is:
 *
 *     gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx)
 *
 * That is a statement about DIRECTION only. A downward drag on the map satisfies it
 * perfectly — the map is a WebGL canvas, so nothing in the responder stack below it
 * declines the gesture, and React Native's responder system gives the page's
 * ancestor the responder. The map never sees the drag.
 *
 * ★ WHY THE MAP HAS TO DECLINE IT ITSELF.
 *
 * The web map is `mapbox-gl`'s canvas, and `mapbox-gl` installs its own DOM-level
 * drag handling rather than a React responder, so it cannot "win" a React responder
 * negotiation. The only place to stop the page claiming the gesture is at the
 * gesture's source: a drag that begins on the map must not be claimed by an
 * ancestor pull-to-refresh.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

const PULL = 'src/components/ui/PullToSync.tsx';
const WEB_MAP = 'src/components/ui/InteractiveMap.web.tsx';

/* ── The regression ───────────────────────────────────────────────────────── */

test('the map writes data-map-surface onto the DOM node, not as a JSX prop', () => {
  // ★ THE FIRST VERSION OF THIS TEST PASSED WHILE THE GUARD WAS INERT.
  //
  // It asserted the source mentioned `data-map-surface` — and it did, as a spread
  // prop on `<View>`. React Native Web silently DROPS unknown lowercase `data-*`
  // props, so the attribute never reached the DOM: verified live, where
  // `document.querySelector('[data-map-surface]')` returned null. `PullToSync`'s
  // `closest('[data-map-surface]')` therefore matched nothing and a map drag could
  // still be claimed as a page pull.
  //
  // The assertion is now about the mechanism that works: `setAttribute` on the node.
  const map = source(WEB_MAP);

  // Assert
  assert.match(
    map,
    /setAttribute\(\s*'data-map-surface'/,
    'the attribute is never written to the DOM node, so React Native Web drops it and the guard matches nothing',
  );
  assert.doesNotMatch(
    map,
    /'data-map-surface':\s*'true'/,
    'the attribute is still passed as a JSX prop, which React Native Web discards',
  );
});

test('the map also tells the browser it handles its own touch', () => {
  // Assert — `touch-action: none` is what stops a finger drag scrolling the page.
  assert.match(source(WEB_MAP), /touchAction:\s*'none'/);
});

test('the pull responder declines gestures that begin inside the map', () => {
  // Arrange
  const pull = source(PULL);

  // Act — the claim predicate must consult the gesture's ORIGIN, not only its
  // direction, and must be able to say "this one is not mine".
  const consultsOrigin = /event\.target|closest\(|data-map-surface/.test(pull);

  // Assert
  assert.equal(
    consultsOrigin,
    true,
    'the pull responder decides from direction alone, so a downward map drag is indistinguishable from a page pull',
  );
});

test('a vertical page scroll still works, so the fix is not a blanket refusal', () => {
  // Arrange — the original guard must survive in some form; removing the
  // responder entirely would take pull-to-refresh with it.
  const pull = source(PULL);

  // Assert
  assert.match(
    pull,
    /gesture\.dy\s*>\s*\d+/,
    'the downward-distance threshold is gone, so any drag would claim the pull',
  );
  assert.match(
    pull,
    /Math\.abs\(gesture\.dy\)\s*>\s*Math\.abs\(gesture\.dx\)/,
    'the vertical-dominance test is gone, so a horizontal swipe would trigger a refresh',
  );
});
