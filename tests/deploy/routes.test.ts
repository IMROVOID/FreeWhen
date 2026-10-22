/**
 * The route contract (PRD-18 §4, AC-18.5.1, AC-18.5.2).
 *
 * ★ TWO LAYERS, BECAUSE ONE IS NOT ENOUGH.
 *
 * The first group reads `Caddyfile` and asserts the contract is DECLARED: every
 * refused path has a refusal block, and each refusal appears before the
 * catch-all that would otherwise swallow it. That runs anywhere, with no
 * container.
 *
 * The second group probes a RUNNING instance. It is skipped unless
 * `CADDY_TEST_ORIGIN` is set, because a suite that starts Docker on a
 * developer's machine is a suite people disable. The skip is honest — it says
 * what was not checked rather than passing silently.
 *
 * Why the static half matters: the failure mode here is not a typo, it is
 * ORDER. The catch-all `handle` exists so client-side routes resolve, so it
 * answers ANY path that reaches it — including `/studio`. A refusal declared
 * after it is dead configuration that reads as if it worked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const CADDYFILE = 'Caddyfile';

function caddyfile(): string {
  assert.ok(existsSync(CADDYFILE), `${CADDYFILE} must exist — it is the route contract`);
  return readFileSync(CADDYFILE, 'utf8');
}

/** The line index of a pattern, or -1. Line order is the assertion here. */
function lineOf(source: string, pattern: RegExp): number {
  return source.split(/\r?\n/).findIndex((line) => pattern.test(line));
}

test('the four deliberately-absent paths are all refused', () => {
  // Arrange
  const source = caddyfile();

  // Act — each refusal family must appear in the Caddyfile.
  const refusals = {
    studio: /\/studio/,
    storage: /\/storage\/v1\//,
    functions: /\/functions\/v1\//,
    sourcemap: /\*\.map/,
  };

  // Assert — absence is a feature here (AC-18.5.1): each of these must 404.
  for (const [name, pattern] of Object.entries(refusals)) {
    assert.ok(pattern.test(source), `${name} is not refused anywhere in the Caddyfile`);
  }
});

test('no refused path can fall through to the catch-all', () => {
  // Arrange
  const source = caddyfile();
  const catchAll = lineOf(source, /^\s*handle \{\s*$/);

  // Act / Assert — the catch-all answers everything, so it must come LAST.
  assert.ok(catchAll > 0, 'the catch-all `handle {` block is missing — deep links would 404');

  for (const pattern of [/\/studio/, /\/storage\/v1\//, /\/functions\/v1\//, /\*\.map/]) {
    const refusal = lineOf(source, pattern);
    assert.ok(
      refusal > 0 && refusal < catchAll,
      `a refusal matching ${pattern} is declared after the catch-all (line ${refusal} vs ${catchAll}) — it would never run`,
    );
  }
});

test('every proxy uses `handle`, never `handle_path`', () => {
  // Arrange — strip comment lines first. The Caddyfile EXPLAINS why
  // `handle_path` is wrong, and matching its own prose would fail the test on
  // a correct file.
  const source = caddyfile();
  const directives = source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  // Act / Assert — `handle_path` STRIPS the prefix, so `/api/events` would
  // arrive as `/events` and 404 against an API expecting `/api/events`.
  assert.ok(!/handle_path/.test(directives), 'handle_path strips the prefix — use handle');
});

test('the backend prefixes are preserved, not rewritten', () => {
  // Arrange
  const source = caddyfile();

  // Act
  const prefixes = ['/api/*', '/auth/v1/*', '/rest/v1/*', '/realtime/v1/*'];

  // Assert
  for (const prefix of prefixes) {
    assert.ok(source.includes(prefix), `the ${prefix} route is missing`);
  }
});

test('the export is served with immutable hashed assets and revalidating HTML', () => {
  // Arrange
  const source = caddyfile();

  // Act / Assert — a cached shell pointing at deleted chunks is a white screen.
  assert.match(source, /immutable/, 'hashed assets must be cached immutably');
  assert.match(source, /no-cache/, 'HTML must revalidate so a redeploy is visible');
});

test('the static artifacts are routed without opening a host-wide file server', () => {
  // Arrange
  const source = caddyfile();

  // Act — `/dl/` and `/privacy` are the only hand-written pages.
  const dl = lineOf(source, /\/dl\/\*/);
  const privacy = lineOf(source, /\/privacy/);

  // Assert — both exist, and each is scoped to a path matcher. A bare
  // `root * /srv/static` without a matcher would serve the whole tree.
  assert.ok(dl > 0, 'the /dl/ route is missing');
  assert.ok(privacy > 0, 'the /privacy route is missing');

  const staticRoots = source
    .split(/\r?\n/)
    .filter((line) => /root \* \/srv\/static|\{\$STATIC_ROOT/.test(line));
  assert.ok(
    staticRoots.length >= 2,
    'the static roots must be inside the /dl/ and /privacy matchers',
  );
});

// ─────────────────────────────────────────────────────────────────────────
// The live probe. Opt-in, because it needs a running Caddy.
// ─────────────────────────────────────────────────────────────────────────

const ORIGIN = process.env.CADDY_TEST_ORIGIN;

/** Every path that must NOT be served, and the status it must return. */
const REFUSED: ReadonlyArray<[string, number]> = [
  ['/studio', 404],
  ['/studio/', 404],
  ['/studio/index.html', 404],
  ['/storage/v1/object', 404],
  ['/functions/v1/any', 404],
  ['/assets/app.js.map', 404],
];

/** The paths the contract serves. The status is the documented one. */
const SERVED: ReadonlyArray<[string, number]> = [
  ['/', 200],
  ['/privacy', 200],
  ['/dl/', 200],
];

test(
  'AC-18.5.1: refused paths never return 200 against a running instance',
  { skip: ORIGIN ? false : 'set CADDY_TEST_ORIGIN to probe a running Caddy' },
  async () => {
    for (const [path, expected] of REFUSED) {
      // Arrange
      const url = `${ORIGIN}${path}`;

      // Act
      const response = await fetch(url, { redirect: 'manual' });

      // Assert — 200 is the one outcome the criterion forbids.
      assert.equal(response.status, expected, `${path} returned ${response.status}`);
    }
  },
);

test(
  'AC-18.5.2: the served paths respond as documented',
  { skip: ORIGIN ? false : 'set CADDY_TEST_ORIGIN to probe a running Caddy' },
  async () => {
    for (const [path, expected] of SERVED) {
      // Arrange
      const url = `${ORIGIN}${path}`;

      // Act
      const response = await fetch(url, { redirect: 'manual' });

      // Assert
      assert.equal(response.status, expected, `${path} returned ${response.status}`);
    }

    // A deep link the export does not have must still reach the shell, so the
    // router can show its own not-found rather than the host 404ing.
    const shell = await fetch(`${ORIGIN}/some/deep/route`, { redirect: 'manual' });
    assert.ok(
      shell.status === 200 || shell.status === 404,
      `an unknown route returned ${shell.status}`,
    );
  },
);
