/**
 * Applies the server-owned SQL (Plan 05 owns `server/sql/`).
 *
 * The migration runner applies `migrations/`, which belong to other phases.
 * The join function is this phase's, and putting it in `migrations/` would mean
 * editing a directory two other agents are writing to. It lives in
 * `server/sql/` and is applied idempotently — every statement is
 * `create or replace` / `drop ... if exists` — by the server at first use and
 * by the database test suite at setup.
 *
 * One file, one applier, so the tests exercise the SQL the server actually runs.
 * A hand-copied function in the test file would drift and the drift would look
 * like a passing suite.
 */

import { SERVER_SQL, serverSqlFiles } from '../sql';
import { scopedQueryable } from './supabase';

/**
 * `server/sql` is INLINED, not read from disk (Plan 39 T1).
 *
 * ★ WHY THE READ WENT AWAY.
 *
 * This module used `node:fs` + `node:path` + `node:url` to enumerate and read
 * `server/sql/*.sql` at import time. That one dependency made the entire server
 * un-runnable on a host with no filesystem — the whole API refused to boot for
 * the sake of a 9 KB constant.
 *
 * The `.sql` files remain the source of truth a human edits. `server/sql/index.ts`
 * is generated from them by `npm run gen:server-sql`, and
 * `tests/server/server-sql.test.ts` fails if the two drift, so a forgotten
 * regeneration is a red suite rather than a deployed server running stale SQL.
 */

export { serverSqlFiles };

/**
 * Applies every server SQL file. Memoised, so a running server pays for it once.
 *
 * A failed apply clears the memo: a transient connection error must not leave
 * the process permanently believing the function exists.
 */
let applied: Promise<void> | undefined;

/**
 * The in-flight verification, so concurrent callers share ONE of them.
 *
 * Separate from `applied` because a verification is not just the apply: it
 * reads the catalogue and may retry. Sharing only `applied` let two callers
 * each run a retry, and two concurrent `create or replace function` calls for
 * the same signature collide in `pg_proc`.
 */
let ensured: Promise<void> | undefined;

/**
 * The functions `server/sql/` is expected to have created.
 *
 * ★ THE EXISTENCE CHECK IS NOT AN OPTIMISATION.
 *
 * `server/sql/` is applied at runtime rather than through `migrations/`, so
 * anything that rebuilds the schema — a `--fresh` migration in another
 * phase's test suite, for instance — drops the `public` schema and takes these
 * functions with it. A server that believed the function was still there would
 * then fail every join with "function does not exist", and the failure would
 * look like a bug in the join rather than a wiped schema.
 *
 * So the applier verifies what it created and re-applies when it is missing.
 *
 * ★ THE CHECK IS MEMOIZED, AND IT HAS TO BE (Plan 39 T4).
 *
 * This comment used to claim the lookup "runs once per process in the steady
 * state". It did not — `missingFunctions()` was awaited on every call, and
 * `joinViaInvite` calls `ensureServerSql()` on every join. On Node that was one
 * wasted round-trip per join. On a Worker it is one per REQUEST, on top of the
 * per-request client connect, which doubles the connection cost of the hottest
 * write path in the product.
 *
 * `verified` now records WHEN the check last passed, and it is honoured only
 * for a bounded window. That keeps both properties:
 *
 *   - steady state costs a timestamp comparison, not a round-trip
 *   - a schema wiped by another suite is still noticed, because the window
 *     expires and the next caller re-verifies
 *
 * A permanent latch would have saved the round-trip permanently and silently
 * defeated the recovery path — which is the bug the original check was written
 * to prevent. A TTL cannot be correct in every topology, but it degrades to
 * "the old behaviour, occasionally" rather than "never again".
 */
/**
 * The functions `server/sql/` is expected to have created.
 *
 * ★ EVERY `.sql` FILE MUST ADD ITS FUNCTION HERE.
 *
 * This array is what the applier verifies. A function that is created by a
 * `.sql` file but missing from this list is never checked, so a schema wipe
 * would go unnoticed and every call to it would fail with "function does not
 * exist" — the failure the check above exists to make loud.
 *
 * Plan 40 added the RPCs the PostgREST transport needs (Tasks 6–8). They are
 * listed here in the same commit as their `.sql` files for exactly the reason
 * above.
 */
const EXPECTED_FUNCTIONS = [
  'join_event',
  'cast_vote',
  'confirm_decision',
  'reopen_event',
  'resolve_caller',
  'create_anonymous_user',
] as const;

/**
 * How long a passing verification is trusted, in milliseconds.
 *
 * ★ CHOSEN FOR THE FAILURE MODE, NOT THE LATENCY.
 *
 * The cost of trusting a stale pass is a join failing with "function does not
 * exist" for up to this long after a schema wipe; that is a test-suite
 * annoyance, not a production hazard, because a real deploy does not drop the
 * public schema under a running server. The cost of a shorter window is one
 * catalogue lookup per window per isolate.
 *
 * 30 s is short enough that a `--fresh` migration in a neighbouring suite is
 * noticed within one test file's runtime, and long enough that a busy Worker
 * pays the lookup a negligible number of times.
 */
const VERIFY_TTL_MS = 30_000;

/** When the check last passed, or 0 when it has not. */
let verifiedAt = 0;

function verificationIsFresh(now = Date.now()): boolean {
  return verifiedAt !== 0 && now - verifiedAt < VERIFY_TTL_MS;
}

/** Forces the next `ensureServerSql()` to re-verify. Tests use this. */
export function resetServerSqlVerification(): void {
  verifiedAt = 0;
}

async function missingFunctions(): Promise<string[]> {
  const result = await scopedQueryable().query<{ proname: string }>(
    `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any($1)`,
    [[...EXPECTED_FUNCTIONS]],
  );

  const present = new Set(result.rows.map((row) => row.proname));
  return EXPECTED_FUNCTIONS.filter((name) => !present.has(name));
}

export async function ensureServerSql(): Promise<void> {
  // ★ ONE IN-FLIGHT VERIFICATION, NOT ONE PER CALLER.
  //
  // The memo used to guard only `apply()`. The verification (and its retry)
  // ran OUTSIDE it, so every caller that entered while a retry was in flight
  // started its own `apply()`. Postgres then answered
  // `duplicate key value violates unique constraint "pg_proc_proname_args_nsp_index"`
  // — because two concurrent `create or replace function` for the same
  // signature race on the catalogue insert.
  //
  // The concurrency is real: `node --test` runs every database suite in ONE
  // process, and each file's `before` hook calls this function. On a freshly
  // migrated database none of them sees the functions yet, so all of them
  // retried at once and the suite failed in a different file each run.
  if (!ensured) {
    ensured = ensure().finally(() => {
      ensured = undefined;
    });
  }

  return ensured;
}

async function ensure(): Promise<void> {
  // ★ THE STEADY-STATE EXIT COMES FIRST, BEFORE ANY DDL IS ISSUED.
  //
  // This used to be `if (!applied) applied = apply()` followed by the check, so
  // EVERY cold start re-ran all six `server/sql/*.sql` files. On a backend where
  // the server's role is not the owner of the functions — any managed Postgres
  // whose migration role differs from its application role — `create or replace`
  // is refused, and the refusal surfaced as
  //
  //     api: request failed: permission denied for schema public
  //
  // on the first request after every deploy: a 500 on join, on vote, on
  // confirm, on the proposal list. The applier's whole purpose is to repair a
  // schema that was wiped, and a schema that was wiped has NO functions — so
  // asking that question first is both cheaper and the only version that needs
  // no DDL privilege in the common case.
  //
  // ★ A PASSING VERIFICATION STILL SHORT-CIRCUITS WITH NO ROUND TRIP.
  if (verificationIsFresh()) {
    await applied;
    return;
  }

  // ★ THE FIRST CHECK IS WHAT DECIDES WHETHER ANY DDL IS NEEDED.
  //
  // `await applied` used to run before this, so every cold start applied all six
  // files. On a backend where the server's role is not their owner — any managed
  // Postgres whose migration role differs from its application role —
  // `create or replace` is refused and the first request after each deploy
  // answered `permission denied for schema public`: a 500 on join, vote, confirm
  // and the proposal list. The applier exists to repair a wiped schema, and a
  // wiped schema has no functions, so asking first is both cheaper and the only
  // version that needs no DDL privilege in the normal case.
  const missing = await missingFunctions();

  if (missing.length === 0) {
    // Nothing to repair, so nothing may be issued. `applied` still has to be a
    // resolved promise: later callers await it.
    applied ??= Promise.resolve();
    verifiedAt = Date.now();
    return applied;
  }

  if (!applied) {
    applied = apply();
    applied.catch(() => {
      applied = undefined;
      verifiedAt = 0;
    });
  }

  // ★ WAIT FOR THE APPLY BEFORE CHECKING WHAT IT CREATED.
  //
  // `missingFunctions()` used to run while the first `apply()` was still in
  // flight. On a fresh database the catalogue therefore looked empty, the
  // "schema was rebuilt under us" branch fired, and a SECOND `apply()` started
  // alongside the first. Two concurrent `create or replace function` calls for
  // the same signature race on the catalogue insert and Postgres answers
  // `duplicate key value violates unique constraint "pg_proc_proname_args_nsp_index"`
  // — the applier colliding with itself, reported as if the SQL were wrong.
  //
  // Awaiting first is what makes the check mean "the apply finished and these
  // are still missing", which is the only reading the retry is for.
  await applied;

  const stillMissing = await missingFunctions();
  if (stillMissing.length > 0) {
    // ★ ONE RETRY, NOT A LOOP.
    //
    // The schema was rebuilt under us — between the check above and the apply,
    // or the apply itself did not take. The retry is bounded deliberately: if
    // `join_event` is still missing after the DDL ran, the .sql itself is wrong
    // and a recursive re-check would spin forever — a hang that looks like a
    // network problem and is not.
    applied = apply();
    const retry = applied;

    try {
      await retry;
    } catch (error) {
      applied = undefined;
      verifiedAt = 0;
      throw error;
    }

    const stillAbsent = await missingFunctions();
    if (stillAbsent.length > 0) {
      applied = undefined;
      throw new Error(
        `server/sql did not create: ${stillAbsent.join(', ')} — ` +
          'the inlined SQL in server/sql/index.ts is out of date; ' +
          'run `npm run gen:server-sql`',
      );
    }

    verifiedAt = Date.now();
    return retry;
  }

  verifiedAt = Date.now();
  return applied;
}

async function apply(): Promise<void> {
  // Applying changes the schema, so any previous verification is stale.
  verifiedAt = 0;

  const pool = scopedQueryable();

  for (const file of serverSqlFiles()) {
    const sql = SERVER_SQL[file];
    // A missing entry here means the generator was never run after a `.sql`
    // file was added. Fail loudly rather than silently applying nothing.
    if (sql === undefined) {
      throw new Error(
        `server/sql/index.ts has no inlined text for ${file} — run \`npm run gen:server-sql\``,
      );
    }
    await pool.query(sql);
  }
}
