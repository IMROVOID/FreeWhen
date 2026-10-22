/**
 * The web export contract (PRD-18 AC-18.9.1, AC-18.7.1, AC-18.6.2).
 *
 * ★ THESE ASSERT THE ARTIFACT, NOT A MOCK OF METRO.
 *
 * Platform resolution is not something a unit test can prove by stubbing the
 * bundler — the bug this suite guards against is a native module reaching the
 * web bundle and failing at IMPORT time. The only honest check is the built
 * output, so `npm run export:web` runs before this file and every assertion
 * reads `dist/`.
 *
 * A missing `dist/` FAILS rather than skips. A skipped export test is a green
 * run that proved nothing, and the export breaking is the exact failure the
 * phase exists to prevent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function exportFiles(): string[] {
  assert.ok(
    existsSync(DIST),
    'dist/ is missing — run `npm run export:web` before this suite',
  );
  return walk(DIST);
}

test('AC-18.9.1: the web export builds and contains the app routes', () => {
  // Arrange
  const files = exportFiles();
  const indexPath = join(DIST, 'index.html');

  // Act
  const hasIndex = existsSync(indexPath);
  const html = hasIndex ? readFileSync(indexPath, 'utf8') : '';
  const routes = files.filter((f) => f.endsWith('.html'));

  // Assert
  assert.ok(hasIndex, 'dist/index.html must exist');
  assert.ok(html.length > 0, 'dist/index.html is empty');
  assert.ok(
    routes.length >= 10,
    `expected the app's routes in the export, found ${routes.length} HTML files`,
  );

  // The reviewer path is a ROUTE in the app, not a hand-written page.
  assert.ok(
    routes.some((f) => f.includes(join('e', '[token]'))),
    'the invite route must be exported — it is the reviewer entry point',
  );
  assert.ok(
    routes.some((f) => f.includes(join('event', '[id]', 'decision'))),
    'the decision route must be exported — it is the reviewer end point',
  );
});

test('AC-18.7.1: the served document declares Persian direction before first paint', () => {
  // Arrange
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');

  // Act
  const htmlTag = /<html[^>]*>/.exec(html)?.[0] ?? '';

  // Assert — both attributes, in the MARKUP. A runtime write would not be here;
  // a missing `lang` also breaks font fallback (PRD-10 D11).
  assert.match(htmlTag, /dir="rtl"/, `expected dir="rtl" in ${htmlTag}`);
  assert.match(htmlTag, /lang="fa"/, `expected lang="fa" in ${htmlTag}`);

  // A runtime-only correction is the bug: the reviewer would see LTR, then a
  // flip. The attribute must be in the served HTML, not applied by script.
  assert.ok(!/["']ltr["']/.test(htmlTag), `direction must not be LTR: ${htmlTag}`);
});

test('AC-18.6.2: the export emits no source maps', () => {
  // Arrange
  const files = exportFiles();

  // Act
  const maps = files.filter((f) => f.endsWith('.map'));

  // Assert
  assert.deepEqual(maps, [], `source maps must not be exported: ${maps.join(', ')}`);
});

test('the export contains no dev-only marker', () => {
  // Arrange
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');

  // Act / Assert — a `__DEV__` reference in the served document means a
  // development bundle was shipped as the deploy artifact.
  assert.ok(!html.includes('__DEV__'), 'a development bundle was exported');
});

test('no HTML page in the export references a third-party script origin', () => {
  // Arrange
  const files = exportFiles().filter((f) => f.endsWith('.html'));

  // Act
  const offenders = files.filter((file) =>
    /<script[^>]+src=["']https?:\/\//.test(readFileSync(file, 'utf8')),
  );

  // Assert — the session token lives in localStorage on this origin.
  assert.deepEqual(offenders, [], `third-party script origin in: ${offenders.join(', ')}`);
});

test('the native map never reaches the web bundle', () => {
  // Arrange — `@rnmapbox/maps` has no web build and would fail at import.
  const files = exportFiles().filter((f) => f.endsWith('.js'));

  // Act
  const offenders = files.filter((file) =>
    /@rnmapbox\/maps|NativeModules\.RNMapboxMaps/.test(readFileSync(file, 'utf8')),
  );

  // Assert — this is what `VenueMap.web.tsx` exists to guarantee.
  assert.deepEqual(offenders, [], `native map module in the web bundle: ${offenders.join(', ')}`);
});

test('the web fallback copy is in the bundle, so the web sibling resolved', () => {
  // Arrange
  const files = exportFiles().filter((f) => f.endsWith('.js'));

  // Act
  const hasFallback = files.some((file) =>
    readFileSync(file, 'utf8').includes('unavailableOnWeb'),
  );

  // Assert — if `VenueMap.native.tsx` had won, this key would be absent.
  assert.ok(hasFallback, 'the web VenueMap copy is missing — did .native.tsx resolve on web?');
});
