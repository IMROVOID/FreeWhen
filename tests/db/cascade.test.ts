/**
 * Cascade behaviour.
 *
 * ★ The point of `start_point` having no `user_id` is that deleting an event
 * cascades the location out of existence. That is GDPR Art. 17(1)(a)
 * expressed as schema rather than as application code that might be
 * forgotten (PRD-08 §4.2, FR-8.20).
 *
 * AC-9.5.1: deleting an event leaves zero orphaned coordinates.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  addMember,
  asOwner,
  closePool,

  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
} from './support';

describe('cascades', { concurrency: false }, () => {
  before(async () => {
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // AC-9.5.1 — deleting an event
  // ───────────────────────────────────────────────────────────
  describe('deleting an event (AC-9.5.1)', () => {
    test('leaves zero orphaned coordinates, votes, participants or proposals', async () => {
      // Arrange — a fully populated event
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { participantId: memberParticipantId } = await addMember(eventId, {
        displayName: 'Bahar',
      });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );
      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.75, 51.42, 'gps_coarse')`,
        [memberParticipantId],
      );
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );
      await asOwner(
        `insert into rsvp (participant_id, event_id, value) values ($1, $2, 'going')`,
        [memberParticipantId, eventId],
      );
      await asOwner(
        `insert into comment (proposal_id, participant_id, body) values ($1, $2, 'nice')`,
        [proposalId, organizerParticipantId],
      );
      await asOwner(
        `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'proposal_created')`,
        [eventId, organizerParticipantId],
      );

      // Act
      await asOwner(`delete from event where id = $1`, [eventId]);

      // Assert — nothing survives
      const counts = await asOwner<{ table_name: string; n: number }>(`
        select 'start_point' as table_name, count(*)::int as n from start_point
        union all select 'participant', count(*)::int from participant
        union all select 'vote', count(*)::int from vote
        union all select 'proposal', count(*)::int from proposal
        union all select 'venue', count(*)::int from venue
        union all select 'rsvp', count(*)::int from rsvp
        union all select 'comment', count(*)::int from comment
        union all select 'activity_log', count(*)::int from activity_log
      `);

      for (const row of counts.rows) {
        assert.equal(row.n, 0, `${row.table_name} has ${row.n} orphaned row(s)`);
      }
    });

    test('deleting one event leaves another event’s rows untouched', async () => {
      // Arrange
      const first = await seedEvent({ title: 'First' });
      const second = await seedEvent({ title: 'Second' });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [first.organizerParticipantId],
      );
      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.71, 51.41, 'gps_coarse')`,
        [second.organizerParticipantId],
      );

      // Act
      await asOwner(`delete from event where id = $1`, [first.eventId]);

      // Assert
      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point`,
      );
      assert.equal(rows.rows[0]?.n, 1);

      const survivors = await asOwner<{ id: string }>(
        `select id from start_point`,
      );
      assert.equal(survivors.rows.length, 1);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Deleting a participant
  // ───────────────────────────────────────────────────────────
  describe('deleting a participant', () => {
    test('removes their location and their votes', async () => {
      // Arrange
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { participantId } = await addMember(eventId);

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [participantId],
      );
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, participantId],
      );

      // Act — leaving an event (FR-8.22)
      await asOwner(`delete from participant where id = $1`, [participantId]);

      // Assert
      const counts = await asOwner<{ points: number; votes: number }>(`
        select
          (select count(*)::int from start_point where participant_id = $1) as points,
          (select count(*)::int from vote where participant_id = $1) as votes
      `, [participantId]);
      assert.equal(counts.rows[0]?.points, 0);
      assert.equal(counts.rows[0]?.votes, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Deleting a proposal
  // ───────────────────────────────────────────────────────────
  describe('deleting a proposal', () => {
    test('removes its votes and comments', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );
      await asOwner(
        `insert into comment (proposal_id, participant_id, body) values ($1, $2, 'nice')`,
        [proposalId, organizerParticipantId],
      );

      await asOwner(`delete from proposal where id = $1`, [proposalId]);

      const counts = await asOwner<{ votes: number; comments: number }>(`
        select
          (select count(*)::int from vote where proposal_id = $1) as votes,
          (select count(*)::int from comment where proposal_id = $1) as comments
      `, [proposalId]);
      assert.equal(counts.rows[0]?.votes, 0);
      assert.equal(counts.rows[0]?.comments, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The privacy guarantee, stated as a cascade
  // ───────────────────────────────────────────────────────────
  describe('the location is scoped to the event, not to the user', () => {
    test('a participant in two events has one start point per event', async () => {
      // One participant row per event, so one start point per event — the
      // schema is what keeps a location from outliving its event.
      const userId = (await seedEvent()).organizerId;

      const first = await seedEvent({ organizerId: userId });
      const second = await seedEvent({ organizerId: userId });

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [first.organizerParticipantId],
      );
      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.71, 51.41, 'gps_coarse')`,
        [second.organizerParticipantId],
      );

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id in ($1, $2)`,
        [first.organizerParticipantId, second.organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.n, 2);
    });

    test('a participant may hold only ONE start point', async () => {
      // `participant_id` is unique on start_point: one starting point per
      // participant, not one per event per participant.
      const { organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await assert.rejects(
        () =>
          asOwner(
            `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
             values ($1, 35.75, 51.42, 'manual')`,
            [organizerParticipantId],
          ),
        /start_point_participant_id_key|unique|duplicate/i,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The decision's restrict rule
  // ───────────────────────────────────────────────────────────
  describe('the decision references', () => {
    test('a proposal with a confirmed decision keeps the decision alive when deleted', async () => {
      // ★ The decision's subject is ON DELETE SET NULL, not RESTRICT.
      //
      // A RESTRICT would block a participant from LEAVING an event after
      // they confirmed a decision: their proposals are cascade-deleted,
      // and the restrict would stop the delete outright. That is a "you
      // confirmed, so you may never leave" trap.
      //
      // SET NULL keeps the decision, its reason and its history; only the
      // pointer to a withdrawn proposal is cleared.
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalId, organizerParticipantId],
      );

      // Act
      await asOwner(`delete from proposal where id = $1`, [proposalId]);

      // Assert — the decision survives, with the subject cleared.
      const rows = await asOwner<{ proposal_id: string | null; reason_template: string }>(
        `select proposal_id, reason_template from decision where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.proposal_id, null);
      assert.equal(rows.rows[0]?.reason_template, 'balanced_floor');
    });

    test('deleting the event still removes the decision', async () => {
      // The event's cascade wins over the proposal's restrict.
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
         values ($1, 'place', $2, 'balanced_floor', $3)`,
        [eventId, proposalId, organizerParticipantId],
      );

      await asOwner(`delete from event where id = $1`, [eventId]);

      const rows = await asOwner<{ n: number }>(
        `select count(*)::int as n from decision where event_id = $1`,
        [eventId],
      );
      assert.equal(rows.rows[0]?.n, 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The user row
  // ───────────────────────────────────────────────────────────
  describe('the auth user', () => {
    test('deleting the user deletes the events they created', async () => {
      // PRD-09 §3.1: `event.created_by references auth.users(id) on delete
      // cascade`. FR-8.23 says account deletion removes "the user, all
      // owned events, and all location rows" — so the cascade IS the
      // privacy mechanism, not an accident of the schema.
      const { eventId, organizerId, organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      await asOwner(`delete from auth.users where id = $1`, [organizerId]);

      const events = await asOwner<{ n: number }>(
        `select count(*)::int as n from event where id = $1`,
        [eventId],
      );
      assert.equal(events.rows[0]?.n, 0);

      // Scoped to this participant: other tests' rows are not this test's
      // business.
      const points = await asOwner<{ n: number }>(
        `select count(*)::int as n from start_point where participant_id = $1`,
        [organizerParticipantId],
      );
      assert.equal(points.rows[0]?.n, 0);
    });

    test('deleting a user nulls their participant row in an event they did not create', async () => {
      // `participant.auth_user_id references auth.users(id) on delete set null`
      // — the participant row is the event's record of who was there, and a
      // null auth_user_id is the pre-join state.
      //
      // ★ The user deleted is the MEMBER's, not the organizer's. Deleting
      // the organizer's user would take the whole event with it
      // (`event.created_by ... on delete cascade`), and the member's row
      // would disappear with the event rather than being nulled.
      const other = await seedEvent({ title: 'Someone else’s event' });
      const { userId: memberUserId, participantId } = await addMember(other.eventId, {
        displayName: 'Bahar',
      });

      await asOwner(`delete from auth.users where id = $1`, [memberUserId]);

      const rows = await asOwner<{ auth_user_id: string | null; display_name: string }>(
        `select auth_user_id, display_name from participant where id = $1`,
        [participantId],
      );
      assert.equal(rows.rows[0]?.auth_user_id, null);
      assert.equal(rows.rows[0]?.display_name, 'Bahar');

      // The event itself is untouched — the member was not its creator.
      const events = await asOwner<{ n: number }>(
        `select count(*)::int as n from event where id = $1`,
        [other.eventId],
      );
      assert.equal(events.rows[0]?.n, 1);
    });
  });
});
