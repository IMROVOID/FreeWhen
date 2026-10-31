/**
 * The proposal's own map: a real map, with the route to it from where you are.
 *
 * ★ THE REPORTED DEFECTS, IN ORDER.
 *
 *  - "The map's not visible on Proposals on the Event page, it's just a simple
 *    Location icon." The card held a MapBox Static Images `<Image>`; without an
 *    inlined token — or with the request refused — it degraded to a single `MapPin`
 *    glyph, because the fallback was the only thing it could show.
 *  - "The maps should be interactable/draggable like other maps in the app."
 *    A still image cannot be.
 *  - "The map on individual proposal boxes should display the proposed location as a
 *    Map Pin (with the app's Accent colour) and the user's own location connected to
 *    it using the routing system. If the user hasn't selected a location, just
 *    display the proposed location."
 *
 * `ProposalRouteMap` is the answer to all three, and this file pins each property.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');
const CARD = code('src/features/proposals/components/ProposalCard.tsx');
const HOME = code('app/event/[id]/index.tsx');

/* ── It is a map, not a picture ───────────────────────────────────────────── */

test('the card mounts the shared interactive map, not a static image', () => {
  // Arrange — a picture of a map is not a map: it cannot be dragged, tilted or
  // zoomed, and it collapses to a glyph when it cannot be fetched.
  const usesSurface = /<InteractiveMap\b/.test(MAP);
  const importsSurface = /from '@\/src\/components\/ui\/InteractiveMap'/.test(MAP);

  // Assert
  assert.ok(importsSurface, 'the card does not use the app’s own map surface');
  assert.ok(usesSurface, 'the card renders no map');
  assert.doesNotMatch(MAP, /expo-image|<Image\b|staticMapUrl/, 'the card still draws a still image');
});

test('the frame is tall enough to be a map rather than a strip', () => {
  // Arrange — the still image it replaced was 96pt, which reads as a banner.
  const height = /PROPOSAL_ROUTE_MAP_HEIGHT = (\d+)/.exec(MAP)?.[1];

  // Assert
  assert.ok(height, 'the map has no named height');
  assert.ok(Number(height) >= 160, `the map is ${height}pt tall, which is still a strip`);
});

test('the card passes the venue’s own coordinates and its name', () => {
  // Assert — the pin is the proposal, and the name is its accessible description.
  assert.match(CARD, /<ProposalRouteMap/);
  assert.match(CARD, /destination=\{\{ lat: proposal\.venue\.lat, lng: proposal\.venue\.lng \}\}/);
  assert.match(CARD, /label=\{proposal\.venue\.name\}/);
});

/* ── The proposed pin wears the app's accent ─────────────────────────────── */

test('the proposed pin is the app’s accent, and it is the selected marker', () => {
  // Arrange — on THIS map there is one proposal in view, so the proposer's name
  // already says whose it is; the pin wears the product's colour, as asked.
  const accent = /color: theme\.primary,/.test(MAP);
  const selected = /selected: true,/.test(MAP);

  // Assert
  assert.ok(accent, 'the proposed pin does not use the app accent');
  assert.ok(selected, 'the proposed pin is not distinguished as the subject');
});

/* ── The origin and the route ─────────────────────────────────────────────── */

test('with a start point, the route is drawn from it', () => {
  // Assert — the same geometry proxy the event map uses, so the two cannot
  // disagree about the road between the same two places.
  assert.match(MAP, /fetchRoute\(drawableOrigin, destination\)/);
  assert.match(MAP, /fallbackRoute\(drawableOrigin, destination\)/);
  // SOLID NOW, AND THAT IS THE REPORT: a dashed line read as approximate, and a
  // fallback drawn solid is still honest because the geometry module labels it.
  assert.match(MAP, /dashed: false/);
});

test('without a start point, the proposed place is drawn alone', () => {
  // Arrange ★ A LINE FROM NOWHERE IS A LIE ABOUT WHERE THE READER IS.
  //
  // The origin is the caller's own `start_point`, which they may never have set. The
  // report is explicit: "if the user hasn't selected a location, just display the
  // proposed location".
  // The origin marker is built by `originMarker`, which answers null for a coordinate
  // the projection cannot draw — so an absent origin adds no marker at all.
  const alone = /const originPoint = originMarker\(drawableOrigin, t\('location\.youAreHere'\)\);\s*if \(originPoint === null\) return \[proposed\];/.test(MAP);
  const noRoute = /if \(drawableOrigin === null\) \{\s*\n\s*setRoute\(null\);/.test(MAP);

  // Assert
  assert.ok(alone, 'the card draws an origin it does not have');
  assert.ok(noRoute, 'a route is fetched with no origin to fetch it from');
});

test('an unusable origin is treated as no origin', () => {
  // Assert — a NaN or out-of-range coordinate would otherwise put the origin in the
  // ocean and the route across the world.
  assert.match(MAP, /Number\.isFinite\(origin\.lat\)/);
  assert.match(MAP, /Math\.abs\(origin\.lat\) <= 85\.0511/);
});

test('the event screen hands each card the caller’s own start point', () => {
  // Arrange ★ THE CARD CANNOT LOOK THIS UP.
  //
  // `listParticipants` deliberately carries `start_point_state`, never a coordinate —
  // the server decides what each viewer may see. The event screen is the one place
  // holding the resolved point.
  const passed = /<ProposalCard[\s\S]{0,400}?origin=\{myStartPoint\}/.test(HOME);

  // Assert
  assert.ok(passed, 'the card is given no origin, so it can never draw a route');
});

/* ── The camera is a pose, not a mirror ──────────────────────────────────── */

test('the card map’s camera is memoized on values, not rebuilt per render', () => {
  // Assert — a new object every render would tell the map to jump on every parent
  // re-render, which is what makes a drag die when a vote lands elsewhere on the page.
  assert.match(MAP, /const camera = useMemo\(/);
  assert.match(MAP, /\[drawableOrigin, destination\.lat, destination\.lng\]/);
});

/* ── The level-4 state ───────────────────────────────────────────────────── */

test('a failed basemap is a stated state, not an empty card', () => {
  // Assert — no token, no WebGL and a refused style all land here, and the caller's
  // text keeps the place and its coordinates.
  assert.match(MAP, /if \(basemapFailed\)/);
  assert.match(MAP, /onUnavailable=\{\(\) => setBasemapFailed\(true\)\}/);
});
