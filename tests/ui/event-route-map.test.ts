/**
 * The event page's route map: seen, never changed.
 *
 * ★ THE REQUEST WAS SPECIFIC ABOUT THE DIRECTION OF CONTROL.
 *
 * "users should be able to see (not change it) the Routing (User Location to
 * Proposal Location) and move the Camera/Map on Event pages". Three separate
 * claims, and each one is a property a later edit could quietly break:
 *
 *  1. the route is VISIBLE — a line from the viewer to each proposed venue;
 *  2. it is NOT EDITABLE — no tap handler, no waypoints, no recalculation;
 *  3. the CAMERA is the user's — pan, zoom, tilt, and the camera is not re-fitted
 *     on every render, which would snatch it back mid-look.
 *
 * ★ AND THE DATA CANNOT BE A PARTICIPANT'S POSITION.
 *
 * `listParticipants` carries `start_point_state`, never a coordinate, precisely so
 * no screen can draw someone else's precise location (FR-8.16). The origin on this
 * map is the VIEWER'S OWN saved point, from `useStartPoint`. Reaching into the
 * participant list for it would be a privacy regression that the type system would
 * happily allow, so it is asserted here.
 */

import './support/register';

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { fallbackRoute } from '@/src/features/venues/services/route-line';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const MAP = code('src/features/venues/components/EventRouteMap.tsx');
const HOME = code('app/event/[id]/index.tsx');
const LINE = code('src/features/venues/services/route-line.ts');

afterEach(() => {
  delete (globalThis as { process: { env: Record<string, string | undefined> } }).process.env
    .EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
});

/* ── Read-only by construction ────────────────────────────────────────────── */

test('the event map accepts no press handler, so a tap cannot change anything', () => {
  // Arrange — the surface DOES support `onPress`; omitting it here is the whole
  // mechanism. A caller cannot pass an edit handler the component never forwards.
  const surfaceCall = /<InteractiveMap[\s\S]*?\/>/.exec(MAP)?.[0] ?? '';

  // Act / Assert
  assert.ok(surfaceCall.length > 0, 'the event map does not mount a map surface');
  assert.doesNotMatch(
    surfaceCall,
    /onPress=/,
    'the event map forwards a press handler, so the route is editable',
  );
});

test('the props carry no editing affordance at all', () => {
  // Arrange — a type is the strongest place to prevent this: an edit prop that
  // does not exist cannot be wired by a later author.
  const props = /export interface EventRouteMapProps \{([\s\S]*?)\n\}/.exec(MAP)?.[1] ?? '';

  // Act
  const forbidden = ['onPress', 'onChange', 'onDrag', 'onEdit', 'editable', 'onRecalculate'];

  // Assert
  assert.ok(props.length > 0, 'the props interface was not found');
  for (const name of forbidden) {
    assert.doesNotMatch(props, new RegExp(`\\b${name}\\b`), `the map exposes an edit prop: ${name}`);
  }
});

test('the camera is left to the user, not re-fitted on every render', () => {
  // Arrange — the camera is a single memo of the initial framing, passed as a
  // prop. The surface applies it once, at construction.
  // AND IT IS KEYED ON THE COORDINATES, NOT ON THE ARRAYS.
  //
  // destinations is rebuilt by the screen on every render and this component
  // re-renders whenever a route lands, so a memo on those ARRAYS produced a new pose
  // every time - and a new pose is exactly what InteractiveMap applies.
  const memo = /const camera = useMemo\(\(\) => \{[\s\S]*?\}, \[originLat, originLng, destinationKey\]\);/.test(MAP);

  // Act / Assert — re-deriving the camera from the routes would snap the view back
  // every time a line arrived, which reads as the map fighting the finger.
  assert.ok(memo, 'the camera is not derived once from the endpoints');
  assert.doesNotMatch(
    /camera=\{camera\}/.source === '' ? '' : MAP,
    /camera: \{[\s\S]{0,80}routes/,
    'the camera is derived from the fetched routes, so it re-frames on every arrival',
  );
});

/* ── The route is visible ─────────────────────────────────────────────────── */

test('one line is drawn per proposed place', () => {
  // Arrange
  const perDestination = /destinations\.map\(async \(destination\) => \{[\s\S]{0,200}?fetchRoute\(origin, destination\.coordinate\)/.test(
    MAP,
  );

  // Act / Assert
  assert.ok(perDestination, 'the map does not fetch a line per destination');
  // The routes are turned into drawable lines one per entry. It is a flatMap
  // entry whose destination has gone yields NO line rather than a wrongly-coloured
  // one — see the note in EventRouteMap.
  assert.match(MAP, /Object\.entries\(routes\)\.flatMap\(/);
});

test('the lines are fetched in parallel, not one after another', () => {
  // Assert — three venues drawn in sequence would be three round trips and three
  // repaints.
  assert.match(MAP, /await Promise\.all\(/);
});

test('a straight-line route is drawn dashed, so it does not claim a road', () => {
  // ★ THE PREVIOUS VERSION OF THIS TEST ASSERTED THE OPPOSITE, AND THAT WAS THE BUG.
  //
  // It pinned `dashed: false` on the reasoning that "a dashed line read as
  // approximate and the request was that a route look like a route". But a straight
  // line between two points is not a route — it is the direction the provider would
  // not resolve — and drawing it solid told the reader a road existed where none had
  // been asked for. That is half of the reported "it is a simple straight line on
  // short distances even though there is still a street between them".
  //
  // The dash now FOLLOWS the geometry's own source, so a street is solid and a
  // refusal is dashed. The legend still states it in words (map.directionOnly).
  assert.match(MAP, /dashed: geometry\.source === 'straight_line'/);
  assert.match(MAP, /map\.directionOnly/);
  assert.doesNotMatch(MAP, /^\s*dashed: false,\s*$/m);
});

test('an endpoint that is missing draws no line at all', () => {
  // Arrange — a direction line to (0, 0) would put the viewer in the Atlantic.
  assert.match(LINE, /if \(!drawable\(from\) \|\| !drawable\(to\)\) return null;/);
  assert.match(MAP, /if \(origin === null \|\| destinations\.length === 0\) \{/);
});

test('a failed fetch degrades to a bearing rather than to an empty map', () => {
  // Arrange — the line is decoration over a decision the engine already made, so
  // it may never take the page down.
  const fallback = /catch \{\s*return fallbackRoute\(from, to\);\s*\}/.test(LINE);

  // Act / Assert
  assert.ok(fallback, 'a refused request propagates instead of degrading');
  assert.match(MAP, /geometry \?\? fallbackRoute\(origin, destination\.coordinate\)/);
});

test('the fallback is a two-point line in GeoJSON order', () => {
  // Act
  const route = fallbackRoute({ lat: 35.6892, lng: 51.389 }, { lat: 35.71, lng: 51.42 });

  // Assert — longitude first, which is what every line layer expects.
  assert.deepEqual(route.points, [
    [51.389, 35.6892],
    [51.42, 35.71],
  ]);
  assert.equal(route.source, 'straight_line');
});

test('a malformed body is a fallback, not a drawn lie', () => {
  // Assert — the server already substitutes; a second guess here would draw a
  // line it refused.
  assert.match(LINE, /!Array\.isArray\(data\.points\) \|\| data\.points\.length < 2/);
  assert.match(LINE, /Number\.isFinite\(point\[0\]\)/);
});

/* ── Privacy ──────────────────────────────────────────────────────────────── */

test('the viewer’s origin is their own saved point, never the participant list', () => {
  // Arrange — `listParticipants` carries a state string and no coordinate, by
  // design. Reaching into it for a position would be a privacy regression the
  // type system would allow.
  const origin = /const myStartPoint = useMemo\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\)/.exec(HOME);

  // Act / Assert
  assert.ok(origin, 'the origin is not derived in one place');
  assert.match(origin[1]!, /startPoint\.saved/, 'the origin does not come from the start-point hook');
  assert.doesNotMatch(
    origin[1]!,
    /participants/,
    'the origin is read from the participant list, which carries no coordinate by design',
  );
});

test('the camera frames the whole event, never one person', () => {
  // Assert — FR-8.16: a viewport centred on one fix leaks what the fuzzed
  // coordinate was protecting.
  assert.match(MAP, /boundingBox\(points, EVENT_PADDING_RATIO\)/);
  assert.match(MAP, /\[\s*\.\.\.\(originLat !== null && originLng !== null \? \[\{ lat: originLat, lng: originLng \}\] : \[\]\),\s*\.\.\.destinations\.map/);
});

test('a proposal with no place contributes no pin', () => {
  // Arrange — a time-only proposal has no coordinate; pinning it at (0, 0) would
  // put an option in the Atlantic, and the list still carries it (FR-4.5).
  assert.match(HOME, /proposal\.venue\s*\n\s*\? \[/);
  assert.match(HOME, /: \[\],/);
});

/* ── The legend ───────────────────────────────────────────────────────────── */

test('every fact the drawing shows is also text', () => {
  // Assert — the map is contextual; the list and legend are the accessible path.
  //
  // ★ THE LEGEND NAMES PEOPLE NOW, NOT RANKS.
  //
  // It read «مکان رتبهٔ ۱, مکان رتبهٔ ۲, …», which repeated a ranking the list already
  // states and answered the one question a coloured pin raises — whose is it? — with
  // nothing. Each row is the proposer's name in the proposer's own colour, and the
  // coordinates are still announced for a screen reader through the marker label.
  assert.match(MAP, /t\('map\.proposalPinLabel', \{\s*name: destination\.proposer,/);
  assert.match(MAP, /t\('location\.youAreHere'\)/);
});

test('a proposal pin wears its proposer’s colour, not the app’s accent', () => {
  // Arrange — the report: "display proposal locations by map pins, not circles, and
  // colour each proposal pin by proposer colour (the same colour that texts use)".
  const markerColour = /color: destination\.color/.test(MAP);
  const legendColour = /color=\{destination\.color\}/.test(MAP);
  const fromNickname = /color: colorForNickname\(proposal\.proposer_name\)/.test(HOME);

  // Assert
  assert.ok(markerColour, 'the pin is not coloured by the proposer');
  assert.ok(legendColour, 'the legend swatch is not the proposer’s colour');
  assert.ok(fromNickname, 'the destination carries no proposer colour to use');
});

test('the level-4 state is a designed surface, not a blank frame', () => {
  // Assert — no token, no endpoints and a failed basemap all land here, and it
  // says so rather than rendering nothing.
  assert.match(MAP, /!hasAnyLocation \|\| basemapFailed/);
  assert.match(MAP, /map\.unavailableOnWeb/);
});

test('the event map is mounted on the event home, above the cards', () => {
  // Assert — it frames the list, so it sits before it.
  const mapAt = HOME.indexOf('<EventRouteMap');
  const listAt = HOME.indexOf('rankedProposals.map((proposal) => {');

  assert.ok(mapAt > 0, 'the event home does not mount the route map');
  assert.ok(mapAt < listAt, 'the map is below the cards it frames');
});
