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
  if (!applied) {
    applied = apply();
    applied.catch(() => {
      applied = undefined;
      verifiedAt = 0;
    });
  }

  // ★ THE STEADY-STATE EXIT. A timestamp comparison instead of a round-trip.
  if (verificationIsFresh()) return applied;

  const missing = await missingFunctions();
  if (missing.length > 0) {
    // ★ ONE RETRY, NOT A LOOP.
    //
    // The schema was rebuilt under us, so re-apply. The retry is bounded
    // deliberately: if `join_event` is still missing after the DDL ran, the
    // .sql itself is wrong and a recursive re-check would spin forever — a
    // hang that looks like a network problem and is not.
    applied = undefined;
    verifiedAt = 0;
    await apply();

    const stillMissing = await missingFunctions();
    if (stillMissing.length > 0) {
      applied = undefined;
      throw new Error(
        `server/sql did not create: ${stillMissing.join(', ')} — ` +
          'the inlined SQL in server/sql/index.ts is out of date; ' +
          'run `npm run gen:server-sql`',
      );
    }

    applied = Promise.resolve();
    verifiedAt = Date.now();
    return;
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
