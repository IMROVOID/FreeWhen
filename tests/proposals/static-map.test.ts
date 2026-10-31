/**
 * The proposal's still picture comes from MapBox, and it degrades to a pin.
 *
 * ★ THE DEFECT THIS PINS: FOUR RULES IN A THUMBNAIL.
 *
 * The preview used to build a CARTO raster-tile URL by hand. A slippy tile is
 * one picture at one zoom, cut from a grid, so the code had to: pick the tile
 * containing the point, choose `@2x` for retina, choose a style per theme, and —
 * because the dark style's place names were mid grey on the app's dark frame —
 * composite `dark_nolabels` UNDER `dark_only_labels` as two stacked `<Image>`s.
 *
 * Every one of those is a rule that can disagree with the interactive map beside
 * it. The Static Images API answers them in one URL: the style is named, the
 * label ink is the style's own, and the density is a parameter.
 *
 * ★ AND IT IS THE SAME PROVIDER THE PICKER USES.
 *
 * Both call `styleForTheme()` and `readMapboxToken()`, so the two pictures cannot
 * disagree about what dark looks like or fail differently on a keyed deployment.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { staticMapUrl } from '@/src/features/proposals/services/static-map';

const ENV = 'EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN';
const TOKEN = 'pk.eyJ1IjoiZml4dHVyZSIsImEiOiJjbG9jYWx0ZXN0YWNjb3VudCJ9.c2lnbmF0dXJlZm9yfHRlc3Rz';

function setToken(value: string | undefined): void {
  const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
  if (value === undefined) delete env[ENV];
  else env[ENV] = value;
}

afterEach(() => {
  setToken(undefined);
});

/* ── The URL ──────────────────────────────────────────────────────────────── */

test('the URL is a MapBox Static Images request, not a raster-tile CDN', () => {
  // Arrange
  setToken(TOKEN);

  // Act
  const url = staticMapUrl(35.6892, 51.389, 'light', '#0055FF');

  // Assert
  assert.ok(url);
  assert.match(url, /^https:\/\/api\.mapbox\.com\/styles\/v1\//);
  assert.match(url, /\/static\//);
  assert.doesNotMatch(url, /cartocdn|basemaps\.|rastertiles/);
});

test('the point is carried as lng,lat — the order the API documents', () => {
  // Arrange — swapping these puts Tehran in the Indian Ocean at the same
  // distance from the equator, which reads as "the map is wrong" not "the
  // arguments are reversed".
  setToken(TOKEN);

  // Act
  const url = staticMapUrl(35.6892, 51.389, 'light', '#0055FF');

  // Assert
  assert.ok(url);
  assert.match(url, /51\.389,35\.6892/);
  assert.doesNotMatch(url, /35\.6892,51\.389/);
});

test('the theme reaches the static picture', () => {
  // Arrange
  setToken(TOKEN);

  // Act — Standard serves both themes, and its appearance is a query parameter on
  // the Static Images API rather than a different style path.
  const light = staticMapUrl(35.6892, 51.389, 'light', '#0055FF');
  const dark = staticMapUrl(35.6892, 51.389, 'dark', '#0055FF');

  // Assert — the two pictures must still BE different, or a dark card would show a
  // light map. With one shared style the difference comes from the appearance
  // parameter, so that is what is asserted.
  assert.ok(light && dark);
  assert.notEqual(light, dark, 'both themes produced the same picture');
  assert.match(dark, /standard/);
});

test('the marker takes the accent the theme supplied', () => {
  // Arrange
  setToken(TOKEN);

  // Act
  const url = staticMapUrl(35.6892, 51.389, 'light', '#7C4DFF');

  // Assert — the `pin-s` overlay is the only place an accent can reach a still
  // image, and it is the theme's value with the hash stripped.
  assert.ok(url);
  assert.match(url, /pin-s\+7C4DFF/);
  assert.doesNotMatch(url, /#/, 'the URL carries a raw #, which truncates the fragment');
});

test('retina density is a parameter, not a second `<Image>` overlay', () => {
  // Arrange
  setToken(TOKEN);

  // Act
  const url = staticMapUrl(35.6892, 51.389, 'light', '#0055FF');

  // Assert — the old dark path stacked two tiles; one @2x request replaces both.
  assert.ok(url);
  assert.match(url, /@2x/);
});

test('with no token there is no URL, rather than a keyless one', () => {
  // Arrange — an unkeyed request comes back as a broken image with nothing in the
  // log, which is the silent-blank failure the tile provider already taught this
  // codebase once.
  setToken(undefined);

  // Act / Assert
  assert.equal(staticMapUrl(35.6892, 51.389, 'light', '#0055FF'), null);
});

test('an impossible coordinate has no URL', () => {
  // Arrange
  setToken(TOKEN);

  // Act / Assert — a payload can carry any number, and the projection is
  // undefined past the poles.
  assert.equal(staticMapUrl(Number.NaN, 51.389, 'light', '#0055FF'), null);
  assert.equal(staticMapUrl(35.6892, Number.POSITIVE_INFINITY, 'light', '#0055FF'), null);
  assert.equal(staticMapUrl(90, 51.389, 'light', '#0055FF'), null);
});
