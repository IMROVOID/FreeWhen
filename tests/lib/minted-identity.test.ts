/**
 * The minted identity must reach the client, in EITHER shape the server uses.
 *
 * ★ THE DEFECT THIS PINS: THE FIRST SAVE COULD NEVER BE REMEMBERED.
 *
 * The client persists the identity a minting route returns, so that the next
 * launch — and every later request — carries it. `apiRequest` read it from the
 * `x-user-id` RESPONSE HEADER only, because that is how `POST /api/events`
 * returns one.
 *
 * `PUT /api/profile` is the other minting route, and it is the one a first launch
 * reaches FIRST: the nickname gate saves before anything else in the app. Called
 * against the deployment it answers
 *
 *     {"nickname":"Probe","userId":"a74451b3-…"}
 *
 * — a BODY field, and no `x-user-id` header at all. So the server created an
 * identity, the client threw it away, and:
 *
 *  - the gate re-appeared on every visit,
 *  - each save minted ANOTHER anonymous user, so the events created under one
 *    identity were invisible from every later one.
 *
 * The tolerance is in the transport rather than in the two routes because making
 * only them agree would leave the next route free to pick the other spelling.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { mintedUserId, type MintingResponse } from '@/src/lib/minted-identity';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function responseWith(header: string | null): MintingResponse {
  return { headers: { get: (name: string) => (name === 'x-user-id' ? header : null) } };
}

test('a route that echoes the identity in a HEADER is understood', () => {
  // Arrange — `POST /api/events`.
  const response = responseWith('from-header');

  // Act
  const id = mintedUserId(response, { event: { id: 'e1' } });

  // Assert
  assert.equal(id, 'from-header');
});

test('a route that returns the identity in the BODY is understood too', () => {
  // Arrange — `PUT /api/profile`, the exact shape the deployment answers with.
  const response = responseWith(null);
  const payload = { nickname: 'Probe', userId: 'a74451b3-4203-44da-b34d-40a298610d89' };

  // Act
  const id = mintedUserId(response, payload);

  // Assert — this is the line the defect was: the id was discarded here.
  assert.equal(id, 'a74451b3-4203-44da-b34d-40a298610d89', 'the minted identity was discarded again');
});

test('the header wins when both shapes are present', () => {
  // Arrange — a route sending both means the same value twice.
  const response = responseWith('from-header');

  // Act
  const id = mintedUserId(response, { userId: 'from-body' });

  // Assert
  assert.equal(id, 'from-header');
});

test('a route that mints nothing reports no identity', () => {
  // Act
  const id = mintedUserId(responseWith(null), { events: [] });

  // Assert — reporting one here would make the client store a value it invented.
  assert.equal(id, null);
});

test('an empty or non-string body field is not an identity', () => {
  for (const payload of [{ userId: '' }, { userId: 42 }, { userId: null }, { userId: {} }]) {
    // Act
    const id = mintedUserId(responseWith(null), payload);

    // Assert
    assert.equal(id, null, `${JSON.stringify(payload)} was read as an identity`);
  }
});

test('a non-object payload cannot carry an identity', () => {
  for (const payload of [null, undefined, 'a string', 7]) {
    assert.equal(mintedUserId(responseWith(null), payload), null);
  }
});

test('the gate stores whatever the save returns', () => {
  // Arrange — the call site the defect actually broke.
  const profile = code('src/features/profile/services/profile.ts');

  // Act
  const stores = /if \(data\.userId\) await storeUserId\(data\.userId\)/.test(profile);

  // Assert
  assert.ok(stores, 'the minted identity from a save is not persisted');
});

test('the transport uses the shared helper rather than reading one spelling', () => {
  // Arrange
  const transport = code('src/lib/api.ts');

  // Act
  const usesHelper = /userId: mintedUserId\(response, payload\)/.test(transport);
  const noInlineRead = !/userId: response\.headers\.get\('x-user-id'\)/.test(transport);

  // Assert
  assert.ok(usesHelper, 'the transport does not consult the shared identity helper');
  assert.ok(noInlineRead, 'the transport reads only the header again');
});

test('the helper imports nothing, so the test runner can load it', () => {
  // Arrange — `src/lib/api.ts` imports expo-constants, which the Node runner
  // cannot transform. That is why the decision lives in its own module.
  const module = code('src/lib/minted-identity.ts');

  // Act
  const imports = /^import |require\(/m.test(module);

  // Assert
  assert.ok(!imports, 'the helper gained a dependency and can no longer be unit-tested');
});
