/**
 * One nickname for the person, across every event.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * A guest arrived, was asked for a nickname on the home page, typed one — and was
 * asked for a nickname AGAIN when joining an event by code. The home-page answer
 * went into the local cache only (`saveNicknameOptimistically` exists for the
 * offline case), because `/api/profile` answers 403 for a caller with no
 * identity and no identity is minted until a join or an event creation. So
 * `user_profile` stayed empty, `GET /api/profile` kept answering `{nickname:null}`,
 * and the per-event name field had no idea a nickname had ever been chosen.
 *
 * The same missing identity produced the reported console errors:
 *
 *   GET /api/events       403   — the caller sent no `x-user-id`
 *   PUT /api/profile      403   — same, on the save the gate attempted
 *
 * ★ AND THE CACHE WAS NEVER READ ON THE INVITE ROUTE.
 *
 * `app/_layout.tsx` stands the gate down on `/e/` (the join form asks the same
 * question), so nothing on that path consulted the nickname — the field started
 * empty and the join refused to proceed without it. But the gate only stands
 * down because a name is being collected THERE; a person who already has one
 * should simply be joining as themselves.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the join form opens with the nickname the person already chose', () => {
  // Arrange
  const joinScreen = code('app/e/[token].tsx');

  // Act
  const readsCache = /readCachedNickname\(\)/.test(joinScreen);
  const caches = /const known = await readCachedNickname\(\)/.test(joinScreen);
  const seedsField = /if \(known\) setName\(/.test(joinScreen);

  // Assert — an empty field is a second prompt by another name.
  assert.ok(readsCache, 'the join form never asks what nickname this device holds');
  assert.ok(caches, 'the cached nickname is not captured where the field can read it');
  assert.ok(seedsField, 'the cached nickname is read and not used');
});

test('the join form submits without asking when a nickname exists', () => {
  // Arrange
  const joinScreen = code('app/e/[token].tsx');

  // Act — the required-name check must accept the carried nickname.
  const stillRequired = /if \(trimmed === ''\) \{\s*setNameError\('events\.validation\.nameRequired'\)/.test(
    joinScreen,
  );
  const disabledWithoutName = /disabled=\{[^}]*name\.trim\(\) === ''[^}]*\}/.test(joinScreen);

  // Assert — the guard stays (a name IS required) and the seeded value satisfies
  // it, so nothing else is needed to skip the prompt.
  assert.ok(stillRequired, 'the required-name guard was removed rather than satisfied');
  assert.ok(
    !disabledWithoutName,
    'the submit is disabled by an empty-looking field even when a nickname is carried',
  );
});

test('the joined name is written to the profile, not only to the cache', () => {
  // Arrange — the cache is what the gate reads, but the server copy is the truth
  // and the only thing another device can see.
  const joinScreen = code('app/e/[token].tsx');

  // Act
  const persists = /persistNickname\(|saveNickname\(/.test(joinScreen);

  // Assert
  assert.ok(persists, 'a successful join leaves the profile empty on the server');
});

test('a nickname save never needs an identity it does not have', () => {
  // Arrange
  const profile = code('server/routes/profile.ts');

  // Act — `PUT /api/profile` for a caller with no identity must mint one rather
  // than refuse, because the gate runs before any join.
  const putHandler = /export async function putProfileHandler[\s\S]*?\n\}/.exec(profile)?.[0] ?? '';

  // Assert
  assert.ok(putHandler.length > 0, 'the PUT handler is no longer findable');
  assert.ok(
    !/if \(!userId \|\| !isUuid\(userId\)\) return wireError\('NOT_PARTICIPANT'\)/.test(putHandler),
    'the profile save still 403s a first-launch caller, which is the reported error',
  );
  assert.ok(
    /callerOrCreate\(request\)/.test(putHandler),
    'the profile save refuses instead of establishing the caller it was given',
  );
  const mints = /async function callerOrCreate[\s\S]*?createAnonymousUser\(\)/.test(profile);
  assert.ok(mints, 'the profile route has no path to a first identity at all');
});

test('the identity a profile save mints is returned, so the client can store it', async () => {
  // Arrange — a minted id the client never receives is the same 403 next request.
  // The service imports AsyncStorage, so the RN resolution hook must be in place;
  // it is, because this file imports `./support/register` above.
  const { ProfileResultShape } = await import('@/src/features/profile/services/profile');

  // Act / Assert
  assert.ok(
    'userId' in ProfileResultShape,
    'the profile response has no field for a freshly minted identity',
  );
  const service = code('src/features/profile/services/profile.ts');
  assert.ok(
    /if \(data\.userId\) await storeUserId\(data\.userId\)/.test(service),
    'the minted identity is received and thrown away',
  );
});
