/**
 * The mute preference (Plan 10 Task 6 — FR-6.19, AC-6.4.1).
 *
 * ★ THIS FILE EXISTS BECAUSE THE TOGGLE COULD NOT HAVE WORKED.
 *
 * `MuteToggle` PATCHed a `preferences` envelope that matched no schema field and
 * no column, so every write was rejected, the optimistic flip was reverted, and
 * the switch silently reset — a control that ships broken and looks fine. The
 * three assertions that make that impossible to reintroduce:
 *
 *  1. the preference ROUND-TRIPS through the API and is still there on re-read,
 *  2. the GATE reads the stored value rather than trusting the request body,
 *  3. N4 ignores the mute entirely, because the decision is the product's
 *     promise (FR-6.19).
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
  participant: { id: string; notifications_muted: boolean };
}

async function joinAs(
  token: string,
  name: string,
): Promise<{ participantId: string; userId: string }> {
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

describe('the mute preference', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('a new participant is not muted', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Bahar');

    // The join payload reports the stored default, so the client can render the
    // switch without a second request.
    const joinResponse = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId: member.userId,
      body: { display_name: 'Bahar' },
    });

    const joined = await bodyOf<JoinBody>(joinResponse);
    assert.equal(joined.participant.notifications_muted, false);
  });

  test('muting round-trips: the write is stored and echoed back', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Nima');

    const patched = await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, notifications_muted: true },
    });

    assert.equal(patched.status, 200);

    const body = await bodyOf<{ participant: { notifications_muted: boolean } }>(patched);
    assert.equal(body.participant.notifications_muted, true);

    // ★ THE RE-READ IS THE ASSERTION THAT MATTERS.
    //
    // The echo could be the request reflected back. Only a fresh read from the
    // database proves the preference was persisted.
    const stored = await asOwner<{ notifications_muted: boolean }>(
      `select notifications_muted from participant where id = $1`,
      [member.participantId],
    );

    assert.equal(stored.rows[0]?.notifications_muted, true);
  });

  test('unmuting round-trips too, so the switch is not one-way', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Sara');

    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, notifications_muted: true },
    });

    const unmuted = await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, notifications_muted: false },
    });

    assert.equal(unmuted.status, 200);

    const stored = await asOwner<{ notifications_muted: boolean }>(
      `select notifications_muted from participant where id = $1`,
      [member.participantId],
    );

    assert.equal(stored.rows[0]?.notifications_muted, false);
  });

  test('the mute is per participant, so muting one event leaves another alone', async () => {
    const first = await createEventViaApi();
    const member = await joinAs(first.token, 'Reza');

    const second = await createEventViaApi();

    // The same identity joins a second event. A user-level flag would have
    // silenced both; a participant-scoped one must not.
    await call(`/api/invite/${second.token}/join`, {
      method: 'POST',
      userId: member.userId,
      body: { display_name: 'Reza' },
    });

    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: first.eventId, notifications_muted: true },
    });

    const rows = await asOwner<{ event_id: string; notifications_muted: boolean }>(
      `select p.event_id, p.notifications_muted
         from participant p
        where p.auth_user_id = $1
        order by p.joined_at asc`,
      [member.userId],
    );

    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows[0]?.notifications_muted, true);
    assert.equal(rows.rows[1]?.notifications_muted, false);
  });

  test('the gate honours a stored mute for N1', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Mina');

    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, notifications_muted: true },
    });

    const response = await call(`/api/events/${created.eventId}/notifications`, {
      method: 'POST',
      userId: member.userId,
      body: { type: 'N1' },
    });

    const decision = await bodyOf<{ action: string; reason: string | null }>(response);

    assert.equal(decision.action, 'skip');
    assert.equal(decision.reason, 'muted');
  });

  test('the gate sends N1 when the participant is unmuted', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Omid');

    const response = await call(`/api/events/${created.eventId}/notifications`, {
      method: 'POST',
      userId: member.userId,
      body: { type: 'N1' },
    });

    const decision = await bodyOf<{ action: string }>(response);
    assert.equal(decision.action, 'send');
  });

  test('★ AC-6.4.1 — a muted participant still receives the decision (N4)', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Parisa');

    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, notifications_muted: true },
    });

    const response = await call(`/api/events/${created.eventId}/notifications`, {
      method: 'POST',
      userId: member.userId,
      body: { type: 'N4' },
    });

    const decision = await bodyOf<{ action: string; reason: string | null }>(response);

    // The core promise: muting silences N1–N3 and N5/N6, never N4.
    assert.equal(decision.action, 'send');
    assert.equal(decision.reason, null);
  });

  test('a client-supplied `muted` in the body cannot silence N1 either way', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Kaveh');

    // ★ THE BODY'S `muted` IS NOT THE TRUTH.
    //
    // Before this change the endpoint took `muted` as a client-supplied fact, so
    // a client that omitted it was treated as unmuted regardless of what the
    // participant had chosen. Here the caller CLAIMS to be muted but is not
    // stored as muted: the stored value must win.
    const response = await call(`/api/events/${created.eventId}/notifications`, {
      method: 'POST',
      userId: member.userId,
      body: { type: 'N1', muted: true },
    });

    const decision = await bodyOf<{ action: string }>(response);
    assert.equal(decision.action, 'send');
  });

  test('a non-participant cannot read an event’s notification state', async () => {
    const created = await createEventViaApi();
    const outsider = await createEventViaApi();

    const response = await call(`/api/events/${created.eventId}/notifications`, {
      method: 'POST',
      userId: outsider.userId,
      body: { type: 'N1' },
    });

    assert.equal(response.status, 403);
  });
});
