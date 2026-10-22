/**
 * The database test runner.
 *
 * `npm run test:db` runs the SQL integration suite.
 *
 * Usage:
 *   npm run test:db                     — every suite
 *   npm run test:db -- rls              — only suites whose path matches "rls"
 *   npm run test:db -- --role=anon      — assert the anon role is in effect
 *
 * The suite needs a migrated database. It applies the migrations itself
 * when the schema is missing, so a fresh checkout can run it with one
 * command.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { createPool, databaseUrl, isolatedTestDatabaseUrl, loadDotEnv } from './client';
import { migrate } from './migrate';
import { PROJECT_ROOT } from './paths';

const TESTS_DIR = join(PROJECT_ROOT, 'tests', 'db');
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

function collectTestFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      found.push(...collectTestFiles(fullPath));
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry)) {
      found.push(fullPath);
    }
  }

  return found;
}

/**
 * Creates the per-agent database if it does not exist.
 *
 * The isolated database is derived from the branch name, so it is a name the
 * agent has never connected to before. Connecting to a database that does
 * not exist is an error, so it is created first.
 *
 * The connection used to CREATE it points at the maintenance database
 * (`postgres`), because that is the one database that always exists.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
  const name = /\/([^/?]+)(?:\?|$)/.exec(url)?.[1];
  if (!name) return;

  const maintenance = url.replace(/\/[^/?]+(?=\?|$)/, '/postgres');
  const pool = createPool(maintenance);
  try {
    const exists = await pool.query('select 1 from pg_database where datname = $1', [
      name,
    ]);
    if (exists.rowCount === 0) {
      // CREATE DATABASE cannot run inside a transaction, and cannot take a
      // parameter for its name — the name is an identifier, not a value. It
      // is derived from the branch name and sanitised to [a-z0-9_] by
      // client.ts, so it cannot contain a quote.
      await pool.query(`create database "${name}"`);
      console.log(`test:db: created database ${name}`);
    }
  } catch (error) {
    // A permission error here means the role cannot create databases. The
    // suite then fails against a missing database, which is a clearer
    // error than a silent fallback to the shared one.
    console.error(
      `test:db: could not ensure database ${name} exists: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    await pool.end();
  }
}

/** Whether the schema is already in place. */
async function schemaExists(url = databaseUrl()): Promise<boolean> {
  const pool = createPool(url);
  try {
    const result = await pool.query(
      `select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'vote'`,
    );
    return (result.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const args = process.argv.slice(2);
  const filters = args.filter((arg) => !arg.startsWith('-'));

  // ★ The per-agent database.
  //
  // The suites share one Postgres instance, so two agents running
  // `npm run test:db` at the same time would interleave their inserts and
  // each one's row counts would fail the other's assertions. The suites
  // already run one file at a time, but that only serialises files WITHIN
  // one runner. Each agent gets its own database, derived from the branch.
  const url = isolatedTestDatabaseUrl();
  if (url !== databaseUrl()) {
    console.log(`test:db: isolated database — ${url.replace(/:[^:@/]*@/, ':***@')}`);
    await ensureDatabaseExists(url);
  }

  if (!(await schemaExists(url))) {
    console.log('test:db: schema missing — applying migrations');
    const pool = createPool(url);
    try {
      await migrate(pool, { fresh: false });
    } finally {
      await pool.end();
    }
  }

  const allFiles = collectTestFiles(TESTS_DIR);
  const selected = filters.length
    ? allFiles.filter((file) => {
        const normalised = relative(process.cwd(), file).split(sep).join('/');
        return filters.some((filter) => normalised.toLowerCase().includes(filter.toLowerCase()));
      })
    : allFiles;

  if (selected.length === 0) {
    console.error(`No test files found ${filters.length ? `matching "${filters.join(' ')}"` : 'any'}.`);
    console.error(`Known suites:\n${allFiles.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`Running ${selected.length} database test file(s):`);
  for (const file of selected) {
    console.log(`  ${file}`);
  }

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './tests/setup.ts',
      // ★ One database, so one file at a time.
      //
      // The suites SHARE the database, and node's test runner executes test
      // FILES concurrently by default. Two files truncating or counting rows
      // at the same time make each other's assertions fail — a count taken
      // by one file while another inserts a row, for instance. The suites
      // are green or red on their own merits, so they run in sequence.
      '--test-concurrency=1',
      '--test',
      ...selected,
    ],
    { stdio: 'inherit' },
  );

  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
