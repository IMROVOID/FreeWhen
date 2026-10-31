/**
 * The MapBox token is public, and its absence is a designed state.
 *
 * ★ WHY THIS SUITE EXISTS.
 *
 * The migration to MapBox moved the required public build variable from CARTO's
 * key to MapBox's. Two failures are possible and both are silent:
 *
 *  1. the variable is not in the bundler's shell, so the bundle inlines an empty
 *     string and the map renders the level-4 state on every device;
 *  2. the variable holds an `sk.` SECRET token, which would publish a credential
 *     in every tile request.
 *
 * Neither throws. Both look like "the map is not loading". So the reader refuses
 * anything that is not a `pk.` token, and returns `null` — which the callers
 * treat as "no map configured", the honest level-4 state.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  MAPBOX_STATIC_BASE,
  MAPBOX_STYLE,
  hasMapbox,
  readMapboxToken,
  styleForTheme,
} from '@/src/features/map/mapbox-token';
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, clampZoom, mapAppearance } from '@/src/features/map/appearance';
import { DEFAULT_PITCH, MEET_POINT_PITCH } from '@/src/features/map/types';

const ENV = 'EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN';

function setToken(value: string | undefined): void {
  const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;

  if (value === undefined) delete env[ENV];
  else env[ENV] = value;
}

afterEach(() => {
  setToken(undefined);
});

/* ── The token ────────────────────────────────────────────────────────────── */

test('a pk. token is read back verbatim', () => {
  // Arrange
  setToken('pk.eyJ1IjoiZml4dHVyZSIsImEiOiJjbG9jYWx0ZXN0YWNjb3VudCJ9.c2lnbmF0dXJlZm9yfHRlc3Rz');

  // Act / Assert
  assert.equal(
    readMapboxToken(),
    'pk.eyJ1IjoiZml4dHVyZSIsImEiOiJjbG9jYWx0ZXN0YWNjb3VudCJ9.c2lnbmF0dXJlZm9yfHRlc3Rz',
  );
});

test('a secret sk. token is refused, so it can never reach a request', () => {
  // Arrange — a configuration mistake, not an attack: `sk.` and `pk.` sit beside
  // each other in the MapBox console.
  setToken('sk.eyJsZWNyZXQiOiJ0b2tlbiIsInR5cGUiOiJzZWNyZXQifQ.notarealtoken');

  // Act / Assert
  assert.equal(readMapboxToken(), null, 'a secret token was accepted as the public one');
  assert.equal(hasMapbox(), false, 'the build claimed a usable map while holding a secret');
});

test('an absent, empty or malformed value reads as "no token", never as an error', () => {
  // Arrange — the browser build and the Node test runner both reach this with no
  // variable at all.
  const cases: Array<string | undefined> = [
    undefined,
    '',
    '   ',
    'eyJ1IjoieGx2aXJ1cyJ9',
    'pk.',
  ];

  for (const value of cases) {
    // Act
    setToken(value);
    const token = readMapboxToken();

    // Assert — an empty `pk.` is present but unusable, so it is null. A bare
    // payload is not a token at all.
    assert.equal(token, null, `"${String(value)}" was accepted as a token`);
  }
});

test('the token is trimmed, so a trailing newline does not corrupt a request', () => {
  // Arrange — a CI secret pasted with a trailing newline is the common case.
  setToken('  pk.abc.def\n');

  // Act / Assert
  assert.equal(readMapboxToken(), 'pk.abc.def');
});

/* ── The styles ───────────────────────────────────────────────────────────── */

test('both themes resolve to MapBox Standard, which carries 3D buildings', () => {
  // ★ THIS ASSERTS THE STYLE PAIR DIFFERED UNTIL THE PRODUCT SWITCHED TO STANDARD.
  //
  // `streets-v12` and `dark-v11` carry no `fill-extrusion` layer at all — measured
  // on the live map — so no pitch could ever make the product 3D. Standard is one
  // style with a `lightPreset`, so light and dark now share a URI and differ by
  // APPEARANCE. The theme still reaches the map; `lightPreset` is what carries it,
  // and `map-3d.test.ts` asserts that wiring.
  assert.match(styleForTheme('dark'), /standard/);
  assert.match(styleForTheme('light'), /standard/);
});

test('both styles are mapbox:// URIs, so one public token serves both', () => {
  // Assert — a style named by URL would need provisioned access per style.
  for (const style of Object.values(MAPBOX_STYLE)) {
    assert.match(style, /^mapbox:\/\/styles\/mapbox\//);
  }
});

test('the static-image base is the MapBox API, not a tile CDN', () => {
  // Assert — this is the constant that replaced the CARTO tile URL builder.
  assert.match(MAPBOX_STATIC_BASE, /^https:\/\/api\.mapbox\.com\//);
  assert.doesNotMatch(MAPBOX_STATIC_BASE, /cartocdn|basemaps\./);
});

/* ── The appearance ───────────────────────────────────────────────────────── */

test('the map takes the app accent, never a hardcoded colour', () => {
  // Act
  const appearance = mapAppearance('dark', '#7C4DFF');

  // Assert — the value handed to the renderer IS the theme's primary.
  assert.equal(appearance.accent, '#7C4DFF');
  assert.equal(appearance.mode, 'dark');
});

test('the accent follows the theme rather than a constant', () => {
  // Act
  const first = mapAppearance('light', '#0055FF');
  const second = mapAppearance('light', '#FF5500');

  // Assert — two accents produce two values; a literal would produce one.
  assert.notEqual(first.accent, second.accent);
});

test('the map rests at a three-dimensional pitch, and that is a default', () => {
  // Act
  const appearance = mapAppearance('light', '#000');

  // Assert — a pitch of 0 is the flat camera this migration replaces.
  assert.ok(appearance.pitch > 0, 'the map still rests flat, so nothing reads as 3D');
  assert.ok(appearance.pitch <= 60, `a pitch of ${appearance.pitch}° is past legible`);
  assert.equal(DEFAULT_PITCH, appearance.pitch);
});

test('the resting pitch and the meet-point reveal agree, so the camera does not jump', () => {
  // Assert — they were 0 and 50 before, which is a visible lurch between screens.
  assert.equal(DEFAULT_PITCH, MEET_POINT_PITCH);
});

test('zoom is clamped to the range both renderers support', () => {
  // Assert
  assert.equal(clampZoom(1), MIN_MAP_ZOOM);
  assert.equal(clampZoom(99), MAX_MAP_ZOOM);
  assert.equal(clampZoom(14), 14);
  // A NaN zoom would reach the renderer as an invalid camera and flatten it.
  assert.ok(Number.isFinite(clampZoom(Number.NaN)));
});

test('no source file names a CARTO endpoint', async () => {
  // Arrange — the migration's own acceptance test. A single leftover reference
  // means one surface still draws the old provider.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  // Act
  const offenders = walk('src')
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !file.includes('mapbox-token'))
    .filter((file) => /cartocdn|carto\.com|_CARTO_/i.test(readFileSync(file, 'utf8')));

  // Assert
  assert.deepEqual(offenders, [], `CARTO is still referenced in: ${offenders.join(', ')}`);
});
