/**
 * The origin is a circle, drawn in the reader's own colour, with a routed line.
 *
 * ★ THREE REPORTS, ONE SURFACE.
 *
 * "Don't display the user's origin location with a map pin — use a circle instead."
 * "Colour the origin circle and the routing line with the user's colour instead of
 * black." "The routing lines are just straight dashed lines, not real navigation
 * routes; use real routing data, and normal lines."
 *
 * Each was a separate cause:
 *
 *  1. the origin was a `MapMarker` like any other, and a marker was a teardrop;
 *  2. its colour was `theme.info`, which is the near-black `palette.espresso` on the
 *     light theme — so the reader's position and every line to a proposal were the
 *     darkest thing on the map;
 *  3. the lines were straight because the geometry came back `straight_line` and was
 *     drawn dashed on purpose: the fallback was announced in the drawing.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { ORIGIN_COLOR, ORIGIN_SHAPE, originMarker } from '@/src/features/map/origin';
import { map as mapTokens, themes } from '@/src/theme/tokens';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const EVENT_MAP = code('src/features/venues/components/EventRouteMap.tsx');
const PROPOSAL_MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');
const WEB = code('src/components/ui/InteractiveMap.web.tsx');
const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');
const SHARED = code('src/components/ui/InteractiveMap.tsx');

/* ── The shape ────────────────────────────────────────────────────────────── */

test('the payload says a circle, and a marker defaults to a pin', () => {
  // Arrange
  const marker = originMarker({ lat: 35.6892, lng: 51.389 }, 'You');

  // Act / Assert — the default is what keeps every existing call site a pin.
  assert.equal(ORIGIN_SHAPE, 'circle');
  assert.equal(marker?.shape, 'circle');
  assert.match(SHARED, /shape\?: 'pin' \| 'circle';/);
});

test('a dot is anchored by its centre, a pin by its tip', () => {
  // ★ THE ANCHOR IS THE PART THAT IS EASY TO GET WRONG.
  //
  // A pin's point is the coordinate, so it is anchored `bottom`. A dot has no point,
  // so the same anchor would draw the reader's position half a pin-height north of
  // where they are — a silent, plausible-looking error.
  assert.match(WEB, /anchor: circle \? 'center' : 'bottom'/);
  assert.match(NATIVE, /anchor: isCircle \? 'center' : 'bottom'/);
});

test('both renderers draw the circle as a disc, not a teardrop', () => {
  assert.match(WEB, /borderRadius = '50%'/, 'the web dot is not round');
  assert.match(NATIVE, /\.dot \{ border-radius: 50%;/, 'the native dot is not round');
});

test('an undrawable origin draws nothing rather than a dot at null island', () => {
  assert.equal(originMarker(null, 'You'), null);
  assert.equal(originMarker({ lat: Number.NaN, lng: 51 }, 'You'), null);
  assert.equal(originMarker({ lat: 89, lng: 51 }, 'You'), null);
});

/* ── The colour ───────────────────────────────────────────────────────────── */

test('the origin has its own colour, not the theme’s info', () => {
  // Arrange — `info` is `palette.lilac` on the dark theme and `palette.espresso`
  // (near-black) on the light one. A map colour cannot be a theme colour.
  assert.equal(ORIGIN_COLOR, mapTokens.originFill);
  assert.notEqual(ORIGIN_COLOR, themes.light.info);
  assert.notEqual(ORIGIN_COLOR, themes.dark.info);
});

test('the origin colour is not black on either theme', () => {
  // Act — the luminance of a hex colour, so "not black" is measured rather than
  // eyeballed.
  const hex = ORIGIN_COLOR.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));

  // Assert — a channel max of at least 0x50 means it is a colour, not a shadow.
  assert.ok(Math.max(r ?? 0, g ?? 0, b ?? 0) > 0x50, `origin ${ORIGIN_COLOR} is too dark`);
});

test('every map call site takes its origin from the one module', () => {
  // Assert — the two decoration maps used `theme.info`, which is where the black came
  // from, and a third copy would bring it back.
  assert.match(EVENT_MAP, /originMarker\(origin/);
  assert.match(PROPOSAL_MAP, /originMarker\(drawableOrigin/);
  assert.doesNotMatch(EVENT_MAP, /color: theme\.info/);
  assert.doesNotMatch(PROPOSAL_MAP, /color: theme\.info/);
});

test('the route line wears the colour of the pin it leads to', () => {
  // ★ NOT THE ORIGIN'S. One colour for every line answered "where am I going?" with
  // the reader's own hue, so a route read as a property of the reader rather than of
  // the proposal it leads to. On the event map each line takes its DESTINATION's
  // colour — that proposal's proposer — and on the card it takes the pin's accent.
  assert.match(EVENT_MAP, /colorById\.get\(id\) \?\? ORIGIN_COLOR/);
  assert.match(EVENT_MAP, /destination\.color\]\)/);
  assert.match(PROPOSAL_MAP, /color: appearance\.accent/);
  assert.doesNotMatch(EVENT_MAP, /^\s+color: ORIGIN_COLOR,$/m, 'the event line ignores its destination');
});

/* ── The line ─────────────────────────────────────────────────────────────── */

test('the decoration maps never draw a dashed line', () => {
  // Arrange — the report: "use normal lines, not dashed lines". The dash was the
  // fallback announcing itself; a straight line that is solid is still honest,
  // because the legend says so and the geometry is the provider's when it answers.
  assert.match(EVENT_MAP, /dashed: false/);
  assert.match(PROPOSAL_MAP, /dashed: false/);
});

test('the dash expression is a valid MapBox case, so the layer compiles', () => {
  // ★ THE ROUTE LAYER COULD NOT LOAD, ON EITHER PLATFORM.
  //
  // `['case', ['get','dashed'], [2,2], [1,0]]` gives the branches as bare arrays,
  // which a data-driven paint property reads as EXPRESSIONS rather than as a dash
  // pattern — so the layer failed to compile and the whole line was missing. Wrapping
  // the pattern in `['literal', …]` is what makes it data.
  for (const [label, file] of [
    ['web', WEB],
    ['native', NATIVE],
  ] as const) {
    assert.match(file, /line-dasharray'\]?: \['case', \['get', 'dashed'\], \['literal', \[2, 2\]\], \['literal', \[1, 0\]\]\]|line-dasharray': \['case', \['get', 'dashed'\], \['literal', \[2, 2\]\], \['literal', \[1, 0\]\]\]/, `${label}: the dash pattern is not wrapped as a literal`);
  }
});
