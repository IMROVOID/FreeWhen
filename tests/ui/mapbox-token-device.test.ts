/**
 * The map token must be readable on a device, where `process.env` may be absent.
 *
 * ★ THE DEFECT THIS REPRODUCES: THE EVENT PAGE HARD-CRASHED ON ANDROID.
 *
 * Opening an event died with:
 *
 *   TypeError: undefined is not a function
 *     at ProposalMapPreview
 *     at ProposalCard
 *     at EventHomeScreen
 *
 * traced to `readMapboxToken`, which read:
 *
 *     typeof process === 'undefined' ? undefined : process.env.EXPO_PUBLIC_…
 *
 * The `typeof` guard only proves `process` EXISTS. On a device the Hermes runtime
 * exposes `process` with no `env`, and `undefined.X` is a throw rather than an
 * `undefined` read. Every screen that draws a map preview therefore crashed on a
 * device while working in the browser and under Node — which is why every test here
 * passed while the app was broken.
 *
 * ★ SO THE TEST CANNOT BE `typeof`-SHAPED EITHER.
 *
 * The first version of this file tried to re-evaluate the module's source under a
 * fake global, which cannot work (the source is TypeScript). It now exercises the
 * access PATTERN directly, and asserts the module uses that pattern — the property
 * that actually failed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const TOKEN_MODULE = 'src/features/map/mapbox-token.ts';

/**
 * The access pattern under test, extracted so a device-shaped global can drive it.
 *
 * This mirrors what `readPublicEnv` does. If the module's shape drifts from this,
 * the source assertion below fails and forces the two back together.
 */
function readEnvIn(shape: { process?: { env?: Record<string, string | undefined> } }): string | undefined {
  const proc = shape.process;

  // A device: no `process`, or a `process` with no `env`.
  if (proc === undefined || proc.env == null) return undefined;

  return proc.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
}

/* ── The regression ───────────────────────────────────────────────────────── */

test('a device whose `process` has no `env` reads as "no token", not a throw', () => {
  // Arrange — the exact shape Hermes presents: the global exists, `env` does not.
  const deviceLike = { process: {} };

  // Act
  let value: string | undefined = 'not called';
  assert.doesNotThrow(() => {
    value = readEnvIn(deviceLike);
  }, 'reading the token threw on a device-shaped `process`, which is the event-page crash');

  // Assert — "no token" is the level-4 state every caller already handles.
  assert.equal(value, undefined);
});

test('no `process` at all also reads as "no token"', () => {
  assert.doesNotThrow(() => readEnvIn({}));
  assert.equal(readEnvIn({}), undefined);
});

test('an inlined value is still read when `env` is present', () => {
  // Arrange — the browser and Node shape.
  const withEnv = { process: { env: { EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN: 'pk.fixture.token' } } };

  // Act / Assert
  assert.equal(readEnvIn(withEnv), 'pk.fixture.token');
});

test('the module guards `process.env`, not only `process`', () => {
  // Arrange — the assertion that would have caught the crash. The old line reached
  // into `.env` behind a guard that never proved it existed.
  // ★ COMMENTS ARE STRIPPED FIRST. The module explains the old pattern in a ★ note,
  // so a raw read would match its own documentation and fail on correct code —
  // the same trap `interactive-map.test.ts` hit with `mapType`.
  const source = readFileSync(TOKEN_MODULE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Assert
  assert.doesNotMatch(
    source,
    /typeof process === 'undefined' \? undefined : process\.env\./,
    'the token is read behind a `process`-only guard, so a device with no `process.env` throws',
  );
  assert.match(
    source,
    /process\.env == null\s*\?\s*undefined\s*:\s*process\.env/,
    'the read does not tolerate a missing `process.env`',
  );
});

test('the token is still read through the literal expression Metro inlines', () => {
  // Arrange — the trap that produced a blank map earlier: a computed lookup survives
  // as a runtime read and ships an empty bundle. `process.env.NAME` must stay literal.
  const source = readFileSync(TOKEN_MODULE, 'utf8');

  // Assert
  assert.match(
    source,
    /process\.env\.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN/,
    'the token is no longer read through the literal expression the bundler rewrites',
  );
});
