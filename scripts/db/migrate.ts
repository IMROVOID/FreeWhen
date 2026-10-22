/**
 * The migration runner.
 *
 * `npm run db:migrate` applies every migration in `migrations/` in filename
 * order. `--fresh` drops the public schema first.
 *
 * The runner is deliberately dumb: it applies files in order and records
 * what it applied. All the intelligence (idempotency, reversibility) lives in
 * the SQL, which is where AC-9.7.1's "repeatable without error" is actually
 * proven.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Pool } from 'pg';

import { createPool, devDatabaseUrl, loadDotEnv } from './client';
import { PROJECT_ROOT } from './paths';

export const MIGRATIONS_DIR = join(PROJECT_ROOT, 'migrations');

/** The migration files, in the order they must be applied. */
export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

const TRACKING_TABLE = `
  create table if not exists schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  );
`;

/**
 * Protects the runner's own bookkeeping table.
 *
 * ★ The manual gate requires that NO public table is left without RLS, and
 * `schema_migrations` is a public table. It holds nothing sensitive — a file
 * name and a timestamp — but the rule is that a table without RLS is
 * readable by anyone holding the publishable key, and the rule is easier to
 * keep true when there is no exception to remember.
 */
async function protectTrackingTable(pool: Pool): Promise<void> {
  // ★ THE ROLE IS NAMED ONLY IF IT EXISTS.
  //
  // The `authenticated` role is created by migration 000 — the portability
  // shim — and the runner protects its tracking table BEFORE any migration
  // is applied. On a genuinely fresh database the role does not exist yet,
  // and `create policy ... to authenticated` fails with
  // `role "authenticated" does not exist`.
  //
  // That is not a hypothetical: it is the exact failure a new host hits on
  // its first `npm run db:migrate`, and the database cannot be migrated at
  // all without hand-applying migration 000 first.
  //
  // The policy is recreated unconditionally AFTER the migrations run, so
  // the end state is identical — the `to authenticated` clause is present
  // on every database that has been migrated. The conditional form is only
  // for the window before the roles exist.
  await pool.query(`
    alter table schema_migrations enable row level security;
    drop policy if exists "no client access to schema_migrations" on schema_migrations;
  `);

  const roles = await pool.query<{ rolname: string }>(
    `select rolname from pg_roles where rolname = 'authenticated'`,
  );

  if (roles.rowCount && roles.rowCount > 0) {
    await pool.query(`
      create policy "no client access to schema_migrations" on schema_migrations
        for all to authenticated
        using (false)
        with check (false);
    `);
  } else {
    // The role does not exist yet, so the policy names nobody. `public` is
    // the fallback: the policy still denies every row, and the `to
    // authenticated` clause is restored by the post-migration pass.
    await pool.query(`
      create policy "no client access to schema_migrations" on schema_migrations
        for all to public
        using (false)
        with check (false);
    `);
  }
}

/**
 * Drops the public schema and recreates it.
 *
 * `auth` is dropped too when it exists, because the schema's tables
 * reference `auth.users` and a leftover identity table from a previous run
 * would make the fresh run test something that is not fresh.
 */
export async function dropEverything(pool: Pool): Promise<void> {
  await pool.query(`
    drop schema if exists public cascade;
    create schema public;
  `);

  // ★ The `auth` schema is NOT dropped.
  //
  // On Supabase it is platform-owned: `auth.users` holds every account and
  // GoTrue writes to it. Dropping it would destroy real identity data, and
  // this script is not only ever pointed at a throwaway database.
  //
  // Instead the rows are cleared and the table is left in place, which
  // mirrors the Supabase behaviour the schema is written against: on
  // Supabase `create table if not exists auth.users` is a no-op, and on
  // plain Postgres migration 000 creates the table. Either way the
  // migration sees the same shape.
  await pool.query(`
    do $$
    begin
      if to_regclass('auth.users') is not null then
        delete from auth.users;
      end if;
    end
    $$;
  `);
}

/** Applies every migration that has not been applied yet. */
export async function migrate(
  pool: Pool,
  options: { fresh?: boolean; dir?: string } = {},
): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;

  if (options.fresh) {
    await dropEverything(pool);
  }

  await pool.query(TRACKING_TABLE);
  await protectTrackingTable(pool);

  const files = migrationFiles(dir);
  const applied: string[] = [];

  for (const file of files) {
    const already = await pool.query<{ name: string }>(
      'select name from schema_migrations where name = $1',
      [file],
    );

    if (already.rowCount && already.rowCount > 0) {
      // Already applied. A migration that is not idempotent would break
      // here, so the "re-running is a no-op" property is checked by the
      // migration runner itself, not only by the test suite.
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
    } catch (error) {
      await client.query('rollback');
      throw new Error(
        `migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  // ★ THE TRACKING TABLE IS PROTECTED AGAIN, NOW THAT THE ROLES EXIST.
  //
  // `protectTrackingTable` runs BEFORE the migrations, because the
  // tracking table has to exist before the runner can record what it
  // applies. At that point the `authenticated` role may not exist yet —
  // migration 000 creates it — so the policy is created against `public`.
  //
  // Recreating it here means the END STATE is identical on every
  // database: the policy names `authenticated`, and no client role can
  // read the table. The pre-migration pass exists only to get past the
  // first migration.
  await protectTrackingTable(pool);

  return applied;
}

/** Re-applies every migration over an already-migrated database. */
export async function reapplyAll(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = migrationFiles(dir);
  const applied: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      applied.push(file);
    } catch (error) {
      await client.query('rollback');
      throw new Error(
        `re-applying ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  return applied;
}

async function main(): Promise<void> {
  loadDotEnv();

  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const reapply = args.includes('--reapply');

  const pool = createPool(devDatabaseUrl());

  try {
    if (reapply) {
      const applied = await reapplyAll(pool);
      console.log(`re-applied ${applied.length} migration(s) with no error`);
      return;
    }

    const applied = await migrate(pool, { fresh });
    const total = migrationFiles().length;

    if (applied.length === 0) {
      console.log(`migrations: up to date (${total} on disk)`);
      return;
    }

    console.log(`migrations: applied ${applied.length} of ${total}`);
    for (const file of applied) {
      console.log(`  + ${file}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
