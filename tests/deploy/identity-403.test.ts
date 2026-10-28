/**
 * The DEPLOYED function answers a first-launch caller correctly.
 *
 * ★ WHY THIS DRIVES `api/index.js` RATHER THAN A SERVICE.
 *
 * The reported failures were 403s from `freepon-orpin.vercel.app`, so the thing
 * that has to be right is the bundle Vercel runs — not the source it was built
 * from. `api/index.js` is that bundle: a CommonJS fetch handler with `pg` and
 * `zod` inlined, exporting `fetch`. This hands it a real `Request` and reads the
 * real `Response`.
 *
 * ★ THE DATABASE IS STUBBED, AND ONLY THE DATABASE.
 *
 * The bundle opens one `pg` Client per request before dispatching, and this suite
 * has no Postgres. Stubbing that client at its factory leaves everything that
 * matters intact — routing, identity resolution, the handler bodies — while
 * removing the only thing that needs a network. A query returns no rows, which is
 * the honest shape for "a brand new person has no events".
 *
 * The stub is injected through the bundle's own client factory call, so the
 * probe covers the same dispatcher the platform invokes.
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

/**
 * pi/index.js IS A PLATFORM ARTIFACT, NOT A REPOSITORY FILE.
 *
 * /api/ is gitignored (.gitignore) and produced by the deployment platform's own
 * function build, so a fresh clone - and therefore CI - has no such file. The suite used
 * to eadFileSync unconditionally, so it failed with
 *
 *     ENOENT: no such file or directory, open 'api/index.js'
 *
 * on every run that did not happen to keep a local build around. Six assertions turning red
 * for a missing artifact is a suite that reports the state of one machine rather than the
 * state of the code.
 *
 * So it SKIPS, out loud, and says what was not verified - the same rule gate:web uses
 * when dist/ is absent. A silent pass would be worse than a loud skip: these assertions
 * are about the shipped function answering a first launch, and skipping them quietly would
 * claim that was checked.
 */
const BUNDLE = 'api/index.js';
const hasBundle = existsSync(BUNDLE);
const skip = hasBundle
  ? false
  : 'api/index.js is absent (gitignored platform artifact) - run a deploy or function build first';

const require_ = createRequire(import.meta.url);

/** A patched copy of the shipped bundle, with the client factory made swappable. */
const PROBE = 'api/index.probe.js';

interface DeployedFetch {
  fetch: (request: Request) => Promise<Response>;
}

let deployedFetch: DeployedFetch['fetch'];

const queries: string[] = [];

before(() => {
  // The artifact is absent on a fresh clone and in CI; every test above skips, so there
  // is nothing for this hook to prepare.
  if (!hasBundle) return;

  // Arrange — one hook, so the factory can be replaced rather than the client.
  const source = readFileSync('api/index.js', 'utf8');
  const marker = '      const client = createClient(connectionString2);';
  const patched = source.replace(
    marker,
    '      const client = globalThis.__PROBE_CLIENT__ || createClient(connectionString2);',
  );

  assert.notEqual(patched, source, 'the driver factory call moved — this probe must be updated');
  writeFileSync(PROBE, patched);

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__PROBE_CLIENT__ = {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (text: string) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
  };
  process.env.DATABASE_URL = 'postgres://probe';

  deployedFetch = (require_(`${process.cwd()}/${PROBE}`) as DeployedFetch).fetch;
});

test.after(() => {
  try {
    unlinkSync(PROBE);
  } catch {
    // Best effort: the file is gitignored build output.
  }
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('★ GET /api/events with no identity is an empty list, not a 403', { skip }, async () => {
  // Arrange — a first launch, and every incognito window, sends no `x-user-id`.
  // Act
  const response = await deployedFetch(new Request('https://example.test/api/events'));

  // Assert — 403 here was the reported console error. A guest with no identity
  // provably has no events, so the answer is the list they would get anyway.
  assert.equal(response.status, 200, 'a caller with no identity is still refused');
  assert.deepEqual(await response.json(), { events: [] });
});

test('a malformed identity is still refused', { skip }, async () => {
  // Arrange — a bad id is a broken client, and hiding that serves nobody.
  // Act
  const response = await deployedFetch(
    new Request('https://example.test/api/events', { headers: { 'x-user-id': 'nope' } }),
  );

  // Assert
  assert.equal(response.status, 403);
});

test('the profile save reaches its handler instead of being refused up front', { skip }, async () => {
  // Arrange — `PUT /api/profile` was the other reported 403. A malformed id is a
  // broken client, so the handler's own guard must answer it — reaching that guard
  // is the proof the request got past the adapter, the CORS layer and the router
  // rather than being turned away before a handler ran.
  queries.length = 0;

  // Act
  const response = await deployedFetch(
    new Request('https://example.test/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-user-id': 'nope' },
      body: JSON.stringify({ nickname: 'Test' }),
    }),
  );
  const body = (await response.json()) as { error?: string };

  // Assert — the stub returns no rows, so an established caller cannot be
  // resolved and the route raises rather than 403-ing. That internal error is the
  // handler running; a 403 would mean the old refusal was still in front of it.
  assert.equal(response.status, 500);
  assert.equal(body.error, 'INTERNAL_ERROR');
  assert.notEqual(body.error, 'NOT_PARTICIPANT', 'the profile save still refuses before its handler');
});

test('★ a first-launch profile save is no longer a 403', { skip }, async () => {
  // Arrange — the reported `PUT /api/profile 403 (Forbidden)`.
  // Act
  const response = await deployedFetch(
    new Request('https://example.test/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'Test' }),
    }),
  );

  // Assert — no identity at all is the gate's situation, and it must be allowed
  // to mint one rather than be refused.
  assert.notEqual(response.status, 403, 'a first-launch profile save is still refused');
});

test('the deployed bundle carries the cold-handshake retry', { skip }, () => {
  // Arrange — a helper in `server/` that the build did not inline fixes nothing.
  const bundle = readFileSync('api/index.js', 'utf8');

  // Act / Assert
  assert.ok(/connection terminated/i.test(bundle), 'the retry classifier is not in the bundle');
});

test('the retry wraps only the handshake, never the dispatcher', { skip }, () => {
  // Arrange
  const bundle = readFileSync('api/index.js', 'utf8');
  const driver = /async function runWithClient[\s\S]*?\n\}/.exec(bundle)?.[0] ?? '';

  // Act — the dispatcher must be inside the retried block so a retry re-enters the
  // connect, but the handler must not run twice: `withConnectRetry` awaits the
  // whole operation, and only a pre-handler throw releases it for a second pass.
  const wrapsConnect = /withConnectRetry\([\s\S]*?client\.connect\(\)/.test(driver);
  const dispatchesOnce = /withRequestQueryable\(client, \(\) => handleRequest\(request\)\)/.test(driver);

  // Assert
  assert.ok(wrapsConnect, 'the retry does not wrap the handshake');
  assert.ok(dispatchesOnce, 'the dispatcher is invoked more than once per request');
});

test('the source still establishes the caller before writing the profile', { skip }, () => {
  // Arrange
  const profile = code('server/routes/profile.ts');

  // Act / Assert
  assert.ok(/callerOrCreate/.test(profile), 'the profile route no longer establishes a caller');
  assert.ok(
    /caller\.userId/.test(profile),
    'the profile route does not key its write on the established caller',
  );
});
