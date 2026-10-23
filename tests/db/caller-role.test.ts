/**
 * The effective database role inside `withCallerTransaction`.
 *
 * ★ THE HIGHEST-RISK STEP IN THE WORKERS PORT, SO IT IS ASSERTED, NOT INFERRED.
 *
 * `set local role service_role` only works when it is issued INSIDE a
 * transaction. Outside one it applies to nothing and reverts immediately — and
 * that failure is invisible on Node, where `DATABASE_URL` connects as a
 * superuser for whom `revoke`/`grant` are ignored anyway. The bug would surface
 * only on Workers, as every query silently running as the schema owner with RLS
 * as the sole gate.
 *
 * A test that merely calls `join_event` and checks the row appears would pass
 * under both orders. So this file asserts `current_user` and `session_user`
 * directly.
 *
 * ★ ROLE IS NOT IDENTITY.
 *
 * `service_role` selects PRIVILEGES. `request.jwt.claims` selects WHO. Both are
 * required and they are independent: `join_event` is granted to `service_role`
 * only, so `authenticated` cannot execute it, while the function reads the
 * caller from `auth.uid()`, which comes from the claims. This file pins both.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { closeServicePool, withCallerTransaction, type Caller } from '@/server/lib/supabase';

import { closePool, createUser } from './support';
import { prepareServerEnv, prepareServerSql } from './server-support';

/** The connection's role before any `set local role`, for contrast. */
let sessionRole: string;

describe('the caller transaction pins its role', () => {
  before(async () => {
    prepareServerEnv();
    await prepareServerSql();

    const { scopedQueryable } = await import('@/server/lib/supabase');
    const row = await scopedQueryable().query<{ current_user: string }>('select current_user');
    sessionRole = row.rows[0]?.current_user ?? '';
  });

  after(async () => {
    await closeServicePool();
    await closePool();
  });

  test('current_user is service_role inside the transaction', async () => {
    const userId = await createUser();
    const caller: Caller = { userId, isAnonymous: true };

    const inside = await withCallerTransaction(caller, async (tx) => {
      const row = await tx.query<{ current_user: string; session_user: string }>(
        'select current_user, session_user',
      );
      return row.rows[0];
    });

    assert.ok(inside);
    assert.equal(
      inside.current_user,
      'service_role',
      'set local role must take effect inside the transaction — outside `begin` it silently no-ops',
    );

    // `set local` changes the effective role for the transaction, never the
    // logged-in one. If `session_user` had changed, the statement would be a
    // session-level `set role` that outlives the request.
    assert.notEqual(inside.session_user, 'service_role');
  });

  test('the session role is unchanged after the transaction', async () => {
    const userId = await createUser();
    await withCallerTransaction({ userId, isAnonymous: true }, async (tx) => {
      await tx.query('select 1');
    });

    const { scopedQueryable } = await import('@/server/lib/supabase');
    const row = await scopedQueryable().query<{ current_user: string }>('select current_user');

    // ★ The leak this guards against: a connection returned to the pool still
    // running as `service_role` would let the next borrower act with privileges
    // it was never granted.
    assert.equal(row.rows[0]?.current_user, sessionRole);
  });

  test('auth.uid() resolves to the caller, not to the role', async () => {
    const userId = await createUser();
    const caller: Caller = { userId, isAnonymous: true };

    const inside = await withCallerTransaction(caller, async (tx) => {
      const uid = await tx.query<{ uid: string | null }>('select auth.uid() as uid');
      const anon = await tx.query<{ anon: boolean | null }>('select auth.is_anonymous() as anon');
      return { uid: uid.rows[0]?.uid, anon: anon.rows[0]?.anon };
    });

    assert.equal(inside.uid, userId, 'identity comes from request.jwt.claims, not from the role');
    assert.equal(inside.anon, true);
  });

  test('the claims do not survive the transaction', async () => {
    const userId = await createUser();
    await withCallerTransaction({ userId, isAnonymous: true }, async (tx) => {
      await tx.query('select 1');
    });

    const { scopedQueryable } = await import('@/server/lib/supabase');
    const row = await scopedQueryable().query<{ uid: string | null }>('select auth.uid() as uid');

    // `set_config(..., true)` is transaction-local: a pooled connection must not
    // carry one caller's identity into the next request.
    assert.notEqual(row.rows[0]?.uid, userId, 'claims must not outlive the transaction');
  });

  test('a thrown callback still rolls back and restores the role', async () => {
    const userId = await createUser();

    await assert.rejects(
      withCallerTransaction({ userId, isAnonymous: true }, async (tx) => {
        await tx.query('select 1');
        throw new Error('rolled back');
      }),
      /rolled back/,
    );

    const { scopedQueryable } = await import('@/server/lib/supabase');
    const row = await scopedQueryable().query<{ current_user: string; uid: string | null }>(
      'select current_user, auth.uid() as uid',
    );

    assert.equal(row.rows[0]?.current_user, sessionRole);
    assert.notEqual(row.rows[0]?.uid, userId);
  });
});
