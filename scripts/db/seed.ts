/**
 * The seed runner.
 *
 * Applies `supabase/seed.sql` to the development database. The seed is
 * re-runnable: it deletes the fixture by id and re-inserts it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createPool, devDatabaseUrl, loadDotEnv } from './client';
import { PROJECT_ROOT } from './paths';

export const SEED_FILE = join(PROJECT_ROOT, 'supabase', 'seed.sql');

export async function seed(connectionString = devDatabaseUrl()): Promise<void> {
  const pool = createPool(connectionString);

  try {
    const sql = readFileSync(SEED_FILE, 'utf8');
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  await seed();
  console.log('seed: applied supabase/seed.sql');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
