/**
 * Start-point and profile writes (Plan 05, Task 11).
 *
 * ★ AC-8.2.1 — the coordinate is stored at 2 decimals and the precise value
 * never leaves the device.
 *
 * Rounding on the client is what keeps the precise fix off the network. But the
 * client is not a trust boundary, so the server rejects a 6-decimal payload
 * instead of quietly repairing it — a repaired value would still have crossed
 * the wire, which is the thing the requirement forbids.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool, truncateAll } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
} from './server-support';

prepareServerEnv();

interface JoinBody {
  participant: { id: string; display_name: string };
}

/** Joins an event and returns the new participant's id and identity. */
async function joinAs(token: string, name: string): Promise<{ participantId: string; userId: string }> {
  const response = await call(`/api/invite/${token}/join`, {
    method: 'POST',
    body: { display_name: name },
  });

  const body = await bodyOf<JoinBody>(response);
  return {
    participantId: body.participant.id,
    userId: response.headers.get('x-user-id') ?? '',
  };
}

describe('start point', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    // ★ THE RATE LIMITERS ARE MODULE-LEVEL, so they survive between test
    // files in one process. A file that inherits an exhausted budget would
    // see a 404 where it expects a 200, and the failure would read as a
    // broken invite rather than as a shared counter.
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('a 2-decimal start point is stored and echoed back', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Bahar');

    const response = await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: member.userId,
      body: {
        event_id: created.eventId,
        lat: 35.7,
        lng: 51.4,
        accuracy_m: 1200,
        source: 'gps_coarse',
        label: 'پارک لاله',
      },
    });

    assert.equal(response.status, 200);

    const body = await bodyOf<{
      start_point: { lat: number; lng: number; label: string };
      audience: { participant_count: number; expires_at: string };
    }>(response);

    assert.equal(body.start_point.lat, 35.7);
    assert.equal(body.start_point.lng, 51.4);
    assert.equal(body.start_point.label, 'پارک لاله');
    // The audience line the screen shows after adding (FR-8.9).
    assert.equal(body.audience.participant_count, 2);
  });

  test('the stored coordinate carries exactly 2 decimals', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Cyrus');

    await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: member.userId,
      body: { event_id: created.eventId, lat: 35.7, lng: 51.4, accuracy_m: 1200, source: 'gps_coarse' },
    });

    const stored = await asOwner<{ lat_rounded: string; lng_rounded: string }>(
      `select lat_rounded::text, lng_rounded::text from start_point where participant_id = $1`,
      [member.participantId],
    );

    assert.equal(stored.rows[0]?.lat_rounded, '35.70');
    assert.equal(stored.rows[0]?.lng_rounded, '51.40');
  });

  test('AC-8.2.1 — a 6-decimal payload is REJECTED, not rounded', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Darya');

    const response = await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: member.userId,
      body: {
        event_id: created.eventId,
        lat: 35.700123,
        lng: 51.400456,
        accuracy_m: 1200,
        source: 'gps_coarse',
      },
    });

    assert.equal(response.status, 422);

    const body = await bodyOf<{ fields: Record<string, string> }>(response);
    assert.equal(body.fields.lat, 'events.validation.coordPrecision');

    const rows = await asOwner<{ n: string }>(
      `select count(*)::text as n from start_point where participant_id = $1`,
      [member.participantId],
    );
    assert.equal(rows.rows[0]?.n, '0');
  });

  test('a coordinate outside Iran is rejected by the server', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Traveller');

    const response = await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: member.userId,
      body: {
        event_id: created.eventId,
        lat: 48.85,
        lng: 2.35,
        accuracy_m: 1200,
        source: 'manual',
      },
    });

    assert.equal(response.status, 422);
  });

  test('a second start point replaces the first — there is no location history', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Mover');

    for (const lat of [35.7, 35.8]) {
      const response = await call('/api/participants/me/start-point', {
        method: 'PUT',
        userId: member.userId,
        body: { event_id: created.eventId, lat, lng: 51.4, accuracy_m: 1200, source: 'manual' },
      });
      assert.equal(response.status, 200);
    }

    const rows = await asOwner<{ n: string; lat_rounded: string }>(
      `select count(*)::text as n, min(lat_rounded)::text as lat_rounded
       from start_point where participant_id = $1`,
      [member.participantId],
    );

    assert.equal(rows.rows[0]?.n, '1');
    assert.equal(rows.rows[0]?.lat_rounded, '35.80');
  });

  test('deleting a start point leaves the participant and their votes intact', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Voter');

    await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: member.userId,
      body: { event_id: created.eventId, lat: 35.7, lng: 51.4, accuracy_m: 1200, source: 'gps_coarse' },
    });

    // A proposal and a vote, inserted as the owner — Phase 6 wires the real APIs.
    const venue = await asOwner<{ id: string }>(
      `insert into venue (event_id, name, lat, lng) values ($1, 'Cafe', 35.7, 51.4) returning id`,
      [created.eventId],
    );
    const proposal = await asOwner<{ id: string }>(
      `insert into proposal (event_id, created_by, type, title, venue_id)
       values ($1, $2, 'PLACE', 'Cafe', $3) returning id`,
      [created.eventId, created.organizerParticipantId, venue.rows[0]?.id],
    );
    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposal.rows[0]?.id, member.participantId],
    );

    const response = await call(
      `/api/participants/me/start-point?event_id=${created.eventId}`,
      { method: 'DELETE', userId: member.userId },
    );

    assert.equal(response.status, 200);

    const startPoints = await asOwner<{ n: string }>(
      `select count(*)::text as n from start_point where participant_id = $1`,
      [member.participantId],
    );
    const participants = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where id = $1`,
      [member.participantId],
    );
    const votes = await asOwner<{ n: string }>(
      `select count(*)::text as n from vote where participant_id = $1`,
      [member.participantId],
    );

    assert.equal(startPoints.rows[0]?.n, '0');
    assert.equal(participants.rows[0]?.n, '1', 'the participant must survive');
    assert.equal(votes.rows[0]?.n, '1', 'the vote must survive');
  });

  test('a stranger cannot write a start point for an event they are not in', async () => {
    const created = await createEventViaApi();
    const outsider = await createEventViaApi();

    const response = await call('/api/participants/me/start-point', {
      method: 'PUT',
      userId: outsider.userId,
      body: {
        event_id: created.eventId,
        lat: 35.7,
        lng: 51.4,
        accuracy_m: 1200,
        source: 'gps_coarse',
      },
    });

    assert.equal(response.status, 403);
  });

  test('an unauthenticated write is refused', async () => {
    const created = await createEventViaApi();

    const response = await call('/api/participants/me/start-point', {
      method: 'PUT',
      body: {
        event_id: created.eventId,
        lat: 35.7,
        lng: 51.4,
        accuracy_m: 1200,
        source: 'gps_coarse',
      },
    });

    assert.equal(response.status, 403);
  });
});

describe('participant profile', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    // ★ THE RATE LIMITERS ARE MODULE-LEVEL, so they survive between test
    // files in one process. A file that inherits an exhausted budget would
    // see a 404 where it expects a 200, and the failure would read as a
    // broken invite rather than as a shared counter.
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('a name, travel budget and modes update together', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Old Name');

    const response = await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: {
        event_id: created.eventId,
        display_name: 'New Name',
        max_travel_minutes: 90,
        modes: ['car', 'transit'],
        has_car: true,
      },
    });

    assert.equal(response.status, 200);

    const body = await bodyOf<{ participant: { display_name: string; max_travel_minutes: number; modes: string[] } }>(
      response,
    );

    assert.equal(body.participant.display_name, 'New Name');
    assert.equal(body.participant.max_travel_minutes, 90);
    assert.deepEqual(body.participant.modes, ['car', 'transit']);
  });

  test('a travel budget outside 5–240 minutes is rejected', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Budget');

    const response = await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, max_travel_minutes: 241 },
    });

    assert.equal(response.status, 422);
    assert.equal(
      (await bodyOf<{ fields: Record<string, string> }>(response)).fields.max_travel_minutes,
      'events.validation.travelRange',
    );
  });

  test('a member cannot promote themselves to organizer', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Climber');

    // `role` is not in the patch schema, so it is stripped rather than refused.
    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, display_name: 'Climber', role: 'organizer' },
    });

    const roles = await asOwner<{ role: string }>(
      `select role from participant where id = $1`,
      [member.participantId],
    );

    assert.equal(roles.rows[0]?.role, 'member');
  });

  test('an empty patch is rejected', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Empty');

    const response = await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId },
    });

    assert.equal(response.status, 422);
  });
});
