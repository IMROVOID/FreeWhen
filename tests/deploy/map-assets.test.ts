/**
 * The map key has to reach the bundle, and the deployed assets have to be checked.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `LocationMapPicker.tsx` reads `process.env.EXPO_PUBLIC_CARTO_API_KEY`. That
 * name existed in `.env` and NOWHERE ELSE — not in `.env.example`, not in
 * `deploy.yml`'s export step. `EXPO_PUBLIC_*` is substituted by the bundler, so
 * the value the host has is irrelevant; the deployed bundle inlined `undefined`
 * and every CARTO tile URL was requested without a key. The map then rendered a
 * blank grid and the app looked like it was "asking for API keys".
 *
 * `scripts/build/export-web.sh:21-27` names this exact trap for the demo token
 * and the Mapbox token. The CARTO key was simply never added to the list.
 *
 * ★ THE SECOND HALF IS WHY IT SHIPPED TWICE.
 *
 * `verify-deployment.sh` checked `/`, `/start`, `/privacy`, `/dl/`, `/api/health`
 * and a set of refused paths — no asset of any kind. So when every font and tile
 * under `static/assets/` 404'd, the smoke test stayed green. `tests/deploy/upload-assets.test.ts`
 * records that the same class of failure happened once before with the fonts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

test('the CARTO key is documented in the environment template', () => {
  // Arrange
  const example = text('.env.example');

  // Act / Assert — a variable that only exists in a developer's `.env` is a
  // variable the deploy cannot know about.
  assert.ok(
    example.includes('EXPO_PUBLIC_CARTO_API_KEY='),
    '.env.example does not document EXPO_PUBLIC_CARTO_API_KEY',
  );
});

test('the CARTO key reaches the bundler shell on deploy', () => {
  // Arrange
  const deploy = text('.github/workflows/deploy.yml');

  // Act — isolate the export step, since the `env:` there is what reaches Metro.
  const exportStep = /Build the web export[\s\S]*?run: bash scripts\/build\/export-web\.sh/.exec(deploy)?.[0] ?? '';

  // Assert — set on the host only, it never reaches the bundle.
  assert.ok(exportStep.length > 0, 'the web export step is no longer findable');
  assert.ok(
    exportStep.includes('EXPO_PUBLIC_CARTO_API_KEY'),
    'the export step does not pass EXPO_PUBLIC_CARTO_API_KEY — the bundle inlines undefined',
  );
});

test('the map picker reads the key the deploy actually provides', () => {
  // Arrange
  const picker = text('src/components/ui/LocationMapPicker.tsx');

  // Act / Assert — the two names must agree, or the value is never found.
  assert.ok(
    picker.includes('EXPO_PUBLIC_CARTO_API_KEY'),
    'LocationMapPicker no longer reads EXPO_PUBLIC_CARTO_API_KEY',
  );
});

test('the deployment check fetches at least one real asset', () => {
  // Arrange
  const verify = text('.github/scripts/verify-deployment.sh');

  // Act / Assert — a smoke test that only checks HTML cannot see a 404 under
  // `assets/`, which is how the font and tile outages shipped unnoticed.
  assert.ok(
    /assets\//.test(verify),
    'verify-deployment.sh checks no file under /assets/ — a 404 there cannot be noticed',
  );
});

test('a Neshan key is never a client-bundle variable', () => {
  // Arrange
  const example = text('.env.example');
  const deployed = text('.github/workflows/deploy.yml');

  // Act — an ASSIGNMENT, not a mention. The template explains the rule in prose,
  // so a bare substring search would fail on the documentation of the rule.
  const assigned = (source: string): boolean => /^\s*EXPO_PUBLIC_NESHAN[A-Z_]*\s*[:=]/m.test(source);
  const leaked = assigned(example) || assigned(deployed);

  // Assert — Neshan keys are server-side only by design: the server proxies
  // place-search and routing so the credential stays out of the bundle, and a
  // client-side key would be a published credential.
  assert.equal(leaked, false, 'a Neshan key is exposed as EXPO_PUBLIC_*');
});
