/**
 * The global nickname (Plan 49 T6).
 *
 * ★ THIS FILE EXISTS BECAUSE A NICKNAME HAD NOWHERE TO LIVE.
 *
 * Names were per-event only: `participant.display_name` is created at join time,
 * so a user who joined three events had typed three names and the app had no
 * identity to show or colour before the first event. `user_profile` is that
 * identity, and it SEEDS `participant.display_name` rather than replacing it —
 * `event_message.sender_name` and `activity_log.actor_name` are deliberate
 * snapshots that a rename must not rewrite.
 *
 * The assertions that matter:
 *
 *  1. a profile round-trips through the API and is still there on re-read,
 *  2. a blank or over-long nickname is rejected, in the database as well as the
 *     route, so both backends agree,
 *  3. one caller cannot read another caller's profile — the nickname reaches
 *     people through `participant.display_name` inside an event, never directly,
 *  4. joining an event seeds `display_name` from the nickname, so names appear on
 *     proposals, votes and messages without touching twelve serialisers.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool, createUser, truncateAll } from './support';
import { bodyOf, call, createEventViaApi, prepareServerEnv, prepareServerSql } from './server-support';

prepareServerEnv();

interface ProfileBody {
  nickname: string | null;
}

describe('the global nickname', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('a caller with no profile reads a null nickname', async () => {
    // Arrange
    const userId = await createUser();

    // Act
    const response = await call('/api/profile', { userId });

    // Assert — null rather than 404: "you have not chosen one yet" is a state the
    // client acts on (it shows the gate), not a missing resource.
    assert.equal(response.status, 200);
    const body = await bodyOf<ProfileBody>(response);
    assert.equal(body.nickname, null);
  });

  test('a nickname round-trips: the write is stored and echoed back', async () => {
    // Arrange
    const userId = await createUser();

    // Act
    const written = await call('/api/profile', {
      method: 'PUT',
      userId,
      body: { nickname: 'Bahar' },
    });

    // Assert
    assert.equal(written.status, 200);
    const stored = await bodyOf<ProfileBody>(written);
    assert.equal(stored.nickname, 'Bahar');

    // And it is still there on a fresh read, not just in the response.
    const reread = await call('/api/profile', { userId });
    const body = await bodyOf<ProfileBody>(reread);
    assert.equal(body.nickname, 'Bahar');
  });

  test('the name can be changed', async () => {
    // Arrange
    const userId = await createUser();
    await call('/api/profile', { method: 'PUT', userId, body: { nickname: 'Bahar' } });

    // Act
    await call('/api/profile', { method: 'PUT', userId, body: { nickname: 'Nima' } });

    // Assert
    const reread = await call('/api/profile', { userId });
    const body = await bodyOf<ProfileBody>(reread);
    assert.equal(body.nickname, 'Nima');
  });

  test('a blank nickname is rejected', async () => {
    // Arrange
    const userId = await createUser();

    // Act
    const response = await call('/api/profile', {
      method: 'PUT',
      userId,
      body: { nickname: '   ' },
    });

    // Assert — whitespace-only would render as an empty gap on every proposal
    // card, indistinguishable from a rendering bug. 422 is this API's validation
    // status (`VALIDATION_FAILED` in src/lib/errors.ts), with a `fields` map.
    assert.equal(response.status, 422);
  });

  test('a nickname over 30 characters is rejected', async () => {
    // Arrange
    const userId = await createUser();

    // Act
    const response = await call('/api/profile', {
      method: 'PUT',
      userId,
      body: { nickname: 'a'.repeat(31) },
    });

    // Assert — the same 30-character ceiling `participant.display_name` enforces.
    assert.equal(response.status, 422);
  });

  test('the database rejects a blank nickname even if a route forgets to check', async () => {
    // Arrange
    const userId = await createUser();

    // Act / Assert — the constraint, not the route, is the guarantee. Both
    // backends reach the same table, so this is what makes them agree.
    await assert.rejects(
      () =>
        asOwner('insert into user_profile (auth_user_id, nickname) values ($1, $2)', [
          userId,
          '   ',
        ]),
      /nickname_not_blank|check constraint/i,
    );
  });

  test('one caller cannot read another caller\u2019s profile', async () => {
    // Arrange
    const owner = await createUser();
    const stranger = await createUser();
    await call('/api/profile', { method: 'PUT', userId: owner, body: { nickname: 'Bahar' } });

    // Act — the stranger asks for their OWN profile, which must not be the owner's.
    const response = await call('/api/profile', { userId: stranger });

    // Assert — a nickname reaches other participants through
    // `participant.display_name` inside an event. This table is not a directory.
    const body = await bodyOf<ProfileBody>(response);
    assert.equal(body.nickname, null);
  });

  test('joining an event seeds display_name from the nickname', async () => {
    // Arrange
    const created = await createEventViaApi();
    const userId = await createUser();
    await call('/api/profile', { method: 'PUT', userId, body: { nickname: 'Sara' } });

    // Act — join without sending a display_name of its own.
    const joined = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId,
      body: {},
    });

    // Assert — this is what makes the nickname appear on proposals, votes,
    // comments and messages without changing any of their serialisers.
    assert.equal(joined.status, 200);
    const body = await bodyOf<{ participant: { display_name: string } }>(joined);
    assert.equal(body.participant.display_name, 'Sara');
  });

  test('an explicit name at join time wins over the nickname', async () => {
    // Arrange
    const created = await createEventViaApi();
    const userId = await createUser();
    await call('/api/profile', { method: 'PUT', userId, body: { nickname: 'Sara' } });

    // Act — a per-event name is one of the reasons both columns exist.
    const joined = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId,
      body: { display_name: 'Sara from work' },
    });

    // Assert
    const body = await bodyOf<{ participant: { display_name: string } }>(joined);
    assert.equal(body.participant.display_name, 'Sara from work');
  });
});
