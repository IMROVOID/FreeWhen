/**
 * The retention job (Plan 09 Task 5, FR-8.19 / FR-8.24).
 *
 * ★ COORDINATES STOP EXISTING WHEN THEY ARE NO LONGER NECESSARY.
 *
 * The work itself is `run_retention_job()` in `migrations/014_jobs.sql` — a
 * `security definer` SQL function, revoked from every client role, so a
 * participant cannot trigger the sweep and the sweep cannot be half-written in
 * two places. This module is the scheduler entry point and the operator-facing
 * wrapper around it: one place where the job is invoked, logged and reported.
 *
 * ★ IT RUNS AT EVENT END, NOT AT CONFIRMATION (OQ-8.2).
 *
 * Deleting at confirmation would break the leave-now reminder, which needs the
 * travel estimate on the day of the event. The SQL enforces the window
 * (`date_window_end < now() - interval '1 hour'`); this file must not restate
 * it in TypeScript, because two copies of a time window drift.
 *
 * ★ THE VENUE AND THE DECISION HISTORY SURVIVE (AC-8.5.1).
 *
 * Only `start_point` rows go. What was decided is the record the group keeps.
 */

import { scopedQueryable } from '../lib/supabase';
import { logSafe } from '../../src/lib/redact';

export interface JobResult {
  readonly job: string;
  /** Rows the job removed. Zero is a normal, healthy outcome. */
  readonly rowsAffected: number;
  readonly ranAt: string;
}

/**
 * Runs the retention sweep.
 *
 * The row count comes back from the function itself, which reads it from
 * `GET DIAGNOSTICS` — so the number is what the database deleted, not what the
 * process hoped it deleted.
 */
export async function runRetentionJob(): Promise<JobResult> {
  const result = await scopedQueryable().query<{ run_retention_job: number }>(
    `select run_retention_job() as run_retention_job`,
  );

  const rowsAffected = result.rows[0]?.run_retention_job ?? 0;

  // The job name and a count only. There is nothing else about the deleted
  // rows that may be logged: which person lost which coordinate is exactly the
  // disclosure the job exists to prevent.
  logSafe('retention_job_ran', { job: 'retention', rowsAffected });

  return { job: 'retention', rowsAffected, ranAt: new Date().toISOString() };
}
