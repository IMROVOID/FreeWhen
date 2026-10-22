/**
 * The privacy invariants (Plan 09 Task 7 + the ACs in PRD-08 §11).
 *
 * ★ EVERY TEST HERE ASSERTS A PROMISE THE PRODUCT MAKES OUT LOUD.
 *
 * Consent, visibility, deletion, retention and cascade are the claims the
 * privacy notice makes. A claim with no test is a claim that will quietly stop
 * being true, and the notice will go on making it.
 *
 * The HTTP surface is exercised through the REAL router (`call` from
 * `server-support`); RLS itself is tested in `rls.test.ts` and
 * `security.test.ts`. This suite is about whether the CONTROL works.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { addMember, asOwner, closePool, createUser, seedEvent, truncateAll } from './support';
import { bodyOf, call, createEventViaApi, prepareServerEnv } from './server-support';
import {
  addStartPoint,
  childRowCounts,
  deleteStartPointViaApi,
  giveStartPoint,
  HOUR,
  organizerUserId,
  seedPopulatedEvent,
  seedSurvivorEvent,
  setVisibility,
  startPointCount,
} from './privacy-support';

type ParticipantView = Array<{ id: string; start_point_state: string; start_point_shared: boolean }>;

/** The participant list as one caller sees it. */
async function participantsAs(userId: string, eventId: string): Promise<ParticipantView> {
  const response = await call(`/api/events/${eventId}/participants`, { userId });
  const body = await bodyOf<{ participants: ParticipantView }>(response);
  return body.participants;
}

describe('privacy', { concurrency: false }, () => {
  before(async () => {
    prepareServerEnv();
    await truncateAll();
  });

  after(async () => {
    await closePool();
  });

  // ─────────────────────────────────────────────────────────────
  // AC-8.2.1 — rounding, and the refusal to repair precision
  // ─────────────────────────────────────────────────────────────
  describe('AC-8.2.1 — coordinates are stored at two decimals', () => {
    test('a 2-decimal point is stored as given', async () => {
      const created = await createEventViaApi();
      assert.equal((await addStartPoint(created.userId, created.eventId)).status, 200);

      const rows = await asOwner<{ lat: number; lng: number }>(
        `select lat_rounded::float8 as lat, lng_rounded::float8 as lng
           from start_point where participant_id = $1`,
        [created.organizerParticipantId],
      );
      assert.equal(rows.rows[0]?.lat, 35.7);
      assert.equal(rows.rows[0]?.lng, 51.4);
    });

    test('a 6-decimal point is REFUSED, not silently rounded', async () => {
      // OQ-9.2 — "both" layers. Accepting a precise payload would mean the
      // precise value travelled, which is the one thing AC-8.2.1 forbids.
      const created = await createEventViaApi();

      const response = await call('/api/participants/me/start-point', {
        method: 'PUT',
        userId: created.userId,
        body: {
          event_id: created.eventId,
          lat: 35.701234,
          lng: 51.409876,
          accuracy_m: 1200,
          source: 'gps_coarse',
        },
      });
      assert.equal(response.status, 422);
      assert.equal(await startPointCount(created.organizerParticipantId), 0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 3 — audience and expiry at the point of sharing
  // ─────────────────────────────────────────────────────────────
  describe('the audience and expiry shown after adding (FR-8.9)', () => {
    test('the count includes the person who just added theirs', async () => {
      const created = await createEventViaApi();
      await addMember(created.eventId); // a second participant

      const response = await addStartPoint(created.userId, created.eventId);
      const body = await bodyOf<{ audience: { participant_count: number; expires_at: string } }>(
        response,
      );

      assert.equal(body.audience.participant_count, 2);
      assert.ok(body.audience.expires_at, 'the expiry is part of the disclosure');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 2 — per-participant visibility (FR-8.18)
  // ─────────────────────────────────────────────────────────────
  describe('per-participant visibility (FR-8.18)', () => {
    test('`private` hides the coordinate from peers but the row survives for the engine', async () => {
      const created = await createEventViaApi();
      await addMember(created.eventId); // so `private` has someone to hide FROM
      await addStartPoint(created.userId, created.eventId);

      const response = await setVisibility(
        created.userId,
        created.eventId,
        created.organizerParticipantId,
        'private',
      );
      assert.equal(response.status, 200);

      // ★ The row still exists: hiding it from the ENGINE would let the member
      // opt out of fairness, which is worse than the disclosure it avoids.
      assert.equal(
        await startPointCount(created.organizerParticipantId),
        1,
        'the coordinate must survive for the ranking',
      );
    });

    test('a peer reads the private member as `not_shared`, and the owner still sees it', async () => {
      const created = await createEventViaApi();
      const peer = await addMember(created.eventId);

      await addStartPoint(created.userId, created.eventId);
      await setVisibility(created.userId, created.eventId, created.organizerParticipantId, 'private');

      const peerView = await participantsAs(peer.userId, created.eventId);
      const seenByPeer = peerView.find((p) => p.id === created.organizerParticipantId);
      assert.equal(seenByPeer?.start_point_state, 'not_shared');
      assert.equal(seenByPeer?.start_point_shared, false);

      const ownerView = await participantsAs(created.userId, created.eventId);
      const seenBySelf = ownerView.find((p) => p.id === created.organizerParticipantId);
      assert.equal(seenBySelf?.start_point_state, 'shared', 'the owner must see their own area');
    });

    test('the participant list never carries a coordinate', async () => {
      // A coordinate in a list payload would be readable by every client and
      // loggable by every call site; the state is the whole disclosure.
      const created = await createEventViaApi();
      await addStartPoint(created.userId, created.eventId);

      const response = await call(`/api/events/${created.eventId}/participants`, {
        userId: created.userId,
      });
      const raw = await response.clone().text();

      assert.doesNotMatch(raw, /lat_rounded|lng_rounded|accuracy_m/);
      assert.doesNotMatch(raw, /35\.7|51\.4/);
    });

    test('a member cannot change somebody else’s visibility', async () => {
      // The worst possible bug in this control: a disclosure performed by the
      // wrong person.
      const created = await createEventViaApi();
      const peer = await addMember(created.eventId);

      const response = await setVisibility(
        peer.userId,
        created.eventId,
        created.organizerParticipantId,
        'event',
      );
      assert.equal(response.status, 403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 4 / AC-8.8.1 — deleting a start point leaves the person
  // ─────────────────────────────────────────────────────────────
  describe('AC-8.8.1 — deleting a start point leaves the participant intact', () => {
    test('the coordinate goes; the participant, their vote and the proposal stay', async () => {
      const seeded = await seedPopulatedEvent();
      const userId = await organizerUserId(seeded.organizerParticipantId);
      assert.ok(userId);

      assert.equal((await deleteStartPointViaApi(userId, seeded.eventId)).status, 200);

      const counts = await asOwner<{ votes: number; proposals: number; participants: number }>(
        `select
           (select count(*)::int from vote where participant_id = $1) as votes,
           (select count(*)::int from proposal where id = $2) as proposals,
           (select count(*)::int from participant where id = $1) as participants`,
        [seeded.organizerParticipantId, seeded.proposalId],
      );

      assert.equal(await startPointCount(seeded.organizerParticipantId), 0, 'the coordinate is gone');
      assert.equal(counts.rows[0]?.participants, 1, 'the person stays in the event');
      assert.equal(counts.rows[0]?.votes, 1, 'their vote stands');
      assert.equal(counts.rows[0]?.proposals, 1, 'the proposal they created stands');
    });

    test('the ranking reports reduced coverage rather than dropping the member', async () => {
      // AC-8.8.1 — the honest answer. A member with no start point is still a
      // member; the screen must say their travel time is not included.
      const created = await createEventViaApi();
      await addStartPoint(created.userId, created.eventId);
      await deleteStartPointViaApi(created.userId, created.eventId);

      const view = await participantsAs(created.userId, created.eventId);
      const self = view.find((p) => p.id === created.organizerParticipantId);

      assert.equal(view.length, 1, 'the member is still listed');
      assert.equal(self?.start_point_state, 'none', 'and is reported as having no area');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AC-8.5.1 — retention at event end
  // ─────────────────────────────────────────────────────────────
  describe('AC-8.5.1 — the retention job deletes coordinates at event end', () => {
    test('a confirmed event that ended 2 h ago loses its points and keeps its decision', async () => {
      const seeded = await seedPopulatedEvent({
        windowStart: new Date(Date.now() - 240 * HOUR).toISOString(),
        windowEnd: new Date(Date.now() - 2 * HOUR).toISOString(),
      });

      await asOwner(`select run_retention_job()`);

      const kept = await asOwner<{ decisions: number; venues: number; proposals: number }>(
        `select
           (select count(*)::int from decision where event_id = $1) as decisions,
           (select count(*)::int from venue where id = $2) as venues,
           (select count(*)::int from proposal where id = $3) as proposals`,
        [seeded.eventId, seeded.venueId, seeded.proposalId],
      );

      assert.equal(await startPointCount(seeded.organizerParticipantId), 0, 'the points are deleted');
      assert.equal(await startPointCount(seeded.memberParticipantId), 0);
      assert.equal(kept.rows[0]?.decisions, 1, 'the decision history survives');
      assert.equal(kept.rows[0]?.venues, 1, 'the venue survives');
      assert.equal(kept.rows[0]?.proposals, 1, 'the proposals survive');
    });

    test('an event that ended 30 minutes ago keeps its points (the 1-hour grace)', async () => {
      // The grace period keeps the job from racing a client that is still
      // reading, and keeps the leave-now reminder working on the day.
      const seeded = await seedPopulatedEvent({
        windowStart: new Date(Date.now() - 240 * HOUR).toISOString(),
        windowEnd: new Date(Date.now() - 0.5 * HOUR).toISOString(),
      });

      await asOwner(`select run_retention_job()`);

      assert.equal(await startPointCount(seeded.organizerParticipantId), 1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 7 / AC-9.5.1 — the cascade leaves no orphan
  // ─────────────────────────────────────────────────────────────
  describe('AC-9.5.1 — deleting an event leaves zero orphans', () => {
    test('no orphaned rows across every child table', async () => {
      const seeded = await seedPopulatedEvent();
      const organizerId = await organizerUserId(seeded.organizerParticipantId);
      assert.ok(organizerId);

      await asOwner(`delete from event where id = $1`, [seeded.eventId]);

      const counts = await childRowCounts(seeded);
      for (const [table, count] of Object.entries(counts)) {
        assert.equal(count, 0, `${table} must have no orphaned rows`);
      }

      // The accounts are NOT part of the cascade: a person outlives an event.
      const users = await asOwner<{ n: number }>(
        `select count(*)::int as n from auth.users where id = any($1)`,
        [[organizerId, seeded.memberUserId]],
      );
      assert.equal(users.rows[0]?.n, 2, 'deleting an event must not delete the accounts');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Task 10 — account deletion (Apple §5.1.1(v))
  // ─────────────────────────────────────────────────────────────
  describe('in-app account deletion', () => {
    test('removes the account, its owned events and its coordinates; others survive', async () => {
      const owner = await createUser();
      const { eventId, organizerParticipantId } = await seedEvent({ organizerId: owner });
      await giveStartPoint(organizerParticipantId);

      const survivor = await seedSurvivorEvent();

      assert.equal((await call('/api/account', { method: 'DELETE', userId: owner })).status, 200);

      const counts = await asOwner<{ users: number; owned_event: number; points: number }>(
        `select
           (select count(*)::int from auth.users where id = $1) as users,
           (select count(*)::int from event where id = $2) as owned_event,
           (select count(*)::int from start_point where participant_id = $3) as points`,
        [owner, eventId, organizerParticipantId],
      );

      assert.equal(counts.rows[0]?.users, 0);
      assert.equal(counts.rows[0]?.owned_event, 0);
      assert.equal(counts.rows[0]?.points, 0);

      const kept = await asOwner<{ events: number; users: number }>(
        `select
           (select count(*)::int from event where id = $1) as events,
           (select count(*)::int from auth.users where id = $2) as users`,
        [survivor.eventId, survivor.userId],
      );
      assert.equal(kept.rows[0]?.events, 1, 'another account’s event is untouched');
      assert.equal(kept.rows[0]?.users, 1, 'and its account is untouched');
    });

    test('a second call is not an error — the desired end state is reached', async () => {
      const owner = await createUser();

      const first = await call('/api/account', { method: 'DELETE', userId: owner });
      const second = await call('/api/account', { method: 'DELETE', userId: owner });

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal((await bodyOf<{ deleted: boolean }>(second)).deleted, true);
    });

    test('an anonymous caller cannot delete an account', async () => {
      assert.equal((await call('/api/account', { method: 'DELETE' })).status, 403);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // No cross-event leakage
  // ─────────────────────────────────────────────────────────────
  describe('an identity in two events does not leak across them', () => {
    test('each event sees only its own participants', async () => {
      const first = await createEventViaApi({ title: 'First' });
      const second = await createEventViaApi({ title: 'Second' });

      const firstView = await participantsAs(first.userId, first.eventId);
      assert.equal(firstView.length, 1);
      assert.equal(firstView[0]?.id, first.organizerParticipantId);

      const secondView = await participantsAs(second.userId, second.eventId);
      assert.ok(
        !secondView.some((p) => p.id === first.organizerParticipantId),
        'no cross-event participant leakage',
      );
    });
  });
});
