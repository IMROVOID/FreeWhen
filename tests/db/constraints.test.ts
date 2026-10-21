/**
 * The schema's load-bearing constraints.
 *
 * Each test here proves a guarantee the PRODUCT depends on. They are not
 * defensive polish — a failure in one of these corrupts the tally, leaks
 * coordinates, or makes a promise the app cannot keep.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  addMember,
  asOwner,
  closePool,
  createUser,
  id,

  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
} from './support';

describe('database constraints', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.1.1 — one vote per person per proposal
  // ───────────────────────────────────────────────────────────
  describe('vote uniqueness (AC-9.1.1)', () => {
    test('a second plain insert for the same pair is rejected', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      // Act
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );

      // Assert
      await assert.rejects(
        () =>
          asOwner(
            `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'no')`,
            [proposalId, organizerParticipantId],
          ),
        // The constraint is the point: a duplicate vote, not a silent second row.
        /vote_proposal_id_participant_id_key|duplicate key|unique/i,
      );
    });

    test('an upsert against the constraint succeeds where a plain insert does not', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'maybe')`,
        [proposalId, organizerParticipantId],
      );

      // Act — the shape the API uses to change a vote
      const result = await asOwner(
        `insert into vote (proposal_id, participant_id, value, updated_at)
         values ($1, $2, 'yes', now())
         on conflict (proposal_id, participant_id)
         do update set value = excluded.value, updated_at = excluded.updated_at`,
        [proposalId, organizerParticipantId],
      );

      // Assert — one row, and the value changed.
      assert.equal(result.rowCount, 1);

      const rows = await asOwner<{ value: string; n: number }>(
        `select value, count(*) over () as n from vote where proposal_id = $1`,
        [proposalId],
      );
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0]?.value, 'yes');
    });

    test('a vote is a property of the participant, not the proposal', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalA = await seedProposal(eventId, organizerParticipantId, { venueId });
      const proposalB = await seedProposal(eventId, organizerParticipantId, { venueId });

      // Act — the same participant voting on two different proposals
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalA, organizerParticipantId],
      );
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'no')`,
        [proposalB, organizerParticipantId],
      );

      // Assert
      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from vote where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.n, 2);
    });
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.2.1 — coordinates are capped at 2 decimals
  // ───────────────────────────────────────────────────────────
  describe('coordinate precision (AC-9.2.1)', () => {
    test('a latitude with 6 decimals is stored at 2', async () => {
      // Arrange
      const { organizerParticipantId } = await seedEvent();

      // Act
      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.701234, 51.401234, 'gps_coarse')`,
        [organizerParticipantId],
      );

      // Assert
      const rows = await asOwner<{ lat_rounded: string; lng_rounded: string }>(
        `select lat_rounded::text as lat_rounded, lng_rounded::text as lng_rounded
         from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.lat_rounded, '35.70');
      assert.equal(rows.rows[0]?.lng_rounded, '51.40');
    });

    test('a latitude outside 25–40 is rejected', async () => {
      // Arrange
      const { organizerParticipantId } = await seedEvent();

      // Act & Assert
      await assert.rejects(
        () =>
          asOwner(
            `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
             values ($1, 12.0, 51.4, 'gps_coarse')`,
            [organizerParticipantId],
          ),
        /lat_in_iran/i,
      );
    });

    test('a longitude outside 44–64 is rejected', async () => {
      // Arrange
      const { organizerParticipantId } = await seedEvent();

      // Act & Assert
      await assert.rejects(
        () =>
          asOwner(
            `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
             values ($1, 35.7, 12.0, 'gps_coarse')`,
            [organizerParticipantId],
          ),
        /lng_in_iran/i,
      );
    });

    test('the column type is numeric(5,2) — the guarantee is the type, not a convention', async () => {
      const rows = await asOwner<{ data_type: string; numeric_precision: number; numeric_scale: number }>(
        `select data_type, numeric_precision, numeric_scale
         from information_schema.columns
         where table_schema = 'public' and table_name = 'start_point'
           and column_name = 'lat_rounded'`,
      );
      assert.equal(rows.rows[0]?.data_type, 'numeric');
      assert.equal(rows.rows[0]?.numeric_precision, 5);
      assert.equal(rows.rows[0]?.numeric_scale, 2);
    });

    test('start_point has no user_id — the orphan-row risk is designed out', async () => {
      const rows = await asOwner<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'start_point'`,
      );
      const names = rows.rows.map((r) => r.column_name);
      assert.ok(!names.includes('user_id'), 'start_point must not have a user_id column');
    });

    test('no table anywhere has a home_address column', async () => {
      const rows = await asOwner<{ table_name: string }>(
        `select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'home_address'`,
      );
      assert.equal(rows.rows.length, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The event window and deadline
  // ───────────────────────────────────────────────────────────
  describe('event window', () => {
    test('a window whose end precedes its start is rejected', async () => {
      const userId = await createUser();

      await assert.rejects(
        () =>
          asOwner(
            `insert into event (id, title, date_window_start, date_window_end, created_by)
             values ($1, 'Backwards', $2, $3, $4)`,
            [
              id(),
              new Date(Date.now() + 86_400_000).toISOString(),
              new Date(Date.now()).toISOString(),
              userId,
            ],
          ),
        /window_ordered/i,
      );
    });

    test('a deadline after the window end is rejected', async () => {
      const userId = await createUser();

      await assert.rejects(
        () =>
          asOwner(
            `insert into event (
               id, title, date_window_start, date_window_end, voting_deadline, created_by
             ) values ($1, 'Late deadline', $2, $3, $4, $5)`,
            [
              id(),
              new Date(Date.now()).toISOString(),
              new Date(Date.now() + 86_400_000).toISOString(),
              new Date(Date.now() + 4 * 86_400_000).toISOString(),
              userId,
            ],
          ),
        /deadline_in_window/i,
      );
    });

    test('two events may not share an invite token hash', async () => {
      // Arrange
      const userId = await createUser();
      const hash = 'a'.repeat(64);

      await asOwner(
        `insert into event (id, title, date_window_start, date_window_end, created_by, invite_token_hash)
         values ($1, 'First', $2, $3, $4, $5)`,
        [
          id(),
          new Date().toISOString(),
          new Date(Date.now() + 86_400_000).toISOString(),
          userId,
          hash,
        ],
      );

      // Act & Assert
      await assert.rejects(
        () =>
          asOwner(
            `insert into event (id, title, date_window_start, date_window_end, created_by, invite_token_hash)
             values ($1, 'Second', $2, $3, $4, $5)`,
            [
              id(),
              new Date().toISOString(),
              new Date(Date.now() + 86_400_000).toISOString(),
              userId,
              hash,
            ],
          ),
        /event_invite_token_hash_key|unique/i,
      );
    });

    test('many events may have a NULL invite token hash', async () => {
      // NULLs are distinct in a partial unique index — the constraint only
      // applies to a token that is actually present.
      const userId = await createUser();

      for (let i = 0; i < 3; i += 1) {
        await asOwner(
          `insert into event (id, title, date_window_start, date_window_end, created_by)
           values ($1, $2, $3, $4, $5)`,
          [
            id(),
            `No token ${i}`,
            new Date().toISOString(),
            new Date(Date.now() + 86_400_000).toISOString(),
            userId,
          ],
        );
      }

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from event where invite_token_hash is null`,
      );
      assert.ok((rows.rows[0]?.n ?? 0) >= 3);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The proposal's type constraints
  // ───────────────────────────────────────────────────────────
  describe('proposal', () => {
    test('a PLACE proposal without a venue is rejected', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await assert.rejects(
        () => seedProposal(eventId, organizerParticipantId, { type: 'PLACE' }),
        /place_has_venue/i,
      );
    });

    test('a TIME proposal without a slot is rejected', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await assert.rejects(
        () => seedProposal(eventId, organizerParticipantId, { type: 'TIME' }),
        /time_has_slot/i,
      );
    });

    test('an end before the start is rejected', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await assert.rejects(
        () =>
          asOwner(
            `insert into proposal (id, event_id, created_by, type, title, start_utc, end_utc)
             values ($1, $2, $3, 'TIME', 'Backwards', $4, $5)`,
            [
              id(),
              eventId,
              organizerParticipantId,
              new Date(Date.now() + 86_400_000).toISOString(),
              new Date().toISOString(),
            ],
          ),
        /time_ordered/i,
      );
    });

    test('LEADING and ELIMINATED are not status values', async () => {
      // They are derived per render (PRD-02 §3.1). If they were storable,
      // the label and the tally could drift apart.
      const { eventId, organizerParticipantId } = await seedEvent();

      for (const status of ['LEADING', 'ELIMINATED']) {
        await assert.rejects(
          () =>
            asOwner(
              `insert into proposal (id, event_id, created_by, type, title, start_utc, status)
               values ($1, $2, $3, 'TIME', 'Bad status', $4, $5)`,
              [
                id(),
                eventId,
                organizerParticipantId,
                new Date(Date.now() + 86_400_000).toISOString(),
                status,
              ],
            ),
          /proposal_status_check|status/i,
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // The decision's partial unique index
  // ───────────────────────────────────────────────────────────
  describe('decision', () => {
    test('two live decisions on the same axis are rejected', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalA = await seedProposal(eventId, organizerParticipantId, { venueId });
      const proposalB = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalA, organizerParticipantId],
      );

      // Act & Assert
      await assert.rejects(
        () =>
          asOwner(
            `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
             values ($1, 'place', $2, 'balanced_floor', $3)`,
            [eventId, proposalB, organizerParticipantId],
          ),
        /decision_event_axis_live_key|unique/i,
      );
    });

    test('a decision may be reopened, and a second one confirmed afterwards', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalA = await seedProposal(eventId, organizerParticipantId, { venueId });
      const proposalB = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalA, organizerParticipantId],
      );

      // Act — reopen the first
      await asOwner(
        `update decision set reopened_at = now(), reopen_reason = 'changed my mind'
         where event_id = $1 and axis = 'place'`,
        [eventId],
      );

      // Assert — a new live decision is now allowed
      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalB, organizerParticipantId],
      );

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from decision
         where event_id = $1 and axis = 'place' and reopened_at is null`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 1);
    });

    test('the reason is stored as a template and params, never as prose', async () => {
      // A stored sentence would freeze Persian prose and Persian digits at
      // confirmation time, and the Decision Card could never be shown in
      // English (PRD-05 §11.1, PRD-10 D11A).
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, reason_params, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', '{"floorMinutes": 18}'::jsonb, $3)`,
        [eventId, proposalId, organizerParticipantId],
      );

      const rows = await asOwner<{ reason_template: string; reason_params: unknown }>(
        `select reason_template, reason_params from decision where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.reason_template, 'balanced_floor');
      assert.deepEqual(rows.rows[0]?.reason_params, { floorMinutes: 18 });
    });
  });

  // ───────────────────────────────────────────────────────────
  // The venue's tri-state accessibility
  // ───────────────────────────────────────────────────────────
  describe('venue accessibility', () => {
    test('a venue with no attributes defaults to unknown on all three', async () => {
      // A default of confirmed_yes would make every un-tagged venue silently
      // accessible — the single most harmful possible bug.
      const { eventId } = await seedEvent();

      await asOwner(
        `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'Untagged', 35.7, 51.4)`,
        [id(), eventId],
      );

      const rows = await asOwner<{ accessibility: Record<string, string> }>(
        `select accessibility from venue where name = 'Untagged'`,
      );
      assert.deepEqual(rows.rows[0]?.accessibility, {
        stepFreeEntrance: 'unknown',
        accessibleRestroom: 'unknown',
        limitedWalkingSuitable: 'unknown',
      });
    });

    test('opening_hours is nullable, and null means unknown — not closed', async () => {
      // Phase 3 TC-7 asserts absence ≠ closed.
      const { eventId } = await seedEvent();

      await asOwner(
        `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'No hours', 35.7, 51.4)`,
        [id(), eventId],
      );

      const rows = await asOwner<{ opening_hours: unknown }>(
        `select opening_hours from venue where name = 'No hours'`,
      );
      assert.equal(rows.rows[0]?.opening_hours, null);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The RSVP's primary key
  // ───────────────────────────────────────────────────────────
  describe('rsvp', () => {
    test('a participant may hold only one RSVP', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into rsvp (participant_id, event_id, value) values ($1, $2, 'going')`,
        [organizerParticipantId, eventId],
      );

      await assert.rejects(
        () =>
          asOwner(
            `insert into rsvp (participant_id, event_id, value) values ($1, $2, 'maybe')`,
            [organizerParticipantId, eventId],
          ),
        /rsvp_pkey|duplicate key|unique/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The travel cache's nullable cost
  // ───────────────────────────────────────────────────────────
  describe('travel_measurement', () => {
    test('cost_irr may be null, and null is not the same as zero', async () => {
      // NULL means unknown, never free. A default of 0 would make every
      // venue with missing cost data look cheapest.
      const rows = await asOwner<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `select data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public' and table_name = 'travel_measurement'
           and column_name = 'cost_irr'`,
      );
      assert.equal(rows.rows[0]?.data_type, 'bigint');
      assert.equal(rows.rows[0]?.is_nullable, 'YES');
      assert.equal(rows.rows[0]?.column_default, null);
    });

    test('the same six keys conflict, enabling on conflict do update', async () => {
      // Arrange
      const keys = [35.7, 51.4, 35.75, 51.45, 'car', '2026-08-07 15:30:00+00'];

      await asOwner(
        `insert into travel_measurement (
           origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
           minutes, distance_m, cost_irr, confidence, source
         ) values ($1, $2, $3, $4, $5, $6, 20, 4000, 300000, 'high', 'neshan')`,
        keys,
      );

      // Act — the upsert the cache relies on
      const result = await asOwner(
        `insert into travel_measurement (
           origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
           minutes, distance_m, cost_irr, confidence, source
         ) values ($1, $2, $3, $4, $5, $6, 25, 4100, 310000, 'high', 'neshan')
         on conflict (origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket)
         do update set minutes = excluded.minutes, fetched_at = now()`,
        keys,
      );

      // Assert
      assert.equal(result.rowCount, 1);

      const rows = await asOwner<{ n: number; minutes: number }>(
        `select count(*)::int as n, max(minutes)::int as minutes
         from travel_measurement
         where origin_lat = $1 and dest_lat = $2 and mode = $3 and departure_bucket = $4`,
        [keys[0], keys[2], keys[4], keys[5]],
      );
      assert.equal(rows.rows[0]?.n, 1);
      assert.equal(rows.rows[0]?.minutes, 25);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The participant's constraints
  // ───────────────────────────────────────────────────────────
  describe('participant', () => {
    test('a display name of 31 characters is rejected', async () => {
      const { eventId } = await seedEvent();

      await assert.rejects(
        () =>
          asOwner(
            `insert into participant (id, event_id, display_name) values ($1, $2, $3)`,
            [id(), eventId, 'a'.repeat(31)],
          ),
        /display_name/i,
      );
    });

    test('a travel tolerance below 5 minutes is rejected', async () => {
      const { eventId } = await seedEvent();

      await assert.rejects(
        () =>
          asOwner(
            `insert into participant (id, event_id, display_name, max_travel_minutes)
             values ($1, $2, 'Tight', 4)`,
            [id(), eventId],
          ),
        /max_travel_minutes/i,
      );
    });

    test('a duplicate join by the same user in the same event is rejected', async () => {
      // FR-1.20 duplicate-join detection is a database guarantee.
      const { eventId, organizerId } = await seedEvent();

      await assert.rejects(
        () => addMember(eventId, { userId: organizerId, displayName: 'Impostor' }),
        /participant_event_id_auth_user_id_key|unique|duplicate/i,
      );
    });

    test('a participant with a NULL auth_user_id does not collide', async () => {
      // The pre-join state: a row that has no identity yet.
      const { eventId } = await seedEvent();

      for (let i = 0; i < 2; i += 1) {
        await asOwner(
          `insert into participant (id, event_id, display_name) values ($1, $2, $3)`,
          [id(), eventId, `Pre-join ${i}`],
        );
      }

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from participant where event_id = $1 and auth_user_id is null`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 2);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The comment and message length limits
  // ───────────────────────────────────────────────────────────
  describe('engagement text limits', () => {
    test('a comment over 300 characters is rejected', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await assert.rejects(
        () =>
          asOwner(
            `insert into comment (proposal_id, participant_id, body) values ($1, $2, $3)`,
            [proposalId, organizerParticipantId, 'a'.repeat(301)],
          ),
        /body/i,
      );
    });

    test('a chat message over 500 characters is rejected', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();

      await assert.rejects(
        () =>
          asOwner(
            `insert into event_message (event_id, participant_id, sender_name, body)
             values ($1, $2, 'Ali', $3)`,
            [eventId, organizerParticipantId, 'a'.repeat(501)],
          ),
        /body/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The activity log's immutability
  // ───────────────────────────────────────────────────────────
  describe('activity log', () => {
    test('it has no updated_at column', async () => {
      const rows = await asOwner<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'activity_log'`,
      );
      const names = rows.rows.map((r) => r.column_name);
      assert.ok(!names.includes('updated_at'), 'activity_log must be append-only');
    });

    test('it has no update or delete policy', async () => {
      const rows = await asOwner<{ cmd: string }>(
        `select cmd from pg_policies where schemaname = 'public' and tablename = 'activity_log'`,
      );
      const commands = rows.rows.map((r) => r.cmd);
      assert.ok(!commands.includes('UPDATE'), 'activity_log must have no update policy');
      assert.ok(!commands.includes('DELETE'), 'activity_log must have no delete policy');
    });
  });
});

