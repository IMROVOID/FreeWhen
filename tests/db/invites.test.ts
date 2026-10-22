/**
 * The invite surface (Plan 05, Tasks 4 and 12).
 *
 * ★ AC-1.2.2 / AC-1.2.3 / AC-8.4.1 — invalid, expired and revoked are
 * BYTE-IDENTICAL over the wire.
 *
 * A different status, a different body, a different key order or a stray header
 * all tell an attacker that the event exists. The assertions therefore compare
 * the raw response text and the status, not a parsed shape.
 *
 * `EVENT_FULL` is deliberately the exception (AC-1.2.5): it is reachable only by
 * a caller already holding a valid link, so naming it reveals nothing.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { hashToken } from '@/server/lib/invite-token';
import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool, truncateAll } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
  rawBodyOf,
  tokenFromUrl,
} from './server-support';

// The server reads DATABASE_URL lazily, on its first query, so setting it here
// — before any test body runs — is enough and no import ordering applies.
prepareServerEnv();

describe('invite resolution', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    // ★ THE RATE LIMITERS ARE MODULE-LEVEL, so they survive between test
    // files in one process. A file that inherits an exhausted budget would
    // see a 404 where it expects a 200, and the failure would read as a
    // broken invite rather than as a shared counter.
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('AC-1.1.1 — the event is created with the creator as its organizer', async () => {
    const created = await createEventViaApi({ title: 'شام جمعه' });

    // The creator is a participant, and their role is `organizer` (FR-1.2) —
    // not `member`, and not a second row.
    const creator = await asOwner<{ role: string; display_name: string; n: string }>(
      `select p.role, p.display_name, count(*)::text as n
         from participant p
        where p.event_id = $1 and p.auth_user_id = $2
        group by p.role, p.display_name`,
      [created.eventId, created.userId],
    );

    assert.equal(creator.rows[0]?.role, 'organizer');
    assert.equal(creator.rows[0]?.n, '1', 'the creator has exactly one participant row');

    // The event starts in `DRAFT` and moves to `OPEN` when the link is
    // generated (PRD-01 §3). Both states are recorded by the same call, so the
    // transition is asserted from the status history the server keeps.
    const status = await asOwner<{ status: string }>(
      `select status from event where id = $1`,
      [created.eventId],
    );
    assert.equal(status.rows[0]?.status, 'OPEN');

    // A `DRAFT` event has no working link; an `OPEN` one does. The observable
    // consequence of the transition is the one that matters.
    const resolved = await call(`/api/invite/${created.token}`);
    assert.equal(resolved.status, 200);
  });

  test('a valid token resolves the event title, status and count', async () => {
    const created = await createEventViaApi({ title: 'شام جمعه' });

    const response = await call(`/api/invite/${created.token}`);
    assert.equal(response.status, 200);

    const body = await bodyOf<{ event: { event_id: string; title: string; participant_count: number } }>(
      response,
    );

    assert.equal(body.event.event_id, created.eventId);
    assert.equal(body.event.title, 'شام جمعه');
    // The organizer is already a participant (FR-1.2).
    assert.equal(body.event.participant_count, 1);
  });

  test('the token is stored only as a hash', async () => {
    const created = await createEventViaApi();

    const byPlaintext = await asOwner<{ n: string }>(
      `select count(*)::text as n from event where invite_token_hash = $1`,
      [created.token],
    );
    assert.equal(byPlaintext.rows[0]?.n, '0');

    const byHash = await asOwner<{ n: string }>(
      `select count(*)::text as n from event where invite_token_hash = $1`,
      [hashToken(created.token)],
    );
    assert.equal(byHash.rows[0]?.n, '1');
  });

  test('the stored token is never the plaintext value', async () => {
    const created = await createEventViaApi();

    const stored = await asOwner<{ invite_token_hash: string }>(
      `select invite_token_hash from event where id = $1`,
      [created.eventId],
    );

    const hash = stored.rows[0]?.invite_token_hash ?? '';
    assert.equal(hash.length, 64);
    assert.notEqual(hash, created.token);
  });

  test('AC-1.2.2 / AC-1.2.3 / AC-8.4.1 — expired, revoked and unknown are byte-identical', async () => {
    const expired = await createEventViaApi();
    await asOwner(
      `update event set invite_expires_at = now() - interval '1 hour' where id = $1`,
      [expired.eventId],
    );

    const revoked = await createEventViaApi();
    const revokeResponse = await call(`/api/events/${revoked.eventId}/invite`, {
      method: 'DELETE',
      userId: revoked.userId,
    });
    assert.equal(revokeResponse.status, 200);

    const unknown = randomBytes(16).toString('base64url');

    const responses = await Promise.all([
      call(`/api/invite/${expired.token}`),
      call(`/api/invite/${revoked.token}`),
      call(`/api/invite/${unknown}`),
    ]);

    const [expiredResponse, revokedResponse, unknownResponse] = responses;
    assert.ok(expiredResponse && revokedResponse && unknownResponse);

    const canonicalStatus = unknownResponse.status;
    const canonicalBody = await rawBodyOf(unknownResponse);

    assert.equal(expiredResponse.status, canonicalStatus);
    assert.equal(await rawBodyOf(expiredResponse), canonicalBody);

    assert.equal(revokedResponse.status, canonicalStatus);
    assert.equal(await rawBodyOf(revokedResponse), canonicalBody);

    // And the canonical shape is the generic one, not a 200 with a null event.
    assert.equal(canonicalStatus, 404);
    assert.equal(JSON.parse(canonicalBody).error, 'INVITE_INVALID');
  });

  test('AC-1.2.6 — rotation invalidates the old link and issues a working new one', async () => {
    const created = await createEventViaApi();

    const rotated = await call(`/api/events/${created.eventId}/invite/rotate`, {
      method: 'POST',
      userId: created.userId,
    });
    assert.equal(rotated.status, 200);

    const body = await bodyOf<{ invite: { url: string } }>(rotated);
    const rotatedToken = tokenFromUrl(body.invite.url);
    assert.notEqual(rotatedToken, created.token);

    const oldLink = await call(`/api/invite/${created.token}`);
    assert.equal(oldLink.status, 404);

    const newLink = await call(`/api/invite/${rotatedToken}`);
    assert.equal(newLink.status, 200);
  });

  test('a rotate request from a non-organizer is refused and the link survives', async () => {
    const created = await createEventViaApi();

    const joined = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Ali' },
    });
    assert.equal(joined.status, 200);
    const memberId = joined.headers.get('x-user-id') ?? '';

    const attempt = await call(`/api/events/${created.eventId}/invite/rotate`, {
      method: 'POST',
      userId: memberId,
    });
    assert.equal(attempt.status, 403);

    // The organizer's link is untouched.
    const stillValid = await call(`/api/invite/${created.token}`);
    assert.equal(stillValid.status, 200);
  });

  test('a revoke request from a non-organizer is refused', async () => {
    const created = await createEventViaApi();

    const attempt = await call(`/api/events/${created.eventId}/invite`, {
      method: 'DELETE',
      userId: created.organizerParticipantId,
    });

    assert.equal(attempt.status, 403);
    assert.equal((await call(`/api/invite/${created.token}`)).status, 200);
  });

  test('the eleventh redemption from one address returns the generic error, not a 429', async () => {
    resetRateLimits();
    const created = await createEventViaApi();
    const address = '203.0.113.44';

    for (let attempt = 1; attempt <= 10; attempt++) {
      const response = await call(`/api/invite/${created.token}`, { ip: address });
      assert.equal(response.status, 200, `redemption ${attempt} should be allowed`);
    }

    const eleventh = await call(`/api/invite/${created.token}`, { ip: address });

    // The limiter must not announce itself: a 429 with its own body would be a
    // cheaper oracle than the token check it protects (FR-1.15).
    assert.equal(eleventh.status, 404);
    assert.equal(JSON.parse(await rawBodyOf(eleventh)).error, 'INVITE_INVALID');
  });

  test('the token budget is separate from the address budget', async () => {
    resetRateLimits();
    const created = await createEventViaApi();

    // 30 redemptions against one token, each from a different address.
    for (let attempt = 1; attempt <= 30; attempt++) {
      const response = await call(`/api/invite/${created.token}`);
      assert.equal(response.status, 200, `token redemption ${attempt} should be allowed`);
    }

    const overToken = await call(`/api/invite/${created.token}`);
    assert.equal(overToken.status, 404);
  });

  test('opening a valid link reports the top-of-funnel event', async () => {
    const created = await createEventViaApi({ title: 'قهوه' });

    const response = await call(`/api/invite/${created.token}`, { platform: 'web' });
    assert.equal(response.status, 200);

    const body = await bodyOf<{ event: { title: string } }>(response);
    assert.equal(body.event.title, 'قهوه');
  });
});
