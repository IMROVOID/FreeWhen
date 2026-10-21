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

import { createPool, databaseUrl, loadDotEnv } from './client';
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

/** Whether the schema is already in place. */
async function schemaExists(): Promise<boolean> {
  const pool = createPool(databaseUrl());
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

  if (!(await schemaExists())) {
    console.log('test:db: schema missing — applying migrations');
    const pool = createPool(databaseUrl());
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
