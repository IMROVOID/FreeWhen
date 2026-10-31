/**
 * The map must render in three dimensions, not only report a pitched camera.
 *
 * ★ THE DEFECT THIS REPRODUCES: A PITCHED CAMERA THAT LOOKS FLAT.
 *
 * `DEFAULT_PITCH` is 50 and the live instance confirmed `getPitch() === 50`, yet
 * the map reads as a top-down 2D picture. Measured on production, two independent
 * causes — and neither is the pitch value:
 *
 * 1. **NO LAYER CAN BE VERTICAL.** `streets-v12` and `dark-v11` ship 52 layers
 *    between them and `fill-extrusion` appears ZERO times. Pitch tilts a flat
 *    raster; it cannot make a building rise. Only MapBox's Standard style carries
 *    a buildings extrusion, so on these two styles 3D is impossible however the
 *    camera is set.
 *
 * 2. **THE PROJECTION IS GLOBE, NOT MERCATOR.** The live transform reported
 *    `worldSize: 1048576` at zoom 11 (mercator would be 2048) with
 *    `getProjection().name === 'globe'` beside `transform.projection === 'mercator'`.
 *    Projecting 0.01° N/S against E/W gave a vertical compression of 0.795 where
 *    cos(50°) = 0.643 demands 0.643, and a point 0.2° south returned
 *    `Number.MAX_VALUE`. The tilt is requested and only partly applied.
 *
 * So `pitch: 50` was necessary and not sufficient, and the component never said
 * which projection it wanted — the default changed under it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const WEB = readFileSync('src/components/ui/InteractiveMap.web.tsx', 'utf8');
const TOKENS = readFileSync('src/features/map/mapbox-token.ts', 'utf8');

/* ── The projection ───────────────────────────────────────────────────────── */

test('the map pins mercator, so a pitched camera is a true tilt', () => {
  // Arrange — the live map came up globe-projected while asking for mercator,
  // which corrupts the pitch transform at city zoom.

  // Act
  const pinsProjection = /projection:\s*'mercator'/.test(WEB);

  // Assert
  assert.equal(
    pinsProjection,
    true,
    'the map does not pin its projection, so it can come up globe-projected and render a pitched camera almost flat',
  );
});

test('the camera may tilt past the default cap', () => {
  // Assert — `maxPitch` defaults to 60 and the product rests at 50; naming it
  // keeps a future style or library default from lowering it silently.
  assert.match(WEB, /maxPitch:\s*\d+/, 'maxPitch is not declared');
});

/* ── The geometry that can actually stand up ─────────────────────────────── */

test('a style is requested that can carry vertical geometry', () => {
  // Arrange — a `fill-extrusion` layer is the only thing that renders as 3D.
  // Neither bundled classic style has one, so the app either uses Standard (which
  // ships 3D buildings) or adds the layer itself.
  const source = `${TOKENS}\n${WEB}`;

  // Act
  const usesStandard = /styles\/mapbox\/standard/.test(source);
  const addsExtrusion = /fill-extrusion/.test(source);

  // Assert
  assert.equal(
    usesStandard || addsExtrusion,
    true,
    'neither style carries a fill-extrusion layer and the app adds none, so the map can never show 3D buildings at any pitch',
  );
});

test('3D is a resting pose the user can flatten, not a lock', () => {
  // Assert — the pitch stays a default; nothing clamps it back.
  const types = readFileSync('src/features/map/types.ts', 'utf8');
  assert.match(types, /export const DEFAULT_PITCH = \d+/, 'DEFAULT_PITCH is not a plain default');
  assert.doesNotMatch(WEB, /dontAllowPitch|pitchWithRotate:\s*false|touchPitch:\s*false/);
});

/* ── The theme must survive the style change ─────────────────────────────── */

test('3D does not cost dark mode, even though both themes share one style', () => {
  // ★ THIS TEST USED TO ASSERT THE TWO STYLE URIs DIFFERED.
  //
  // That was right for `streets-v12` / `dark-v11` and became wrong the moment the
  // product switched to Standard, which is ONE style with a `lightPreset`. Left
  // uncorrected it would either fail forever or — worse — pass vacuously if someone
  // "fixed" it by splitting the URIs back.
  //
  // The property that actually matters is: the theme REACHES the map. With a single
  // style that can only happen through `lightPreset`, so it is asserted instead.
  assert.match(TOKENS, /light:/, 'the light entry is gone');
  assert.match(TOKENS, /dark:/, 'the dark entry is gone');
  assert.match(
    WEB,
    /setConfigProperty\(\s*'basemap'\s*,\s*'lightPreset'/,
    'the theme never reaches Standard, so dark mode would silently become light',
  );
  assert.match(WEB, /applyLightPreset\(map, theme\)/, 'the preset is never applied');
});

test('the preset is applied again once the basemap import has loaded', () => {
  // ★ THE FIRST VERSION OF THIS TEST PASSED WHILE DARK MODE WAS BROKEN.
  //
  // It asserted that `setConfigProperty('basemap', 'lightPreset', …)` appeared in
  // the source — and it did. But Standard's basemap is a style IMPORT and the call
  // only sticks once that import has loaded: verified live, where the app was in
  // dark mode and `getConfigProperty('basemap','lightPreset')` still returned
  // `"day"`, rendering a light map on a dark page.
  //
  // A single immediate call is therefore not the fix; a second application after
  // the style finishes loading is.
  assert.match(
    WEB,
    /map\.once\(\s*'style\.load'/,
    'the preset is never reapplied after the basemap import loads, so Standard keeps its default appearance',
  );
});
