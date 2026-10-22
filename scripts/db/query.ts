/**
 * The ad-hoc query runner.
 *
 * `npm run db:query -- "select count(*) from auth.users"` runs one read-only
 * statement against the development database and prints the rows.
 *
 * P12's smoke tests assert database state between two HTTP requests — the
 * anonymous-user count before and after a demo read, and the funnel counts in
 * `analytics_event`. They need a one-line way to read a number out of
 * Postgres without opening a client or writing a script per assertion.
 *
 * Only `select` and `with` are accepted: this is a probe, not a console, and
 * a smoke test that can `delete` is a smoke test that will eventually do it.
 */

import { pathToFileURL } from 'node:url';

import { createPool, devDatabaseUrl, loadDotEnv } from './client';

const READS = /^\s*(select|with)\b/i;

export async function query(
  sql: string,
  connectionString = devDatabaseUrl(),
): Promise<Record<string, unknown>[]> {
  if (!READS.test(sql)) {
    throw new Error('db:query accepts read-only statements (select / with)');
  }

  const pool = createPool(connectionString);

  try {
    const result = await pool.query(sql);
    return result.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const sql = process.argv.slice(2).join(' ').trim();
  if (!sql) {
    console.error('usage: npm run db:query -- "<select ...>"');
    process.exit(2);
  }

  loadDotEnv();
  const rows = await query(sql);

  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }

  const columns = Object.keys(rows[0]!);
  console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column])).join('\t'));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
