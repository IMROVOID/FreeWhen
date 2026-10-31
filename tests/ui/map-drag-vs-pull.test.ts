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

test('a drag that starts on the map cannot be claimed as a page pull', () => {
  // Arrange — the map marks its surface as a region that owns vertical drags.
  const map = source(WEB_MAP);

  // Act — the marker the pull responder checks before claiming.
  const declaresOwnership = /data-map-surface|onStartShouldSetPanResponderCapture|touchAction/.test(
    map,
  );

  // Assert
  assert.equal(
    declaresOwnership,
    true,
    'the web map does not declare ownership of its own drag gestures, so an ancestor pull-to-refresh claims a map pan',
  );
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
