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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { servicePool } from './supabase';

/** `server/sql`, resolved from this file rather than from the working directory. */
export const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** Every `.sql` file in `server/sql`, in name order. */
export function serverSqlFiles(): string[] {
  return readdirSync(SQL_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

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
 * The check is one indexed catalogue lookup, and it runs once per process in
 * the steady state.
 */
const EXPECTED_FUNCTIONS = ['join_event'] as const;

async function missingFunctions(): Promise<string[]> {
  const result = await servicePool().query<{ proname: string }>(
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
    });
  }

  const missing = await missingFunctions();
  if (missing.length > 0) {
    // The schema was rebuilt under us. Re-apply and let the next call verify.
    applied = undefined;
    await ensureServerSql();
  }

  return applied;
}

async function apply(): Promise<void> {
  const pool = servicePool();

  for (const file of serverSqlFiles()) {
    const sql = readFileSync(join(SQL_DIR, file), 'utf8');
    await pool.query(sql);
  }
}
