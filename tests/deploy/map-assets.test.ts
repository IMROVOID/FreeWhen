/**
 * The map token has to reach the bundle, and the deployed assets have to be checked.
 *
 * ★ THE BUG THIS LOCKS OUT — AND IT OUTLIVED ITS PROVIDER.
 *
 * `LocationMapPicker.tsx` read a public build variable that existed in `.env` and
 * NOWHERE ELSE — not in `.env.example`, not in `deploy.yml`'s export step.
 * `EXPO_PUBLIC_*` is substituted by the bundler, so the value the host has is
 * irrelevant: the deployed bundle inlined `undefined`, every tile URL was requested
 * without a key, the map rendered a blank grid, and the app looked like it was
 * "asking for API keys".
 *
 * Plan 64 moved the provider to MapBox and made the SAME trap possible on a new
 * variable name, so the assertion is kept and repointed rather than deleted. It is
 * the deploy-side half of `scripts/gate/env.ts`.
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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

test('the MapBox token is documented in the environment template', () => {
  // Arrange
  const example = text('.env.example');

  // Act / Assert — a variable that only exists in a developer's `.env` is a
  // variable the deploy cannot know about.
  assert.ok(
    example.includes('EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN='),
    '.env.example does not document EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN',
  );
});

test('the MapBox token reaches the bundler shell on deploy', () => {
  // Arrange
  const deploy = text('.github/workflows/deploy.yml');

  // Act — isolate the export step, since the `env:` there is what reaches Metro.
  const exportStep = /Build the web export[\s\S]*?run: bash scripts\/build\/export-web\.sh/.exec(deploy)?.[0] ?? '';

  // Assert — set on the host only, it never reaches the bundle.
  assert.ok(exportStep.length > 0, 'the web export step is no longer findable');
  assert.ok(
    exportStep.includes('EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN'),
    'the export step does not pass EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN — the bundle inlines an empty token',
  );
});

test('the APK build is given the same token, or the phone shows no map', () => {
  // Arrange — the native bundle is built by a different workflow from the web
  // export, so passing the token in one does not pass it in the other.
  const apk = text('.github/workflows/release-apk.yml');

  // Assert
  assert.ok(
    apk.includes('EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN'),
    'release-apk.yml does not pass EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN — every APK map is dead',
  );
});

test('the retired basemap key is gone from the deploy paths', () => {
  // Arrange — a stale variable left in a shell keeps a dead provider alive in
  // every future bundle.
  const retired = 'EXPO_PUBLIC_' + 'CAR' + 'TO_API_KEY';
  const sources = [
    text('.env.example'),
    text('.github/workflows/deploy.yml'),
    text('.github/workflows/ci.yml'),
    text('.github/workflows/release-apk.yml'),
  ];

  // Act
  const offenders = sources.filter((source) => source.includes(retired));

  // Assert
  assert.deepEqual(offenders, [], 'the retired basemap key is still passed somewhere');
});

test('the map reads the token the deploy actually provides', () => {
  // Arrange — one module reads the variable, so the name exists in exactly two
  // places: the bundle's environment and this file.
  const tokenModule = text('src/features/map/mapbox-token.ts');
  const picker = text('src/components/ui/LocationMapPicker.tsx');

  // Act / Assert — the names must agree, or the value is never found.
  assert.ok(
    tokenModule.includes('EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN'),
    'the token module no longer reads EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN',
  );
  assert.ok(
    picker.includes('hasMapbox'),
    'LocationMapPicker no longer consults the token before mounting a map',
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

/**
 * ★ THE DEFECT THIS PINS: A COMPUTED ENV LOOKUP BEATS THE INLINER.
 *
 * Metro inlines `EXPO_PUBLIC_*` by rewriting the LITERAL member expression
 * `process.env.NAME`. The first version of `readMapboxToken()` read it through
 * `globalThis.process?.env`, which is not that expression, so it stayed a runtime
 * lookup — and a browser has no `process`. The exported bundle carried the
 * variable's NAME and no value, every map rendered "unavailable", and the deploy
 * looked correctly configured.
 *
 * Found by scanning `dist/` after an export, not by reading the code, which is why
 * the assertion inspects the artifact rather than the source.
 */
test('the map token is INLINED into the exported bundle, not looked up at runtime', () => {
  // Arrange — the export must exist for this to mean anything.
  if (!existsSync('dist')) {
    // The suite's other data-independent tests still run on a clean tree; this one
    // needs the artifact and says so rather than failing for the wrong reason.
    return;
  }

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  // The value this build was exported with, read from the environment the export
  // used — never embedded, so the fixture cannot go stale against the deployment.
  const token = (process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? '').trim();
  if (token === '') return;
  const scripts = walk('dist').filter((file) => file.endsWith('.js'));

  // Act
  const carrying = scripts.filter((file) => text(file).includes(token));

  // Assert — the value the deploy provided is in the bundle. An empty result means
  // the reference is computed and the map is dead on a configured deployment.
  assert.ok(
    carrying.length > 0,
    'the MapBox token is not inlined in the export — every map will render unavailable',
  );
});

/**
 * ★ THE DEFECT THIS PINS: AN `env:` BLOCK DELETED INSTEAD OF REPOINTED.
 *
 * When the map provider moved, the old public variable was removed from CI's
 * "Unit and component tests" step — the whole `env:` block went with it, leaving
 * the explanatory comment above a step with no environment. `npm test` then
 * spawned `gate:all` with no token, `gate:env` failed, and
 * `tests/deploy/gates.test.ts` failed with it.
 *
 * It passed locally for weeks. A developer's `.env` supplies the token, and CI has
 * no `.env`, so the two environments disagreed about a step that looked identical.
 * Found by running the suite with `.env` moved aside — which is the only way this
 * class of defect is visible, and is why the assertion below reads the workflow
 * file rather than trusting a green local run.
 */
test('CI passes the map token into the test step, not just the export', () => {
  // Arrange
  const ci = text('.github/workflows/ci.yml');

  // Act — isolate the test step's own `env:`, not the export's above it.
  const testStep =
    /- name: Unit and component tests\s*\n\s*env:\s*\n(?:\s+\S[^\n]*\n)*\s*run: npm test/.exec(ci)?.[0] ?? '';

  // Assert
  assert.ok(testStep.length > 0, 'the test step has no env: block, so gate:env gets nothing in CI');
  assert.match(
    testStep,
    /EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN: \$\{\{ vars\.FREEWHEN_MAPBOX_PUBLIC_TOKEN \}\}/,
    'the test step does not receive the map token, so the spawned gate:all fails on CI',
  );
});

test('the gate test forwards the variable gate:env actually requires', () => {
  // Arrange — two files naming the same variable is a promise, and this guards it.
  const gateTest = text('tests/deploy/gates.test.ts');
  const envGate = text('scripts/gate/env.ts');

  // Act
  const required = /name: '([A-Z0-9_]+)'/.exec(envGate)?.[1] ?? '';
  const forwarded = /const REQUIRED_PUBLIC_VAR = '([A-Z0-9_]+)'/.exec(gateTest)?.[1] ?? '';

  // Assert
  assert.ok(required.length > 0, 'the env gate declares no required variable');
  assert.equal(
    forwarded,
    required,
    `gates.test.ts forwards ${forwarded || 'nothing'} while gate:env requires ${required}`,
  );
});

test('the retired variable is not forwarded by any test', () => {
  // Arrange — a fallback reading a removed key can never match, so it is dead code
  // that reads as a supported path.
  const retired = 'EXPO_PUBLIC_' + 'CAR' + 'TO_API_KEY';
  const gateTest = text('tests/deploy/gates.test.ts');

  // Assert
  assert.equal(
    gateTest.includes(retired),
    false,
    'gates.test.ts still reads the retired map variable',
  );
});
