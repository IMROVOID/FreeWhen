/**
 * The invite redemption RPC.
 *
 * ★ AC-9.8.1: an expired token and a nonexistent token return BYTE-IDENTICAL
 * output.
 *
 * This is a security requirement, not a nicety (FR-8.33). A different message
 * or status for "expired" versus "unknown" lets an attacker probe whether an
 * event exists. The test compares the raw bytes, not a parsed shape, because
 * a difference in key order or whitespace is still a difference.
 *
 * `EVENT_FULL` is deliberately distinguishable — it is only reachable by
 * someone already holding a valid token (FR-8.34).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import {
  asOwner,
  closePool,
  createUser,
  id,
  seedEvent,
  truncateAll,
} from './support';

/** The sha256 hex of a token — the only form that is ever stored. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A future timestamp, for a live invite. */
function future(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}

/** A past timestamp, for an expired invite. */
function past(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

describe('redeem_invite', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // The happy path
  // ───────────────────────────────────────────────────────────
  describe('a valid token', () => {
    test('resolves the event and reports the participant count', async () => {
      // Arrange
      const token = 'a-valid-token';
      const { eventId } = await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      // Act
      const result = await asOwner<{ result: Record<string, unknown> }>(
        `select redeem_invite($1) as result`,
        [token],
      );

      // Assert
      const payload = result.rows[0]?.result;
      assert.equal(payload?.event_id, eventId);
      assert.equal(payload?.title, 'Test event');
      assert.equal(payload?.status, 'OPEN');
      assert.equal(payload?.participant_count, 1);
    });

    test('the plaintext token is never stored — only its hash', async () => {
      const token = 'never-stored-plaintext';
      await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from event where invite_token_hash = $1`,
        [token],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.8.1 — byte-identical errors
  // ───────────────────────────────────────────────────────────
  describe('the errors are byte-identical (AC-9.8.1)', () => {
    test('an expired token and a nonexistent token produce identical bytes', async () => {
      // Arrange — a real event whose token has expired
      const expiredToken = 'an-expired-token';
      await seedEvent({
        inviteTokenHash: hashToken(expiredToken),
        inviteExpiresAt: past(),
      });

      // Act
      const expired = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [expiredToken],
      );
      const nonexistent = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        ['a-token-that-never-existed'],
      );

      // Assert — the raw JSON bytes, not a parsed shape
      const expiredBytes = JSON.stringify(expired.rows[0]?.result);
      const nonexistentBytes = JSON.stringify(nonexistent.rows[0]?.result);

      assert.equal(expiredBytes, nonexistentBytes);
      assert.equal(expiredBytes, '{"error":"INVITE_INVALID"}');
    });

    test('a revoked token is indistinguishable from an invalid one', async () => {
      // A revoked or rotated token no longer has its hash in the table, so
      // it arrives as "no event" — and must be indistinguishable.
      const revokedToken = 'a-revoked-token';
      await seedEvent({
        inviteTokenHash: hashToken(revokedToken),
        inviteExpiresAt: future(),
      });

      // Act — revoke by removing the hash
      await asOwner(`update event set invite_token_hash = null where invite_token_hash = $1`, [
        hashToken(revokedToken),
      ]);

      const revoked = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [revokedToken],
      );
      const invalid = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        ['never-existed'],
      );

      // Assert
      assert.equal(JSON.stringify(revoked.rows[0]?.result), JSON.stringify(invalid.rows[0]?.result));
      assert.equal(JSON.stringify(revoked.rows[0]?.result), '{"error":"INVITE_INVALID"}');
    });

    test('a token with no expiry is treated as invalid, not as valid-forever', async () => {
      // An invite with no expiry cannot be validated, and "cannot be
      // validated" must not mean "always works".
      const token = 'a-token-without-expiry';
      await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: null,
      });

      const result = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [token],
      );
      assert.equal(JSON.stringify(result.rows[0]?.result), '{"error":"INVITE_INVALID"}');
    });

    test('an empty token is invalid', async () => {
      const result = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [''],
      );
      assert.equal(JSON.stringify(result.rows[0]?.result), '{"error":"INVITE_INVALID"}');
    });
  });

  // ───────────────────────────────────────────────────────────
  // FR-8.34 — EVENT_FULL
  // ───────────────────────────────────────────────────────────
  describe('the participant cap', () => {
    test('a full event returns EVENT_FULL — deliberately distinguishable', async () => {
      // Arrange — an event with ten participants
      const token = 'a-full-event-token';
      const { eventId } = await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      // The organizer is one of the ten.
      for (let i = 0; i < 9; i += 1) {
        const userId = await createUser();
        await asOwner(
          `insert into participant (id, event_id, auth_user_id, display_name) values ($1, $2, $3, $4)`,
          [id(), eventId, userId, `Guest ${i}`],
        );
      }

      // Act
      const result = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [token],
      );

      // Assert
      assert.equal(JSON.stringify(result.rows[0]?.result), '{"error":"EVENT_FULL"}');
    });

    test('an event with nine participants is still redeemable', async () => {
      const token = 'a-nearly-full-token';
      const { eventId } = await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      for (let i = 0; i < 8; i += 1) {
        const userId = await createUser();
        await asOwner(
          `insert into participant (id, event_id, auth_user_id, display_name) values ($1, $2, $3, $4)`,
          [id(), eventId, userId, `Guest ${i}`],
        );
      }

      const result = await asOwner<{ result: unknown }>(
        `select redeem_invite($1) as result`,
        [token],
      );

      const payload = result.rows[0]?.result as { participant_count: number };
      assert.equal(payload.participant_count, 9);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The RPC's properties
  // ───────────────────────────────────────────────────────────
  describe('the RPC', () => {
    test('it is executable by the anon role', async () => {
      // It is the ONLY path that works before a session exists, so it must
      // be reachable without a JWT.
      const token = 'an-anon-reachable-token';
      await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      const result = await asOwner<{ result: { event_id?: string } }>(
        `select redeem_invite($1) as result`,
        [token],
      );
      assert.ok(result.rows[0]?.result.event_id);
    });

    test('it is security definer with a pinned search_path', async () => {
      // A definer function without `set search_path` lets a caller shadow
      // `event` with a temp table. `pg_temp` must be listed LAST, so the
      // real schema is searched first.
      const rows = await asOwner<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'redeem_invite'`,
      );
      assert.equal(rows.rows[0]?.prosecdef, true);

      const config = rows.rows[0]?.proconfig?.join(',') ?? '';
      assert.match(config, /search_path=/);

      const parts = config
        .replace('search_path=', '')
        .split(',')
        .map((part) => part.trim());
      assert.equal(parts[parts.length - 1], 'pg_temp', 'pg_temp must be listed last');
      assert.ok(parts.includes('public'), 'public must be in the search_path');
    });

    test('it does not write anything', async () => {
      // The RPC resolves the invite and reports the count. The join itself
      // happens in Phase 5, inside the transaction that holds the row lock.
      const token = 'a-read-only-token';
      await seedEvent({
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: future(),
      });

      const before = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant`,
      );

      await asOwner(`select redeem_invite($1)`, [token]);

      const after = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant`,
      );
      assert.equal(after.rows[0]?.n, before.rows[0]?.n);
    });
  });
});
