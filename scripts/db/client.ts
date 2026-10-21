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
