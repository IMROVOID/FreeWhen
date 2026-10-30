/**
 * The picker's map is a real one: interactive, themed, three-dimensional.
 *
 * ★ THE THREE THINGS THE OLD PICKER COULD NOT DO.
 *
 * It was a grid of raster `<Image>` tiles. That has consequences the product felt:
 *
 *  - **a tap did nothing.** The `PanResponder` deliberately declined the tap so a
 *    vertical swipe could scroll the page, which meant "click anywhere on the map
 *    to choose the location" was a drag-then-confirm gesture nobody discovered;
 *  - **it was flat, always.** Raster tiles are drawn at pitch 0 and there is no
 *    camera to tilt;
 *  - **it was one fixed basemap.** Dark mode composited a labels-only layer over a
 *    label-less one because the provider's own dark style drew place names in a
 *    grey that vanished on the app's frame.
 *
 * Each of those is a property now, so each is asserted here rather than described.
 *
 * ★ AND THE PICKER'S OWN CONCERNS SURVIVED THE SWAP.
 *
 * Search, the debounced query, the degraded state, the confirm card and the
 * selected place's coordinates are all still this component's job. `map-controls`
 * and `map-place-actions` cover the layout half; this file covers the map.
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

const PICKER = code('src/components/ui/LocationMapPicker.tsx');

/* ── Click to place ───────────────────────────────────────────────────────── */

test('a tap on the map drops the pin, which is the plainest way to choose a place', () => {
  // Arrange — the surface reports a coordinate; the picker commits it.
  const handles = /onPress=\{handlePress\}/.test(PICKER);
  const commits = /const handlePress = \(coordinate[\s\S]{0,200}?commitCentre\(coordinate\)/.test(PICKER);

  // Assert
  assert.ok(handles, 'the picker does not pass a press handler, so a tap does nothing');
  assert.ok(commits, 'the pressed coordinate is not committed as the selection');
});

test('a search result moves the map, and a tap clears a stale search name', () => {
  // Arrange — the two paths must agree about what the pin is called, or a place
  // searched by name shows the name while sitting somewhere else.
  const fromSearch = /handleSelectSearchResult[\s\S]{0,200}?commitCentre\(\{ lat: result\.lat, lng: result\.lng \}\)/.test(
    PICKER,
  );
  const resetsName = /setPlaceName\(\(current\)[\s\S]{0,200}?proposals\.place\.customPin/.test(PICKER);

  // Assert
  assert.ok(fromSearch, 'a chosen search result does not move the map');
  assert.ok(resetsName, 'a hand-placed pin keeps the previous result’s name');
});

/* ── 3D and camera ────────────────────────────────────────────────────────── */

test('the picker rests at a pitched camera, so the map reads as 3D', () => {
  // Arrange — the pitch comes from the appearance, which is the value the
  // migration changed from 0 to 50.
  const appearance = /mapAppearance\(themeName, theme\.primary\)/.test(PICKER);
  const passesPitch = /pitch: appearance\.pitch/.test(PICKER);

  // Assert
  assert.ok(appearance, 'the picker does not resolve its own appearance');
  assert.ok(passesPitch, 'the camera is handed no pitch, so the map is flat');
});

test('the user owns the camera: every settled move is recorded', () => {
  // Assert — the selected coordinate must follow the camera, or the confirm card
  // reports a place the pin is no longer over.
  assert.match(PICKER, /onCameraChange=\{\(camera\) => commitCentre\(camera\.centre\)\}/);
});

test('zoom is offered and clamped to the range the style has data for', () => {
  // Assert — beyond 20 the basemap has no tiles and the frame goes blank.
  assert.match(PICKER, /Math\.max\(3, Math\.min\(20, current \+ delta\)\)/);
  assert.match(PICKER, /accessibilityLabel=\{t\('map\.zoomIn'\)\}/);
  assert.match(PICKER, /accessibilityLabel=\{t\('map\.zoomOut'\)\}/);
});

/* ── Theme and accent ─────────────────────────────────────────────────────── */

test('the basemap follows the app theme, from the shared resolver', () => {
  // Assert — a second theme rule is how the two maps in this app start
  // disagreeing about what dark looks like.
  assert.match(PICKER, /theme=\{appearance\.mode\}/);
  assert.match(PICKER, /mapAppearance\(/);
});

test('the marker takes the app accent, never a map default', () => {
  // Arrange — the request was explicit: the map should react to the appearance
  // colour.
  const marker = /color: theme\.primary,/.test(PICKER);
  const accent = /accent=\{appearance\.accent\}/.test(PICKER);

  // Assert
  assert.ok(marker, 'the marker does not use the theme’s primary colour');
  assert.ok(accent, 'the surface is not told the accent');
});

test('no hex colour is hardcoded in the picker', () => {
  // Arrange — a literal looks correct on the default theme and wrong on all the
  // others, which is the hardest kind of colour bug to report.
  const literals = [...PICKER.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);

  // Assert
  assert.deepEqual(literals, [], `the picker hardcodes colours: ${literals.join(', ')}`);
});

/* ── The selection itself ─────────────────────────────────────────────────── */

test('the pin is labelled, so the selection is not a silent dot', () => {
  // Assert
  assert.match(PICKER, /label: placeName \|\| t\('proposals\.place\.customPin'\)/);
});

test('the confirmed place carries five decimals, which is finer than a pin', () => {
  // Assert — a payload with fewer digits is a place the ranking cannot measure.
  assert.match(PICKER, /lat: Number\(lat\.toFixed\(5\)\)/);
  assert.match(PICKER, /lng: Number\(lng\.toFixed\(5\)\)/);
});

test('the confirm card still shows where the pin is', () => {
  // Assert — this is the only path from "map open" to "place chosen", and the
  // coordinates are the line that always exists (a hand-dropped pin has no address).
  assert.match(PICKER, /formatCoordinates\(lat, lng\)/);
  assert.match(PICKER, /-confirm/);
});

/* ── Interaction the old picker could not offer ───────────────────────────── */

test('the picker no longer hand-rolls a tile grid or a pan responder', () => {
  // Arrange — six pieces of geometry, three of which had already shipped a defect.
  // A real library owns all of it now.
  const artefacts = [
    'PanResponder',
    'ResizeObserver',
    'centreTileFor',
    'tileOffsetFor',
    'gridSpanFor',
    'gridOriginFor',
    'MAP_TILE_SIZE',
    'rastertiles',
  ];

  // Act
  const survivors = artefacts.filter((name) => PICKER.includes(name));

  // Assert
  assert.deepEqual(survivors, [], `the picker still carries ${survivors.join(', ')}`);
});

test('the map surface itself is the only place a map library is imported', () => {
  // Assert — the platform substitution rule, applied to this feature. A library
  // import here would reach whatever bundle this file lands in.
  assert.doesNotMatch(PICKER, /mapbox-gl|react-native-maps/);
  assert.match(PICKER, /from '@\/src\/components\/ui\/InteractiveMap'/);
});

test('a failed or absent basemap does not lose the search or the confirm', () => {
  // Arrange — the failure is a state of the MAP, not of the picker. Search is a
  // server call and the custom pin is the product's first-class path, so neither
  // may be gated on the basemap drawing.
  //
  // The test isolates the region between the surface block and the confirm card
  // and asserts that BOTH controls live outside any `basemapFailed` branch. The
  // first version of this test compared two indices and passed on source order
  // alone, which proved nothing about the gating.
  const surfaceEnd = PICKER.indexOf('floatingControls');
  const region = PICKER.slice(surfaceEnd, PICKER.indexOf('Bottom Place Confirmation Card'));

  // Act — the failure branch closes before the search bar opens.
  const failureBlock = /\{basemapFailed && \(([\s\S]*?)\)\}/.exec(region)?.[1] ?? '';
  const searchInFailure = /searchBarWrapper/.test(failureBlock);
  const controlsInFailure = /accessibilityLabel=\{t\('map\.zoomIn'\)\}/.test(failureBlock);

  // Assert
  assert.match(PICKER, /\{basemapFailed && \(/, 'the failure state is not gated at all');
  assert.equal(searchInFailure, false, 'the search bar is inside the failure branch');
  assert.equal(controlsInFailure, false, 'the zoom controls are inside the failure branch');
  assert.match(PICKER, /proposals\.place\.degraded/);
});
