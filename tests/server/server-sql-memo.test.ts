/**
 * `ensureServerSql` verification memoization (Plan 39 T4).
 *
 * ★ THE BUG THIS PINS.
 *
 * The doc comment claimed the existence check "runs once per process in the
 * steady state". It did not: `missingFunctions()` was awaited on EVERY call, and
 * `joinViaInvite` calls `ensureServerSql()` on every join. On Node that is one
 * wasted round-trip per join; on Workers it is one per request, in addition to
 * the client connect itself.
 *
 * The memo must still be invalidated when the schema is genuinely gone — that
 * is the property the original check exists for, and a memo that never expires
 * would defeat it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withRequestQueryable } from '@/server/lib/db-scope';
import type { Queryable } from '@/server/lib/supabase';

/**
 * A queryable that counts calls and can pretend a function is missing.
 *
 * `recovers` models the realistic wipe: the function is gone until the DDL runs
 * again, then it exists. A fake that stays broken after the apply models a
 * malformed `.sql`, which is a different (and separately tested) failure.
 *
 * ★ THE PRESENT SET IS THE WHOLE EXPECTED LIST, NOT JUST `join_event`.
 *
 * Plan 40 added five RPCs to `EXPECTED_FUNCTIONS`. A fake that reported only
 * `join_event` as present would model a database where the other five are
 * always missing — so every call would take the wipe-and-retry path and this
 * file would fail for a reason that has nothing to do with memoization.
 */
const EXPECTED_PRESENT = [
  'join_event',
  'cast_vote',
  'confirm_decision',
  'reopen_event',
  'resolve_caller',
  'create_anonymous_user',
] as const;

function countingQueryable(options: { present?: boolean; recovers?: boolean } = {}) {
  const state = { queries: 0, present: options.present ?? true, applied: 0 };

  const queryable: Queryable = {
    async query<T>(text: string) {
      state.queries += 1;

      // The catalogue lookup — answer it according to `present`.
      if (text.includes('from pg_proc')) {
        const rows = state.present ? EXPECTED_PRESENT.map((proname) => ({ proname })) : [];
        return { rows: rows as T[], rowCount: rows.length };
      }

      // The DDL apply — nothing to return.
      state.applied += 1;
      if (options.recovers) state.present = true;
      return { rows: [] as T[], rowCount: 0 };
    },
  };

  return { queryable, state };
}

describe('ensureServerSql memoizes its verification', () => {
  it('issues the catalogue check once across repeated calls in one scope', async () => {
    const { queryable, state } = countingQueryable();

    // Loaded fresh so this test owns the module's memo.
    const { ensureServerSql } = await import('@/server/lib/server-sql');

    await withRequestQueryable(queryable, async () => {
      await ensureServerSql();
      const afterFirst = state.queries;

      await ensureServerSql();
      await ensureServerSql();

      const catalogueChecks = (n: number) => n;
      assert.ok(catalogueChecks(afterFirst) > 0, 'the first call must verify');
      assert.equal(
        state.queries,
        afterFirst,
        'later calls in the same scope must not re-query the catalogue',
      );
    });
  });

  it('re-verifies and recovers when the schema was rebuilt under it', async () => {
    // The wipe-and-recover case: the function is gone, the re-apply restores
    // it, and the caller succeeds. This is the path a `--fresh` migration in a
    // neighbouring suite produces.
    const { queryable, state } = countingQueryable({ present: false, recovers: true });

    const { ensureServerSql, resetServerSqlVerification } = await import(
      '@/server/lib/server-sql'
    );
    resetServerSqlVerification();

    await withRequestQueryable(queryable, () => ensureServerSql());

    assert.ok(state.applied >= 1, 'a missing function must trigger the DDL apply');
    assert.equal(state.present, true, 'the fake recovered, so the call succeeds');
  });

  it('re-applies, then fails loudly if the DDL did not create the function', async () => {
    // The catalogue never reports the functions, even after the DDL runs. That
    // is a broken .sql, not a transient state, and it must be a named error
    // rather than an infinite retry or a silent success.
    const { queryable, state } = countingQueryable({ present: false });

    const { ensureServerSql, resetServerSqlVerification, serverSqlFiles } = await import(
      '@/server/lib/server-sql'
    );
    resetServerSqlVerification();

    await assert.rejects(
      withRequestQueryable(queryable, () => ensureServerSql()),
      /did not create: join_event/,
    );

    // ★ THE BOUND IS EXPRESSED IN APPLIES, NOT RAW QUERIES.
    //
    // A raw query count no longer measures "bounded" because one DDL apply is
    // one query per `.sql` file — six now, one when this test was written. The
    // property under test is that the function verifies, applies ONCE, verifies
    // again and then throws: three catalogue checks and one apply. Anything more
    // would be the unbounded retry this exists to rule out.
    //
    // ★ THREE CHECKS, BECAUSE THE FIRST ONE GATES THE DDL.
    //
    //   1. "are the functions there?" — the answer decides whether to apply at
    //      all. This is what stops a backend that does not OWN its functions
    //      from issuing `create or replace` it has no right to run.
    //   2. after the apply, to see whether it took.
    //   3. after the retry, which is the one that throws.
    const oneApply = serverSqlFiles().length;
    const catalogueChecks = state.queries - state.applied;

    assert.equal(state.applied, oneApply, 'the DDL must run exactly once, not in a loop');
    assert.equal(catalogueChecks, 3, 'one gating check, one after the apply, one after the retry');
  });

  it('issues no DDL at all when the functions are already present', async () => {
    // ★ The property that keeps the applier off a backend it cannot write to.
    //
    // Every cold start used to re-apply all six files before asking whether it
    // needed to. Where the server's role is not their owner, `create or replace`
    // is refused and the first request after each deploy was a 500.
    const { queryable, state } = countingQueryable({ present: true });

    const { ensureServerSql, resetServerSqlVerification } = await import(
      '@/server/lib/server-sql'
    );
    resetServerSqlVerification();

    await withRequestQueryable(queryable, () => ensureServerSql());

    assert.equal(state.applied, 0, 'a healthy schema must receive no DDL');
  });
});
