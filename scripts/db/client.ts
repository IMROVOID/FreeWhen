/**
 * The database connection.
 *
 * One place that knows how to reach Postgres, so the migration runner, the
 * seed and the test suites all talk to the same database with the same
 * credentials.
 *
 * The connection string is read from the environment and is never written
 * down: `gate:secrets` scans this file, and a default password here would
 * be a credential in the source tree.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';

import { PROJECT_ROOT } from './paths';
export const DEFAULT_DATABASE_URL =
  'postgres://postgres:postgres@127.0.0.1:5433/freewhen';

/**
 * The connection string for the test database.
 *
 * `TEST_DATABASE_URL` wins, so a CI runner can point the suite at its own
 * database without touching the developer's.
 */
export function databaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * The connection string for the development database.
 *
 * `DATABASE_URL` is the documented variable (PRD-10 §8); the local default
 * matches the container the repo's DB scripts start.
 */
export function devDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * The database name for THIS agent, derived from the branch.
 *
 * ★ Why this exists.
 *
 * The `test:db` suites share one Postgres instance. They already run one
 * file at a time (`--test-concurrency=1`) because of that, but that only
 * serialises files WITHIN one runner. Two agents running `npm run test:db`
 * at the same time — which is what "run these two plans in parallel" means
 * — would interleave their inserts and each one's row counts would fail the
 * other's assertions.
 *
 * Giving each agent its own database is the fix. The name is derived from
 * the branch, so it is stable across runs, and it is derived rather than
 * configured so an agent cannot forget to configure it.
 *
 * The name is sanitised to `[a-z0-9_]` and truncated, because it goes into
 * a connection string and Postgres identifiers have a 63-byte limit.
 */
export function agentDatabaseName(): string | null {
  const branch = process.env.FREEWHEN_PHASE
    ? `p${process.env.FREEWHEN_PHASE.replace(/[^0-9A-Za-z]/g, '')}`
    : currentBranchSuffix();

  if (!branch) return null;

  const suffix = branch.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
  return `freewhen_${suffix}`;
}

/** The `feat/NN-name` suffix of the current branch, if this is a git checkout. */
function currentBranchSuffix(): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
    const match = /^feat\/(.+)$/.exec(branch);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

/**
 * The test database URL, isolated per agent when one is in play.
 *
 * An explicit `TEST_DATABASE_URL` always wins — a CI runner, and a developer
 * who wants a specific database, both set it deliberately. Only when it is
 * absent AND the checkout is on a `feat/` branch does the per-agent database
 * kick in, so a solo agent on `main` keeps the shared default.
 */
export function isolatedTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const name = agentDatabaseName();
  if (!name) return databaseUrl();

  const base = databaseUrl();
  try {
    const url = new URL(base);
    url.pathname = `/${name}`;
    return url.toString();
  } catch {
    return base;
  }
}

/**
 * Loads `.env` into `process.env` without overwriting anything already set.
 *
 * A hand-rolled parser rather than a dependency: the file has one shape
 * (`KEY=value`, optionally quoted) and the alternative is a package for
 * thirty lines.
 */
export function loadDotEnv(file = join(PROJECT_ROOT, '.env')): void {
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

export function createPool(connectionString = databaseUrl()): Pool {
  return new Pool({ connectionString, max: 10 });
}
