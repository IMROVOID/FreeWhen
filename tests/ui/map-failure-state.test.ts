/**
 * A map that cannot load its tiles must SAY SO, not render an empty frame.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * `LocationMapPicker` builds every tile URL from
 * `process.env.EXPO_PUBLIC_CARTO_API_KEY`, and that variable is absent from the
 * Vercel project (`vercel env ls` lists only `JWT_SECRET`, `PUBLIC_BASE_URL`,
 * `APP_ORIGIN`, `DATABASE_BACKEND`, `DATABASE_URL`). CARTO's basemap CDN is
 * key-gated for production referrers, so the deployed bundle requested unkeyed
 * tiles that fail.
 *
 * The picker had **no `onError` handler**. Every `<Image>` resolved to a failure and
 * painted nothing, so the map frame stayed a blank rectangle — and because nothing
 * threw, nothing was logged either. The Vercel runtime log was clean, which is why
 * the deployment looked healthy while the map was dead.
 *
 * ★ A SILENT BLANK IS THE WORST AVAILABLE FAILURE MODE.
 *
 * The user cannot tell "still loading" from "broken", has no retry, and reports it
 * as "the map isn't loading" with nothing to act on. The fix is a designed failure
 * state with the same copy the web build already uses for an unavailable map.
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

test('a tile that fails to load is handled, not ignored', () => {
  // Arrange
  const picker = code(PICKER);

  // Assert
  assert.ok(/onError=/.test(picker), 'the tiles have no error handler, so a failure is invisible');
});

test('a failed map renders a stated state rather than an empty frame', () => {
  // Arrange
  const picker = code(PICKER);

  // Act — a flag set from the tile's `onError` and read by the render. The base
  // layer is the only one that reports: a missing label tile is cosmetic.
  const hasFlag = /tilesFailed/.test(picker);
  const gate = /\{tilesFailed && \(/.test(picker);
  const setsOnError = /onError=\{[^}]*setTilesFailed\(true\)/.test(picker);
  const clearsOnLoad = /onLoad=\{[^}]*setTilesFailed\(false\)/.test(picker);

  // Assert
  assert.ok(hasFlag, 'the picker has no failure flag');
  assert.ok(gate, 'the failure flag is never read, so nothing is said to the user');
  assert.ok(setsOnError, 'no tile reports its failure');
  assert.ok(clearsOnLoad, 'a successful load never clears the flag, so one flake blanks the map forever');
});

test('the failure state reuses existing copy rather than inventing a sentence', () => {
  // Arrange — `map.unavailableOnWeb` / `map.unavailableOnWebBody` already exist in
  // both catalogues and are what `VenueMap.web.tsx` shows.
  const picker = code(PICKER);

  // Assert
  assert.ok(/map\.unavailable/.test(picker), 'the failure state has no catalogued copy');
});

test('the tile URL carries the key when one is configured', () => {
  // Arrange
  const picker = code(PICKER);

  // Act
  const url = /basemaps\.cartocdn\.com[^`]*/.exec(picker)?.[0] ?? '';

  // Assert
  assert.ok(url.length > 0, 'the tile URL was not found');
  assert.ok(/key=/.test(picker), 'the tile URL never carries the key parameter');
});

test('a build without the key is caught before deploy, not discovered by a user', () => {
  // Arrange — a MISSING public variable is a quiet failure mode no existing gate could
  // see: the secret gates look for a credential that should NOT be in the bundle, not
  // one that is missing FROM it. (This was not the blank-map bug — that one had a valid
  // key and 200 responses; see `map-tile-anchor.test.ts`.)
  const runner = code('scripts/gate/all.ts');
  const gate = code('scripts/gate/env.ts');

  // Assert
  assert.ok(/gate:env/.test(runner), 'the gate runner does not run the env gate');
  assert.ok(
    /EXPO_PUBLIC_CARTO_API_KEY/.test(gate),
    'the env gate does not check the basemap key',
  );
  assert.ok(
    /vercel env add/.test(gate),
    'the failure message does not say how to fix the deploy',
  );
});
