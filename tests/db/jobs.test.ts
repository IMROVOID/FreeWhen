/**
 * The two scheduled jobs.
 *
 * ★ NEITHER BACKEND PROVIDES AUTOMATIC CLEANUP OF ANONYMOUS USERS.
 * Without the cleanup job the database grows forever, and abandoned
 * location data outlives its purpose (PRD-08 FR-8.24).
 *
 * ★ The retention job runs AT EVENT END, NOT AT CONFIRMATION (OQ-8.2).
 * Deleting at confirmation would break the leave-now reminder, which needs
 * the travel estimate on the day.
 *
 * Both jobs are verified BEHAVIOURALLY here — the right rows are deleted and
 * the wrong rows survive — not merely by the existence of the functions.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {

  asOwner,
  closePool,
  createUser,
  id,
  seedEvent,
  truncateAll,
} from './support';

describe('the scheduled jobs', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // The retention job
  // ───────────────────────────────────────────────────────────
  describe('the retention job', () => {
    test('deletes the coordinates of an event that has ended', async () => {
      // Arrange — an event whose window closed two days ago
      const { organizerParticipantId } = await seedEvent({
        title: 'A past event',
        windowStart: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        windowEnd: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      // Act
      const result = await asOwner<{ run_retention_job: number }>(
        `select run_retention_job() as run_retention_job`,
      );

      // Assert
      assert.equal(result.rows[0]?.run_retention_job, 1);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });

    test('leaves the coordinates of a live event alone', async () => {
      // The event is still running, so its location is still needed.
      const { organizerParticipantId } = await seedEvent({ title: 'A live event' });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.71, 51.41, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await asOwner(`select run_retention_job()`);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });

    test('keeps the event, its participants and its decisions', async () => {
      // Only the COORDINATES go. The venue and the decision history remain
      // (AC-8.5.1) — a finished event's location is no longer necessary, but
      // what was decided is.
      const { eventId, organizerParticipantId } = await seedEvent({
        title: 'A decided past event',
        windowStart: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        windowEnd: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        status: 'CONFIRMED',
      });

      const venueId = id();
      await asOwner(
        `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'Kept', 35.7, 51.4)`,
        [venueId, eventId],
      );

      const proposalId = id();
      await asOwner(
        `insert into proposal (id, event_id, created_by, type, title, venue_id)
         values ($1, $2, $3, 'PLACE', 'Kept', $4)`,
        [proposalId, eventId, organizerParticipantId, venueId],
      );

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalId, organizerParticipantId],
      );

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.72, 51.42, 'gps_coarse')`,
        [organizerParticipantId],
      );

      // Act
      await asOwner(`select run_retention_job()`);

      // Assert — the coordinates went, the rest stayed.
      const points = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(points.rows[0]?.n, 0);

      const kept = await asOwner<{ venues: number; decisions: number; participants: number }>(`
        select
          (select count(*)::int from venue where id = $1) as venues,
          (select count(*)::int from decision where event_id = $2) as decisions,
          (select count(*)::int from participant where id = $3) as participants
      `, [venueId, eventId, organizerParticipantId]);
      assert.equal(kept.rows[0]?.venues, 1);
      assert.equal(kept.rows[0]?.decisions, 1);
      assert.equal(kept.rows[0]?.participants, 1);
    });

    test('it records what it deleted', async () => {
      await asOwner(`select run_retention_job()`);

      const rows = await asOwner<{ job_name: string; rows_affected: number }>(
        `select job_name, rows_affected from job_log order by id desc limit 1`,
      );
      assert.equal(rows.rows[0]?.job_name, 'retention');
    });
  });

  // ───────────────────────────────────────────────────────────
  // The anonymous-user cleanup job
  // ───────────────────────────────────────────────────────────
  describe('the anonymous-user cleanup job', () => {
    test('deletes an anonymous user older than 30 days', async () => {
      // Arrange
      const oldUserId = await createUser();
      await asOwner(`update auth.users set created_at = now() - interval '31 days' where id = $1`, [
        oldUserId,
      ]);

      // Act
      const result = await asOwner<{ run_anon_cleanup_job: number }>(
        `select run_anon_cleanup_job() as run_anon_cleanup_job`,
      );

      // Assert
      assert.equal(result.rows[0]?.run_anon_cleanup_job, 1);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users where id = $1`,
        [oldUserId],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });

    test('keeps a 29-day-old anonymous user', async () => {
      // The 30-day window is the documented boundary, and the test asserts
      // both sides of it — a job that deleted everything would also pass a
      // test that only checked the deletion.
      const userId = await createUser();
      await asOwner(`update auth.users set created_at = now() - interval '29 days' where id = $1`, [
        userId,
      ]);

      await asOwner(`select run_anon_cleanup_job()`);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users where id = $1`,
        [userId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });

    test('keeps a non-anonymous user of any age', async () => {
      // An account is not an abandoned guest, whatever its age.
      const userId = await createUser({ isAnonymous: false });
      await asOwner(`update auth.users set created_at = now() - interval '400 days' where id = $1`, [
        userId,
      ]);

      await asOwner(`select run_anon_cleanup_job()`);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users where id = $1`,
        [userId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });

    test('deleting an old anonymous user takes their location with it', async () => {
      // The privacy consequence: an abandoned guest's coordinates go with
      // their account.
      //
      // The event window has ENDED, so the organizer is not exempt (the
      // exemption is for users who still own a LIVE event).
      const { organizerId, organizerParticipantId } = await seedEvent({
        windowStart: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        windowEnd: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.73, 51.43, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await asOwner(`update auth.users set created_at = now() - interval '40 days' where id = $1`, [
        organizerId,
      ]);

      await asOwner(`select run_anon_cleanup_job()`);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });

    test('an old anonymous user who still owns a LIVE event is kept', async () => {
      // ★ `event.created_by` is ON DELETE CASCADE, so deleting an anonymous
      // organizer takes the event, its participants, its proposals, its votes
      // and its start points with it. A 30-day-old account that is still
      // running a future event would otherwise lose the whole event.
      const { eventId, organizerId, organizerParticipantId } = await seedEvent({
        title: 'A live event',
      });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.74, 51.44, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await asOwner(`update auth.users set created_at = now() - interval '40 days' where id = $1`, [
        organizerId,
      ]);

      // Act
      await asOwner(`select run_anon_cleanup_job()`);

      // Assert — the user AND the whole event survive.
      const user = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users where id = $1`,
        [organizerId],
      );
      assert.equal(user.rows[0]?.n, 1);

      const event = await asOwner<{ n: number }>(
        `select count(*)::int as n from event where id = $1`,
        [eventId],
      );
      assert.equal(event.rows[0]?.n, 1);

      const points = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(points.rows[0]?.n, 1);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The jobs' own properties
  // ───────────────────────────────────────────────────────────
  describe('the jobs', () => {
    test('both exist and are security definer with a pinned search_path', async () => {
      const rows = await asOwner<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select proname, prosecdef, proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and proname in ('run_retention_job', 'run_anon_cleanup_job')`,
      );

      assert.equal(rows.rows.length, 2);
      for (const row of rows.rows) {
        assert.equal(row.prosecdef, true);

        const config = row.proconfig?.join(',') ?? '';
        assert.match(config, /search_path=/);

        const parts = config
          .replace('search_path=', '')
          .split(',')
          .map((part) => part.trim());
        assert.equal(parts[parts.length - 1], 'pg_temp', 'pg_temp must be listed last');
      }
    });

    test('neither is executable by a client role', async () => {
      // A client must not be able to run the retention sweep at will.
      const rows = await asOwner<{ proname: string; has_auth: boolean; has_anon: boolean }>(
        `select p.proname,
                has_function_privilege('authenticated', p.oid, 'execute') as has_auth,
                has_function_privilege('anon', p.oid, 'execute') as has_anon
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('run_retention_job', 'run_anon_cleanup_job')`,
      );

      for (const row of rows.rows) {
        assert.equal(row.has_auth, false, `${row.proname} must not be executable by authenticated`);
        assert.equal(row.has_anon, false, `${row.proname} must not be executable by anon`);
      }
    });
  });
});
