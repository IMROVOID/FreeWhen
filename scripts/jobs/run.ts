/**
 * The scheduled-job runner (Plan 09 Task 5 / Task 6).
 *
 * `npm run job:retention` and `npm run job:anon-cleanup` call this. It exists so
 * the two jobs have one entry point with one exit convention: a job that fails
 * must exit non-zero, because a cron that reports success while doing nothing is
 * how location data silently outlives its purpose.
 *
 * On Supabase both are also registered with pg_cron in
 * `migrations/014_jobs.sql`. This runner is the path for any host without
 * pg_cron — a plain Postgres, a container, a systemd timer — and the manual
 * invocation an operator uses to verify the sweep actually deletes rows.
 */

import { loadDotEnv } from '../db/client';
import { runAnonCleanupJob } from '../../server/jobs/anon-cleanup';
import { runRetentionJob } from '../../server/jobs/retention';
import { closeServicePool } from '../../server/lib/supabase';
import type { JobResult } from '../../server/jobs/retention';

const JOBS: Record<string, () => Promise<JobResult>> = {
  retention: runRetentionJob,
  'anon-cleanup': runAnonCleanupJob,
};

async function main(): Promise<void> {
  loadDotEnv();

  const name = process.argv[2];
  const job = name ? JOBS[name] : undefined;

  if (!job) {
    console.error(`job:run: unknown job "${name ?? ''}" — expected one of ${Object.keys(JOBS).join(', ')}`);
    process.exit(2);
  }

  try {
    const result = await job();
    console.log(`job:${result.job}: ${result.rowsAffected} row(s) affected at ${result.ranAt}`);
  } finally {
    await closeServicePool();
  }
}

main().catch((error: unknown) => {
  console.error(`job:run: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
