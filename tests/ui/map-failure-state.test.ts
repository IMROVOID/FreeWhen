/**
 * A map that cannot draw must SAY SO, not render an empty frame.
 *
 * ★ THE ORIGINAL DEFECT THIS PINS.
 *
 * `LocationMapPicker` built every tile URL from `process.env.EXPO_PUBLIC_CARTO_API_KEY`,
 * and that variable was absent from the Vercel project. The provider's CDN was
 * key-gated for production referrers, so the deployed bundle requested unkeyed
 * tiles that failed.
 *
 * The picker had **no `onError` handler**. Every `<Image>` resolved to a failure
 * and painted nothing, so the map frame stayed a blank rectangle — and because
 * nothing threw, nothing was logged either. The runtime log was clean, which is why
 * the deployment looked healthy while the map was dead.
 *
 * ★ A SILENT BLANK IS THE WORST AVAILABLE FAILURE MODE.
 *
 * The user cannot tell "still loading" from "broken", has no retry, and reports it
 * as "the map isn't loading" with nothing to act on. The rule therefore outlives
 * the provider: a map surface must be able to report that it cannot draw, and the
 * picker must render a stated state when it does.
 *
 * ★ WHAT CHANGED WITH THE MIGRATION.
 *
 * A `<Image>` per tile could call `onError` per tile. A map library draws into one
 * canvas and throws nothing, so the two signals are now:
 *
 *  - **no token**, decided before any library loads — `hasMapbox()` at mount;
 *  - **the renderer reporting** it could not initialise, via `onUnavailable`.
 *
 * Both set the same flag, and the flag is what the reader sees. The assertions
 * below are about that flag and that render, not about tile images.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PICKER = 'src/components/ui/LocationMapPicker.tsx';

test('a basemap that cannot draw is handled, not ignored', () => {
  // Arrange — the picker must subscribe to BOTH failure signals, because a
  // tokenless build never reaches the library at all.
  const picker = code(PICKER);

  // Assert
  assert.ok(
    /onUnavailable=/.test(picker),
    'the picker does not listen for the renderer reporting it cannot draw',
  );
  assert.ok(
    /hasMapbox\(\)/.test(picker),
    'the picker does not check for a token, so a tokenless build draws nothing silently',
  );
});

test('a failed map renders a stated state rather than an empty frame', () => {
  // Arrange
  const picker = code(PICKER);

  // Act — a flag, set from both signals and read by the render.
  const hasFlag = /basemapFailed/.test(picker);
  const gate = /\{basemapFailed && \(/.test(picker);
  const setsOnUnavailable = /onUnavailable=\{\(\) => setBasemapFailed\(true\)\}/.test(picker);

  // Assert
  assert.ok(hasFlag, 'the picker has no failure flag');
  assert.ok(gate, 'the failure flag is never read, so nothing is said to the user');
  assert.ok(setsOnUnavailable, 'no signal clears a failed basemap into a stated state');
});

test('a tokenless build starts in the stated state instead of trying to draw', () => {
  // Arrange — `useState(() => !hasMapbox())` is the whole mechanism: the map is
  // never mounted, so there is no blank canvas to interpret.
  const picker = code(PICKER);

  // Assert
  assert.match(
    picker,
    /useState\(\(\) => !hasMapbox\(\)\)/,
    'the initial failure state is not derived from the token, so a tokenless build mounts a dead canvas',
  );
});

test('the map surface is not mounted at all once it has failed', () => {
  // Arrange — rendering the surface AND the failure overlay would put a live,
  // invisible map under a "map unavailable" message, and on web the library would
  // keep retrying its style.
  const picker = code(PICKER);

  // Assert
  assert.match(
    picker,
    /\{!basemapFailed && \(\s*<InteractiveMap/,
    'the map surface still mounts while the failure state is showing',
  );
});

test('the failure state reuses existing copy rather than inventing a sentence', () => {
  // Arrange — `map.unavailableOnWeb` / `map.unavailableOnWebBody` already exist in
  // both catalogues and are what `VenueMap.web.tsx` shows.
  const picker = code(PICKER);

  // Assert
  assert.ok(/map\.unavailable/.test(picker), 'the failure state has no catalogued copy');
});

test('the map reads the token from one module, and the deploy provides that name', () => {
  // Arrange — the invariant that outlived the provider swap: the name the picker
  // reads and the name the deploy passes must be the same string, or the bundle
  // inlines an empty value and every map renders the stated state forever.
  const picker = code(PICKER);
  const tokenModule = code('src/features/map/mapbox-token.ts');
  const deploy = code('.github/workflows/deploy.yml');

  // Assert
  assert.match(picker, /hasMapbox/);
  assert.match(tokenModule, /EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN/);
  assert.match(deploy, /EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN/);
});

test('a build without the key is caught before deploy, not discovered by a user', () => {
  // Arrange — a MISSING public variable is a quiet failure mode no existing gate
  // could see: the secret gates look for a credential that should NOT be in the
  // bundle, not one that is missing FROM it.
  const runner = code('scripts/gate/all.ts');
  const gate = code('scripts/gate/env.ts');

  // Assert
  assert.ok(/gate:env/.test(runner), 'the gate runner does not run the env gate');
  assert.ok(
    /EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN/.test(gate),
    'the env gate does not check the MapBox public token',
  );
  assert.ok(
    /vercel env add/.test(gate),
    'the failure message does not say how to fix the deploy',
  );
});
