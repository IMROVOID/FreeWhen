/**
 * Regression tests for the security review findings.
 *
 * ★ EVERY TEST IN THIS FILE IS A REGRESSION TEST FOR A FINDING THAT WAS
 * EXPLOITED AND THEN FIXED.
 *
 * Each one reproduces the attack as it was performed, and asserts that the
 * database now refuses it. They live in their own file, rather than being
 * folded into the general suites, because the point of them is not the
 * behaviour — it is the RECORD that the behaviour was once wrong.
 *
 * The attacks were run against a live instance and reproduced before the
 * fix; the "before" state is recorded in each test's comment.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  addMember,
  asOwner,
  closePool,
  closeSession,
  createUser,
  id,
  openAnonymousSession,
  openSession,
  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
  type Session,
} from './support';

async function withSession<T>(
  userId: string,
  options: { isAnonymous?: boolean; role?: 'anon' | 'authenticated' } = {},
  body: (session: Session) => Promise<T>,
): Promise<T> {
  const session = await openSession(userId, options);
  try {
    return await body(session);
  } finally {
    await closeSession(session);
  }
}

describe('security regressions', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // CRITICAL 1 — self-promotion to organizer
  // ───────────────────────────────────────────────────────────
  describe('a member cannot promote themselves to organizer', () => {
    // BEFORE THE FIX:
    //   update participant set role = 'organizer' where auth_user_id = auth.uid();
    //   → UPDATE 1
    //   insert into decision (...) → INSERT 0 1
    //
    // The RLS row predicate said "you may update YOUR row" and nothing
    // about WHICH COLUMNS, and the table-level `grant update` covered
    // every column including `role`. The whole organizer-only confirm
    // control was bypassable with one statement.
    test('the role column cannot be updated by its owner', async () => {
      // Arrange
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId, { displayName: 'Member' });

      // Act & Assert
      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () => session.query(`update participant set role = 'organizer'`),
          /permission denied|row-level security|violates/i,
        );
      });
    });

    test('the promotion is refused even when it names the caller explicitly', async () => {
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId, { displayName: 'Member' });

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `update participant set role = 'organizer' where auth_user_id = auth.uid()`,
            ),
          /permission denied|row-level security|violates/i,
        );

        // And the role is unchanged.
        const rows = await asOwner<{ role: string }>(
          `select role from participant where auth_user_id = $1`,
          [userId],
        );
        assert.equal(rows.rows[0]?.role, 'member');
      });
    });

    test('the member still cannot confirm a decision', async () => {
      // The end-to-end consequence: even WITH the role column locked, the
      // member's insert is refused. Both layers are asserted.
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
               values ($1, 'place', $2, 'balanced_floor', $3)`,
              [eventId, proposalId, participantId],
            ),
          /row-level security|violates|does not belong/i,
        );
      });
    });

    test('a participant CAN still update the columns they own', async () => {
      // The fix must not break the feature: a participant updates their
      // own name, visibility, modes and travel tolerance.
      const { eventId } = await seedEvent();
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `update participant
             set display_name = 'New name',
                 visibility = 'private',
                 max_travel_minutes = 90
           where id = $1`,
          [participantId],
        );
        assert.equal(result.rowCount, 1);
      });

      const rows = await asOwner<{ display_name: string; visibility: string; max_travel_minutes: number }>(
        `select display_name, visibility, max_travel_minutes from participant where id = $1`,
        [participantId],
      );
      assert.equal(rows.rows[0]?.display_name, 'New name');
      assert.equal(rows.rows[0]?.visibility, 'private');
      assert.equal(rows.rows[0]?.max_travel_minutes, 90);
    });

    test('a participant cannot change their own event_id or auth_user_id', async () => {
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId);
      const other = await seedEvent({ title: 'Other' });

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () => session.query(`update participant set event_id = $1`, [other.eventId]),
          /permission denied|row-level security|violates/i,
        );

        await assert.rejects(
          () => session.query(`update participant set auth_user_id = $1`, [id()]),
          /permission denied|row-level security|violates/i,
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // CRITICAL 2 — forging an organizer participant row
  // ───────────────────────────────────────────────────────────
  describe('a member cannot forge an organizer participant row', () => {
    // BEFORE THE FIX:
    //   insert into participant (event_id, auth_user_id, role)
    //   values (<event>, <someone else's user id>, 'organizer');
    //   → INSERT 0 1
    //
    // The insert policy checked only that the caller was a participant of
    // the event. It did not check that the new row was ABOUT the caller.
    // One statement put a real user id into the organizer role.
    test('a member cannot insert a participant row for another user', async () => {
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId, { displayName: 'Member' });
      const victimId = await createUser();

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into participant (id, event_id, auth_user_id, display_name, role)
               values ($1, $2, $3, 'Fake organizer', 'organizer')`,
              [id(), eventId, victimId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('a member cannot insert a participant row with the organizer role', async () => {
      // Even for THEMSELVES: the role is the server's to assign.
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId, { displayName: 'Member' });

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into participant (id, event_id, auth_user_id, display_name, role)
               values ($1, $2, $3, 'Self promoter', 'organizer')`,
              [id(), eventId, userId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('the forged row was not created', async () => {
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId);
      const victimId = await createUser();

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into participant (id, event_id, auth_user_id, display_name, role)
               values ($1, $2, $3, 'Fake', 'organizer')`,
              [id(), eventId, victimId],
            ),
          /row-level security|violates/i,
        );
      });

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant where auth_user_id = $1`,
        [victimId],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // HIGH — the definer functions and temp-table shadowing
  // ───────────────────────────────────────────────────────────
  describe('a temp table cannot shadow a definer function’s tables', () => {
    // BEFORE THE FIX:
    //   create temp table participant (id uuid, event_id uuid, auth_user_id uuid);
    //   insert into participant values (..., '<foreign event>', auth.uid());
    //   select is_event_participant('<foreign event>');  → t
    //
    // `set search_path = public` alone was not enough: `pg_temp` is
    // searched BEFORE `public`, and the definer body is re-parsed on every
    // call (unlike a policy expression, which is bound at CREATE time).
    test('a forged temp participant table is not consulted', async () => {
      const { organizerId } = await seedEvent();
      const foreignEventId = id();

      await withSession(organizerId, {}, async (session) => {
        await session.query(
          `create temp table participant (id uuid, event_id uuid, auth_user_id uuid)`,
        );
        await session.query(
          `insert into participant values (gen_random_uuid(), $1, auth.uid())`,
          [foreignEventId],
        );

        // The forged row claims membership of an event the caller is not in.
        const result = await session.query<{ is_event_participant: boolean }>(
          `select is_event_participant($1) as is_event_participant`,
          [foreignEventId],
        );
        assert.equal(result.rows[0]?.is_event_participant, false);

        // ★ The temp table is DROPPED, because it shadows the real one for
        // the rest of the connection. Leaving it would make every later
        // query in this session fail with "column display_name of relation
        // participant does not exist" — a test artefact, not a finding.
        await session.query(`drop table participant`);
      });
    });

    test('a forged temp event table cannot make an expired invite redeem', async () => {
      // BEFORE THE FIX, a forged `event` temp table would let an expired
      // token redeem successfully — breaking FR-8.33 in the direction that
      // leaks whether an event exists.
      const { eventId, organizerId } = await seedEvent();

      await withSession(organizerId, {}, async (session) => {
        await session.query(
          `create temp table event (
             id uuid, title text, status text, invite_token_hash text,
             invite_expires_at timestamptz, date_window_start timestamptz,
             date_window_end timestamptz, home_tz text, description text,
             activity_type text, voting_deadline timestamptz, created_by uuid,
             created_at timestamptz, updated_at timestamptz
           )`,
        );
        await session.query(
          `insert into event values (
             $1, 'Forged', 'OPEN', 'a-forged-hash', now() + interval '1 day',
             now(), now() + interval '1 day', 'Asia/Tehran', null, 'dinner',
             null, null, now(), now()
           )`,
          [eventId],
        );

        const result = await session.query<{ result: { error?: string } }>(
          `select redeem_invite($1) as result`,
          ['a-forged-hash'],
        );
        // The real table has no such hash, so the token is invalid.
        assert.equal(result.rows[0]?.result.error, 'INVITE_INVALID');

        // ★ The temp table is DROPPED — it shadows the real `event` for the
        // rest of the connection.
        await session.query(`drop table event`);
      });
    });

    test('every definer function lists pg_temp last in its search_path', async () => {
      const rows = await asOwner<{ proname: string; proconfig: string[] | null }>(
        `select proname, proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      );

      assert.ok(rows.rows.length > 0);

      for (const row of rows.rows) {
        const config = row.proconfig?.join(',') ?? '';
        const parts = config
          .replace('search_path=', '')
          .split(',')
          .map((part) => part.trim());

        assert.equal(
          parts[parts.length - 1],
          'pg_temp',
          `${row.proname} must list pg_temp last`,
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // HIGH — auth.users must not be client-readable
  // ───────────────────────────────────────────────────────────
  describe('the user table is not readable by a client', () => {
    // BEFORE THE FIX:
    //   set role anon; select id, email, phone from auth.users;
    //   → every user, with the publishable key.
    //
    // The stated reason for the grant ("the foreign keys need it") was
    // false: PostgreSQL checks foreign keys as the table owner.
    test('the anon role cannot read auth.users', async () => {
      const session = await openAnonymousSession();
      try {
        await assert.rejects(
          () => session.query(`select id, email, phone from auth.users`),
          /permission denied/i,
        );
      } finally {
        await closeSession(session);
      }
    });

    test('an authenticated user cannot read auth.users', async () => {
      const userId = await createUser();

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () => session.query(`select id, email, phone from auth.users`),
          /permission denied/i,
        );
      });
    });

    test('the server still can', async () => {
      // The service role is how the cleanup job and the token service read
      // the table. Locking it down must not break the server.
      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users`,
      );
      assert.ok((rows.rows[0]?.n ?? 0) >= 0);
    });

    test('an insert with a foreign key to auth.users still works', async () => {
      // The reason the grant existed was false, so this proves the point:
      // the FK check does not need SELECT on the referenced table.
      const userId = await createUser();
      const { eventId } = await seedEvent();

      await asOwner(
        `insert into participant (id, event_id, auth_user_id, display_name)
         values ($1, $2, $3, 'FK works')`,
        [id(), eventId, userId],
      );

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant where auth_user_id = $1`,
        [userId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });
  });

  // ───────────────────────────────────────────────────────────
  // HIGH — the service role must be able to reach the schema
  // ───────────────────────────────────────────────────────────
  describe('the server can reach the schema', () => {
    // BEFORE THE FIX:
    //   set role service_role; select run_retention_job();
    //   → ERROR: permission denied for schema public
    //
    // Both cleanup jobs were dead code, and the failure was silent because
    // nothing called them.
    test('the service role can run the retention job', async () => {
      const rows = await asOwner<{ has_execute: boolean }>(
        `select has_function_privilege('service_role', 'run_retention_job()', 'execute') as has_execute`,
      );
      assert.equal(rows.rows[0]?.has_execute, true);
    });

    test('the service role can write the shared travel cache', async () => {
      const rows = await asOwner<{ has_insert: boolean }>(
        `select has_table_privilege('service_role', 'travel_measurement', 'INSERT') as has_insert`,
      );
      assert.equal(rows.rows[0]?.has_insert, true);
    });

    test('the service role can write the activity log', async () => {
      const rows = await asOwner<{ has_insert: boolean }>(
        `select has_table_privilege('service_role', 'activity_log', 'INSERT') as has_insert`,
      );
      assert.equal(rows.rows[0]?.has_insert, true);
    });
  });

  // ───────────────────────────────────────────────────────────
  // MEDIUM — the participant cap
  // ───────────────────────────────────────────────────────────
  describe('the participant cap is enforced by the database', () => {
    // BEFORE THE FIX: the cap was a `count(*)` inside the RPC, which is a
    // read-then-write. A client could also insert participant rows
    // directly, bypassing it entirely.
    test('an eleventh participant is refused', async () => {
      const { eventId } = await seedEvent();

      // Nine more members: ten in total.
      for (let i = 0; i < 9; i += 1) {
        const userId = await createUser();
        await asOwner(
          `insert into participant (id, event_id, auth_user_id, display_name)
           values ($1, $2, $3, $4)`,
          [id(), eventId, userId, `Guest ${i}`],
        );
      }

      // The eleventh is refused.
      const eleventhUserId = await createUser();
      await assert.rejects(
        () =>
          asOwner(
            `insert into participant (id, event_id, auth_user_id, display_name)
             values ($1, $2, $3, 'One too many')`,
            [id(), eventId, eleventhUserId],
          ),
        /EVENT_FULL|check_violation|violates/i,
      );

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 10);
    });

    test('a participant with a NULL auth_user_id does not escape the cap', async () => {
      // `unique (event_id, auth_user_id)` does not constrain NULLs, so a
      // client could previously insert unlimited pre-join rows.
      const { eventId } = await seedEvent();

      for (let i = 0; i < 9; i += 1) {
        await asOwner(
          `insert into participant (id, event_id, auth_user_id, display_name)
           values ($1, $2, $3, $4)`,
          [id(), eventId, null, `Pre-join ${i}`],
        );
      }

      await assert.rejects(
        () =>
          asOwner(
            `insert into participant (id, event_id, auth_user_id, display_name)
             values ($1, $2, null, 'One too many')`,
            [id(), eventId],
          ),
        /EVENT_FULL|check_violation|violates/i,
      );
    });

    test('ten participants are allowed', async () => {
      const { eventId } = await seedEvent();

      for (let i = 0; i < 9; i += 1) {
        const userId = await createUser();
        await asOwner(
          `insert into participant (id, event_id, auth_user_id, display_name)
           values ($1, $2, $3, $4)`,
          [id(), eventId, userId, `Guest ${i}`],
        );
      }

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 10);
    });
  });

  // ───────────────────────────────────────────────────────────
  // MEDIUM — the decision's cross-event integrity
  // ───────────────────────────────────────────────────────────
  describe('a decision may not reference another event', () => {
    test('a proposal from another event is refused', async () => {
      // BEFORE THE FIX: a decision in event A accepted a proposal id from
      // event B.
      const first = await seedEvent({ title: 'First' });
      const venueId = await seedVenue(first.eventId);
      const proposalId = await seedProposal(first.eventId, first.organizerParticipantId, {
        venueId,
      });

      const second = await seedEvent({ title: 'Second' });

      await assert.rejects(
        () =>
          asOwner(
            `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
             values ($1, 'place', $2, 'balanced_floor', $3)`,
            [second.eventId, proposalId, second.organizerParticipantId],
          ),
        /does not belong|violates/i,
      );
    });

    test('a confirmer from another event is refused', async () => {
      const first = await seedEvent({ title: 'First' });
      const venueId = await seedVenue(first.eventId);
      const proposalId = await seedProposal(first.eventId, first.organizerParticipantId, {
        venueId,
      });

      const second = await seedEvent({ title: 'Second' });

      await assert.rejects(
        () =>
          asOwner(
            `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
             values ($1, 'place', $2, 'balanced_floor', $3)`,
            [first.eventId, proposalId, second.organizerParticipantId],
          ),
        /does not belong|violates/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // MEDIUM — leaving an event
  // ───────────────────────────────────────────────────────────
  describe('a participant can leave an event', () => {
    // BEFORE THE FIX: there was no DELETE policy on `participant`, so
    // `delete from participant where auth_user_id = auth.uid()` deleted
    // ZERO rows. FR-8.22 was unreachable.
    test('a participant can delete their own participant row', async () => {
      const { eventId } = await seedEvent();
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(`delete from participant where id = $1`, [
          participantId,
        ]);
        assert.equal(result.rowCount, 1);
      });
    });

    test('a participant cannot delete ANOTHER participant row', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const { userId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(`delete from participant where id = $1`, [
          organizerParticipantId,
        ]);
        assert.equal(result.rowCount, 0);
      });
    });

    test('an organizer who confirmed a decision can still leave', async () => {
      // `decision.confirmed_by` is ON DELETE SET NULL, so the leave is not
      // blocked by the foreign key. The decision history survives.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalId, organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query(`delete from participant where id = $1`, [
          organizerParticipantId,
        ]);
        assert.equal(result.rowCount, 1);
      });

      // The decision survives, with the attribution cleared.
      const rows = await asOwner<{ confirmed_by: string | null }>(
        `select confirmed_by from decision where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.confirmed_by, null);
    });
  });

  // ───────────────────────────────────────────────────────────
  // MEDIUM — the private visibility setting
  // ───────────────────────────────────────────────────────────
  describe('a private participant’s location is not readable by others', () => {
    // BEFORE THE FIX: the start_point SELECT policy ignored
    // `participant.visibility`, so a "private" participant's coordinates
    // were still readable by every member. The setting was a promise the
    // database did not keep.
    test('a member with visibility=private has their coordinates hidden', async () => {
      const { eventId, organizerId } = await seedEvent();
      const { participantId } = await addMember(eventId, {
        displayName: 'Private person',
      });

      await asOwner(
        `update participant set visibility = 'private' where id = $1`,
        [participantId],
      );

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [participantId],
      );

      // The organizer is a member of the same event.
      await withSession(organizerId, {}, async (session) => {
        const result = await session.query(
          `select * from start_point where participant_id = $1`,
          [participantId],
        );
        assert.equal(result.rows.length, 0);
      });
    });

    test('a participant with visibility=event has their coordinates visible', async () => {
      const { eventId, organizerId } = await seedEvent();
      const { participantId } = await addMember(eventId, { displayName: 'Open person' });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [participantId],
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query(
          `select * from start_point where participant_id = $1`,
          [participantId],
        );
        assert.equal(result.rows.length, 1);
      });
    });

    test('a private participant can still write their own start point', async () => {
      // The setting hides the location from OTHERS. It must not stop the
      // participant from recording it — the engine uses the real
      // coordinate regardless of visibility (PRD-09 §12).
      const { eventId } = await seedEvent();
      const { userId, participantId } = await addMember(eventId);

      await asOwner(
        `update participant set visibility = 'private' where id = $1`,
        [participantId],
      );

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
           values ($1, 35.70, 51.40, 'gps_coarse')`,
          [participantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });
  });
});
