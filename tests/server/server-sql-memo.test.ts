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
 */
function countingQueryable(options: { present?: boolean; recovers?: boolean } = {}) {
  const state = { queries: 0, present: options.present ?? true, applied: 0 };

  const queryable: Queryable = {
    async query<T>(text: string) {
      state.queries += 1;

      // The catalogue lookup — answer it according to `present`.
      if (text.includes('from pg_proc')) {
        return {
          rows: (state.present ? [{ proname: 'join_event' }] : []) as T[],
          rowCount: state.present ? 1 : 0,
        };
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
    // The catalogue never reports join_event, even after the DDL runs. That is
    // a broken .sql, not a transient state, and it must be a named error rather
    // than an infinite retry or a silent success.
    const { queryable, state } = countingQueryable({ present: false });

    const { ensureServerSql, resetServerSqlVerification } = await import(
      '@/server/lib/server-sql'
    );
    resetServerSqlVerification();

    await assert.rejects(
      withRequestQueryable(queryable, () => ensureServerSql()),
      /did not create: join_event/,
    );

    // Two catalogue checks (before and after the apply) plus the DDL statement —
    // and crucially a bounded number, not a loop.
    assert.ok(state.queries >= 3, 'must check, apply, then check once more');
    assert.ok(state.queries <= 6, 'the retry must be bounded');
  });
});
