/**
 * Row-level security.
 *
 * ★ EVERY TEST IN THIS FILE RUNS AS A NON-SUPERUSER.
 *
 * The service role and a superuser both bypass RLS entirely. An RLS test run
 * with either of them passes while every policy is broken, and hides the bug
 * until production (PRD-09 §13.9). The `openSession` helper sets the JWT
 * claims and issues `set role authenticated`, so the policies see a real
 * caller.
 *
 * A denied read returns ZERO ROWS, not an error — that is what makes
 * AC-9.3.1's "zero rows" assertion meaningful rather than a permission
 * error in disguise.
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

/** Opens a session and guarantees it is released. */
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

describe('row-level security', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.3.1 — a non-participant reads nothing
  // ───────────────────────────────────────────────────────────
  describe('a non-participant is denied (AC-9.3.1)', () => {
    test('reading an event as a non-participant returns zero rows', async () => {
      // Arrange
      const { eventId } = await seedEvent();
      const strangerId = await createUser();

      // Act & Assert
      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from event where id = $1', [eventId]);

        // RLS denies: zero rows, not an error.
        assert.equal(result.rows.length, 0);
      });
    });

    test('reading proposals of another event returns zero rows', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from proposal where id = $1', [proposalId]);
        assert.equal(result.rows.length, 0);
      });
    });

    test('reading the participants of another event returns zero rows', async () => {
      const { eventId } = await seedEvent();
      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from participant where event_id = $1', [eventId]);
        assert.equal(result.rows.length, 0);
      });
    });

    test('reading the votes of another event returns zero rows', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from vote');
        assert.equal(result.rows.length, 0);
      });
    });

    test('reading start points of another event returns zero rows', async () => {
      // A location leak is the worst possible outcome here.
      const { organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from start_point');
        assert.equal(result.rows.length, 0);
      });
    });

    test('the anon role with no claims reads nothing', async () => {
      const { eventId } = await seedEvent();
      const session = await openAnonymousSession();

      try {
        const result = await session.query('select * from event where id = $1', [eventId]);
        assert.equal(result.rows.length, 0);
      } finally {
        await closeSession(session);
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // A participant sees their own event
  // ───────────────────────────────────────────────────────────
  describe('a participant is allowed', () => {
    test('a participant reads their own event', async () => {
      const { eventId, organizerId } = await seedEvent();

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from event where id = $1', [eventId]);
        assert.equal(result.rows.length, 1);
      });
    });

    test('a participant reads the other participants of their event', async () => {
      const { eventId, organizerId } = await seedEvent();
      await addMember(eventId, { displayName: 'Bahar' });

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from participant where event_id = $1', [eventId]);
        assert.equal(result.rows.length, 2);
      });
    });

    test('a participant reads the votes of their event', async () => {
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from vote');
        assert.equal(result.rows.length, 1);
      });
    });

    test('a participant reads the start points of their event', async () => {
      const { organizerParticipantId, organizerId } = await seedEvent();

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from start_point');
        assert.equal(result.rows.length, 1);
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Voting only in your own name
  // ───────────────────────────────────────────────────────────
  describe('voting as self', () => {
    test('a participant may not vote in another participant’s name', async () => {
      // Arrange
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { participantId: otherParticipantId } = await addMember(eventId);

      // Act & Assert
      await withSession(organizerId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
              [proposalId, otherParticipantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('a participant may vote in their own name', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'maybe')`,
          [proposalId, participantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.4.1 — only the organizer may confirm
  // ───────────────────────────────────────────────────────────
  describe('confirming a decision (AC-9.4.1)', () => {
    test('a member inserting a decision is rejected', async () => {
      // ★ This is the test that exists because the restrictive policy
      // fails SILENTLY when it is not paired with a permissive one.
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId, { displayName: 'Member' });

      // Act & Assert
      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
               values ($1, 'place', $2, 'balanced_floor', $3)`,
              [eventId, proposalId, participantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('the organizer may confirm', async () => {
      // The permissive organizer policy paired with the restrictive
      // anti-anonymous policy — the pair that AC-9.4.1 exists to verify.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query(
          `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
           values ($1, 'place', $2, 'balanced_floor', $3)`,
          [eventId, proposalId, organizerParticipantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('an ANONYMOUS organizer may confirm', async () => {
      // The MVP organizer has no account (PRD-01 AS1.1), so the organizer
      // is an anonymous user. A policy that refused anonymous organizers
      // would make MVP step 10 unreachable.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await withSession(organizerId, { isAnonymous: true }, async (session) => {
        const result = await session.query(
          `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
           values ($1, 'place', $2, 'balanced_floor', $3)`,
          [eventId, proposalId, organizerParticipantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('an anonymous NON-organizer is still rejected', async () => {
      // The pair of policies ANDs to exactly one outcome: the organizer of
      // that event, and nobody else — anonymous or not.
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, { isAnonymous: true }, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
               values ($1, 'place', $2, 'balanced_floor', $3)`,
              [eventId, proposalId, participantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('an organizer of a DIFFERENT event may not confirm this one', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      const other = await seedEvent({ title: 'Other event' });

      await withSession(other.organizerId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
               values ($1, 'place', $2, 'balanced_floor', $3)`,
              [eventId, proposalId, other.organizerParticipantId],
            ),
          // The rejection may come from the RLS policy (not this event's
          // organizer) or from the cross-event integrity trigger (the
          // confirmer is not in this event). Either is a rejection; the
          // point is that the row is not created.
          /row-level security|violates|does not belong/i,
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Proposals
  // ───────────────────────────────────────────────────────────
  describe('proposals', () => {
    test('a participant may create a proposal in their own event', async () => {
      const { eventId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `insert into proposal (id, event_id, created_by, type, title, venue_id)
           values ($1, $2, $3, 'PLACE', 'A place', $4)`,
          [id(), eventId, participantId, venueId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('a participant may not create a proposal in another event', async () => {
      const { eventId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const { userId, participantId } = await addMember(eventId);
      const other = await seedEvent({ title: 'Other event' });

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into proposal (id, event_id, created_by, type, title, venue_id)
               values ($1, $2, $3, 'PLACE', 'A place', $4)`,
              [id(), other.eventId, participantId, venueId],
            ),
          /row-level security|violates/i,
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // Start points: only the owner writes
  // ───────────────────────────────────────────────────────────
  describe('start points', () => {
    test('a participant may write their own start point', async () => {
      const { eventId } = await seedEvent();
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
           values ($1, 35.70, 51.40, 'manual')`,
          [participantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('a participant may not write another participant’s start point', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const { userId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
               values ($1, 35.70, 51.40, 'manual')`,
              [organizerParticipantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('a participant may not write a start point for someone not in the event', async () => {
      const { eventId } = await seedEvent();
      const { userId } = await addMember(eventId);
      const stranger = await addMember((await seedEvent({ title: 'Elsewhere' })).eventId);

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
               values ($1, 35.70, 51.40, 'manual')`,
              [stranger.participantId],
            ),
          /row-level security|violates/i,
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // The chat
  // ───────────────────────────────────────────────────────────
  describe('in-room chat', () => {
    test('a participant may send a message as themselves', async () => {
      const { eventId } = await seedEvent();
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        const result = await session.query(
          `insert into event_message (event_id, participant_id, sender_name, body)
           values ($1, $2, 'Member', 'hello')`,
          [eventId, participantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('a participant may not send a message as someone else', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const { userId } = await addMember(eventId);

      await withSession(userId, {}, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into event_message (event_id, participant_id, sender_name, body)
               values ($1, $2, 'Organizer', 'hello')`,
              [eventId, organizerParticipantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('a participant may not read the chat of another event', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into event_message (event_id, participant_id, sender_name, body)
         values ($1, $2, 'Organizer', 'private')`,
        [eventId, organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from event_message');
        assert.equal(result.rows.length, 0);
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // The activity log
  // ───────────────────────────────────────────────────────────
  describe('the activity log', () => {
    test('a participant reads it', async () => {
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();

      await asOwner(
        `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'proposal_created')`,
        [eventId, organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from activity_log');
        assert.equal(result.rows.length, 1);
      });
    });

    test('a participant may not update it', async () => {
      // ★ The audit trail's value depends on it being immutable.
      //
      // RLS denies an UPDATE by filtering: the USING clause matches no
      // rows, so the statement succeeds and affects ZERO rows. It is not an
      // error. The proof that the trail is immutable is that the row is
      // unchanged afterwards, not that the statement threw.
      //
      // The statement may also be refused outright at the privilege layer
      // — `activity_log` is not in the client's write grant — and both
      // outcomes leave the row unchanged, which is what this asserts.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();

      await asOwner(
        `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'proposal_created')`,
        [eventId, organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        try {
          const result = await session.query(`update activity_log set action = 'tampered'`);
          assert.equal(result.rowCount, 0, 'the update must affect no rows');
        } catch (error) {
          // Refused at the privilege layer instead. Also a rejection.
          assert.match(
            String(error),
            /row-level security|violates|permission denied/i,
          );
        }
      });

      const rows = await asOwner<{ action: string }>(
        `select action from activity_log where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.action, 'proposal_created');
    });

    test('a participant may not delete it', async () => {
      // As with the update, the denial is a filter or a refusal, and the
      // row must survive either way.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();

      await asOwner(
        `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'proposal_created')`,
        [eventId, organizerParticipantId],
      );

      await withSession(organizerId, {}, async (session) => {
        try {
          const result = await session.query(`delete from activity_log`);
          assert.equal(result.rowCount, 0, 'the delete must affect no rows');
        } catch (error) {
          assert.match(
            String(error),
            /row-level security|violates|permission denied/i,
          );
        }
      });

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from activity_log where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The travel cache
  // ───────────────────────────────────────────────────────────
  describe('the travel cache', () => {
    test('the travel cache is not readable by a client at all', async () => {
      // ★ The cache's ORIGIN is a participant's snapped start point — an
      // approximate home area — and its destination is where that person
      // travels. A readable cache would therefore reveal, for every event
      // on the system, who lives where and where they go.
      //
      // FR-8.15: "Location is visible only to participants of that event.
      // No cross-event, public, or aggregate visibility exists." The cache
      // is the one place where an aggregate view of everyone's locations
      // would otherwise live, so it is server-only.
      //
      // Ranking is server-side (PRD-09 §5), so the client has no need of it.
      const { organizerId } = await seedEvent();

      await asOwner(
        `insert into travel_measurement (
           origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
           minutes, distance_m, cost_irr, confidence, source
         ) values (35.70, 51.40, 35.75, 51.45, 'car', '2026-08-07 15:30:00+00',
                   12, 2400, 180000, 'high', 'neshan')`,
      );

      await withSession(organizerId, {}, async (session) => {
        const result = await session.query('select * from travel_measurement');
        assert.equal(result.rows.length, 0);
      });
    });

    test('the anon role cannot read the travel cache either', async () => {
      // A distinct origin, so the two tests in this section do not collide
      // on the cache's six-key unique constraint.
      await asOwner(
        `insert into travel_measurement (
           origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
           minutes, distance_m, cost_irr, confidence, source
         ) values (35.61, 51.31, 35.66, 51.36, 'car', '2026-08-07 15:30:00+00',
                   14, 2600, 190000, 'high', 'neshan')`,
      );

      const session = await openAnonymousSession();
      try {
        const result = await session.query('select * from travel_measurement');
        assert.equal(result.rows.length, 0);
      } finally {
        await closeSession(session);
      }
    });

    test('the travel cache has no client-readable policy', async () => {
      const rows = await asOwner<{ policyname: string }>(
        `select policyname from pg_policies
         where schemaname = 'public' and tablename = 'travel_measurement'`,
      );
      assert.deepEqual(rows.rows, []);
    });

    test('a participant may not read the activity log of another event', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'proposal_created')`,
        [eventId, organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, {}, async (session) => {
        const result = await session.query('select * from activity_log');
        assert.equal(result.rows.length, 0);
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // The coverage gate
  // ───────────────────────────────────────────────────────────
  describe('the schema-wide guarantees', () => {
    test('every public table has RLS enabled', async () => {
      // ★ A table without RLS is readable by anyone holding the publishable
      // key. One omission is a full data exposure.
      const rows = await asOwner<{ tablename: string }>(
        `select tablename from pg_tables
         where schemaname = 'public' and rowsecurity = false`,
      );
      const unprotected = rows.rows.map((r) => r.tablename);

      // `schema_migrations` and `job_log` are the runner's own bookkeeping
      // and the server's job log; neither is reachable by a client.
      const clientTables = unprotected.filter(
        (name) => name !== 'schema_migrations' && name !== 'job_log',
      );

      assert.deepEqual(clientTables, []);
    });

    test('the eleven product tables all exist', async () => {
      const expected = [
        'activity_log',
        'comment',
        'decision',
        'event',
        'event_message',
        'message_report',
        'participant',
        'proposal',
        'rsvp',
        'start_point',
        'travel_measurement',
        'user_group',
        'venue',
        'vote',
      ];

      const rows = await asOwner<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public'`,
      );
      const present = new Set(rows.rows.map((r) => r.tablename));

      for (const table of expected) {
        assert.ok(present.has(table), `missing table: ${table}`);
      }
    });

    test('every security definer function pins its search_path', async () => {
      // `security definer` bypasses RLS, so every such function is a
      // privilege-escalation surface. Each one must be minimal, must pin
      // `search_path`, and must list `pg_temp` LAST so a caller's temp
      // table cannot shadow a real one (the definer body is re-parsed on
      // every call, unlike a policy expression).
      const rows = await asOwner<{ proname: string; proconfig: string[] | null }>(
        `select proname, proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      );

      assert.ok(rows.rows.length > 0, 'there must be definer functions to check');

      for (const row of rows.rows) {
        const config = row.proconfig?.join(',') ?? '';
        assert.match(config, /search_path=/, `${row.proname} must pin search_path`);
        assert.match(
          config,
          /pg_temp/,
          `${row.proname} must list pg_temp so a temp table cannot shadow a real one`,
        );
        // pg_temp must come LAST: the real schema is searched first.
        const path = config.replace('search_path=', '');
        const parts = path.split(',').map((part) => part.trim());
        assert.equal(
          parts[parts.length - 1],
          'pg_temp',
          `${row.proname} must list pg_temp last`,
        );
      }
    });

    test('the definer functions are exactly the expected set', async () => {
      // A new definer function is a new privilege surface, and this list is
      // where that gets noticed.
      const rows = await asOwner<{ proname: string }>(
        `select proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef`,
      );

      const names = rows.rows.map((r) => r.proname).sort();
      assert.deepEqual(names, [
        // Phase 18's demo read. It is a definer because the reviewer must see
        // the ranking with NO session, and every other read is
        // participant-scoped.
        //
        // Its privilege surface is closed by ONE predicate: `e.is_demo is true`.
        // Execute is granted to `anon`, so the predicate is the entire safety —
        // there is no policy behind it. Widening it to any condition the
        // organizer controls (a status, a flag on their own event) would make
        // their real event anonymously readable.
        //
        // Three things hold the line:
        //  - `tests/deploy/demo-read.test.ts` asserts a non-demo event returns
        //    `null` for `anon`, and again for the state this file warns about;
        //  - the projection excludes `start_point` entirely, so no participant
        //    area is exposed (FR-8.19);
        //  - at most one demo event can exist (`event_single_demo_idx`), so the
        //    anonymous read cannot be spread across a fleet of them.
        'demo_event_summary',
        'enforce_decision_same_event',
        'enforce_participant_cap',
        'is_event_participant',
        // Phase 5's guest join. It is a definer because the "join event" RLS
        // policy requires the joiner to ALREADY be a participant, so a
        // first-time join cannot insert under its own rights — and weakening
        // that policy would let a member forge an organizer row.
        //
        // Its privilege surface is closed three ways: the identity it writes
        // comes from `auth.uid()` and not from a parameter; execute is granted
        // to `service_role` only, so a client cannot bypass the route's rate
        // limiter; and the function is a server-only write path. The grant
        // surface is asserted in `tests/db/join.test.ts`.
        'join_event',
        'redeem_invite',
        'run_anon_cleanup_job',
        'run_retention_job',
      ]);
    });

    test('the travel cache is excluded from the realtime publication', async () => {
      // Broadcasting a location change to every participant over a websocket
      // is a privacy leak, and the cache would flood the channel.
      const rows = await asOwner<{ tablename: string }>(
        `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
      );
      const published = rows.rows.map((r) => r.tablename).sort();

      assert.deepEqual(published, ['event', 'event_message', 'proposal', 'rsvp', 'vote']);
      assert.ok(!published.includes('start_point'));
      assert.ok(!published.includes('travel_measurement'));
      assert.ok(!published.includes('activity_log'));
    });
  });
});

