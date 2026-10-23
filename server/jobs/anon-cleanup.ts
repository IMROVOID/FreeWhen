/**
 * The anonymous-user cleanup job (Plan 09 Task 6, FR-8.24, PRD-10 D3).
 *
 * ★ NEITHER BACKEND PROVIDES AUTOMATIC CLEANUP OF ANONYMOUS USERS.
 *
 * Supabase ships no job for it and plain Postgres has no notion of an account.
 * Without this sweep the database grows forever, and an abandoned guest's
 * location data outlives the purpose it was collected for — which is the one
 * outcome FR-8.24 exists to prevent.
 *
 * The work is `run_anon_cleanup_job()` in `migrations/014_jobs.sql`. This module
 * is the scheduler entry point around it.
 *
 * ★ DELETING THE AUTH USER MUST CASCADE THE PARTICIPANT AND ITS START POINT.
 *
 * That cascade is a schema property (`participant.auth_user_id` and
 * `start_point.participant_id` are both `on delete cascade`), and it is
 * asserted rather than assumed in `tests/db/jobs.test.ts`. A user who still
 * owns a live event is exempt, because `event.created_by` cascades too and the
 * whole event would go with them.
 */

import { scopedQueryable } from '../lib/supabase';
import { logSafe } from '../../src/lib/redact';
import type { JobResult } from './retention';

/**
 * The cutoff the SQL uses, restated only for the log line.
 *
 * ○ Informational, not authoritative. `run_anon_cleanup_job()` decides what to
 * delete; this constant must never be used to build a second, competing
 * predicate in TypeScript.
 */
export const ANON_RETENTION_DAYS = 30;

/** Runs the anonymous-account sweep. */
export async function runAnonCleanupJob(): Promise<JobResult> {
  const result = await scopedQueryable().query<{ run_anon_cleanup_job: number }>(
    `select run_anon_cleanup_job() as run_anon_cleanup_job`,
  );

  const rowsAffected = result.rows[0]?.run_anon_cleanup_job ?? 0;

  logSafe('anon_cleanup_job_ran', {
    job: 'anon_cleanup',
    rowsAffected,
    retentionDays: ANON_RETENTION_DAYS,
  });

  return { job: 'anon_cleanup', rowsAffected, ranAt: new Date().toISOString() };
}
