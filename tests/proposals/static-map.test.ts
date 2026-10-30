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
import { afterEach, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  PROPOSAL_MAP_PREVIEW_HEIGHT,
  staticMapUrl,
} from '@/src/features/proposals/services/static-map';

let renderComponent: typeof import('../ui/support/render').renderComponent;

const ENV = 'EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN';
const TOKEN = 'pk.eyJ1IjoiZml4dHVyZSIsImEiOiJjbG9jYWx0ZXN0YWNjb3VudCJ9.c2lnbmF0dXJlZm9yfHRlc3Rz';

function setToken(value: string | undefined): void {
  const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
  if (value === undefined) delete env[ENV];
  else env[ENV] = value;
}

before(async () => {
  const { initI18n } = await import('@/src/i18n');
  initI18n('fa');
  ({ renderComponent } = await import('../ui/support/render'));
});

afterEach(() => {
  setToken(undefined);
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

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

test('the theme selects the style, so light and dark cannot share a picture', () => {
  // Arrange
  setToken(TOKEN);

  // Act
  const light = staticMapUrl(35.6892, 51.389, 'light', '#0055FF');
  const dark = staticMapUrl(35.6892, 51.389, 'dark', '#0055FF');

  // Assert
  assert.ok(light && dark);
  assert.match(dark, /dark/);
  assert.notEqual(light, dark, 'both themes produced the same picture');
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

/* ── The component ────────────────────────────────────────────────────────── */

test('a rendered preview carries the venue’s point and a description', async () => {
  // Arrange
  setToken(TOKEN);
  const { ProposalMapPreview } = await import(
    '@/src/features/proposals/components/ProposalMapPreview'
  );

  // Act
  const screen = renderComponent(ProposalMapPreview, {
    lat: 35.6892,
    lng: 51.389,
    label: 'کافه مرکزی',
    testID: 'preview',
  });

  // Assert — the picture is information, so it has a description; an empty alt
  // would make the one element that says WHERE silent to a screen reader.
  assert.match(screen.html, /api\.mapbox\.com/, 'the preview does not request a MapBox image');
  assert.ok(screen.html.includes('کافه مرکزی'), 'the preview has no accessible description');
});

test('an impossible coordinate degrades to a pin, not to a label', async () => {
  // Arrange
  setToken(TOKEN);
  const { ProposalMapPreview } = await import(
    '@/src/features/proposals/components/ProposalMapPreview'
  );

  // Act
  const screen = renderComponent(ProposalMapPreview, {
    lat: Number.NaN,
    lng: 0,
    label: 'کافه',
    testID: 'preview',
  });

  // Assert — a place at no coordinates is still a place: the block shows a pin
  // rather than turning into an error message about one.
  assert.ok(!/api\.mapbox\.com/.test(screen.html), 'a NaN coordinate still requested an image');
  assert.match(screen.html, /data-testid="preview"/, 'the block disappeared instead of degrading');
});

test('a build without a token draws the pin rather than requesting a keyless image', async () => {
  // Arrange — the level-4 state, reached by configuration rather than by failure.
  setToken(undefined);
  const { ProposalMapPreview } = await import(
    '@/src/features/proposals/components/ProposalMapPreview'
  );

  // Act
  const screen = renderComponent(ProposalMapPreview, {
    lat: 35.6892,
    lng: 51.389,
    label: 'کافه مرکزی',
    testID: 'preview',
  });

  // Assert
  assert.ok(!/api\.mapbox\.com/.test(screen.html), 'a tokenless build still asked for a picture');
  assert.match(screen.html, /data-testid="preview"/);
});

test('the preview is a single image layer, not a composited stack', () => {
  // Arrange — the dark path used to render TWO images, one for the canvas and one
  // for the label ink.
  const preview = code('src/features/proposals/components/ProposalMapPreview.tsx');

  // Act
  const images = (preview.match(/<Image\b/g) ?? []).length;

  // Assert
  assert.equal(images, 1, `the preview renders ${images} image layers`);
  assert.doesNotMatch(preview, /dark_only_labels|dark_nolabels/);
});

test('the preview keeps a readable height', () => {
  // Assert
  assert.ok(PROPOSAL_MAP_PREVIEW_HEIGHT >= 96, 'the preview is too short to read as a map');
});
