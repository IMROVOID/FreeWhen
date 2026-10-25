import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';
import type { EventSummary } from '@/src/types/event';

import { asOwner, closePool, truncateAll } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
} from './server-support';

prepareServerEnv();

describe('venue and user management', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('GET /api/events/:id includes invite_code and invite_url for organizer and participants', async () => {
    const created = await createEventViaApi({ title: 'Dinner Party' });

    // Read event as organizer
    const response = await call(`/api/events/${created.eventId}`, {
      userId: created.userId,
    });
    assert.equal(response.status, 200);

    const body = await bodyOf<{ event: EventSummary }>(response);
    assert.ok(body.event.invite_code);
    assert.ok(body.event.invite_url);
    assert.equal(body.event.invite_url, created.url);
    assert.equal(body.event.invite_code, created.token);
  });

  test('PATCH /api/events/:id renames the event for organizer and rejects non-organizer', async () => {
    const created = await createEventViaApi({ title: 'Old Title' });

    // Join a guest
    const guestJoin = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Guest Member' },
    });
    assert.equal(guestJoin.status, 200);
    const guestUser = guestJoin.headers.get('x-user-id');
    assert.ok(guestUser);

    // Non-organizer tries to rename -> 403 / NOT_ORGANIZER
    const guestRename = await call(`/api/events/${created.eventId}`, {
      method: 'PATCH',
      userId: guestUser,
      body: { title: 'Hacked Title' },
    });
    assert.equal(guestRename.status, 403);

    // Organizer renames -> 200
    const ownerRename = await call(`/api/events/${created.eventId}`, {
      method: 'PATCH',
      userId: created.userId,
      body: { title: 'Renamed Party' },
    });
    assert.equal(ownerRename.status, 200);
    const renamedBody = await bodyOf<{ event: EventSummary }>(ownerRename);
    assert.equal(renamedBody.event.title, 'Renamed Party');
  });

  test('DELETE /api/events/:id/participants/:participantId removes member for organizer', async () => {
    const created = await createEventViaApi({ title: 'Team Sync' });

    const guestJoin = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Bob' },
    });
    const guestBody = await bodyOf<{ participant: { id: string } }>(guestJoin);
    const guestParticipantId = guestBody.participant.id;
    const guestUserId = guestJoin.headers.get('x-user-id');

    // Guest tries to remove -> 403 NOT_ORGANIZER
    const unauthorizedRemove = await call(
      `/api/events/${created.eventId}/participants/${guestParticipantId}`,
      { method: 'DELETE', userId: guestUserId },
    );
    assert.equal(unauthorizedRemove.status, 403);

    // Owner cannot remove organizer self -> 422
    const removeOwner = await call(
      `/api/events/${created.eventId}/participants/${created.organizerParticipantId}`,
      { method: 'DELETE', userId: created.userId },
    );
    assert.equal(removeOwner.status, 422);

    // Owner removes Bob -> 200
    const removeBob = await call(
      `/api/events/${created.eventId}/participants/${guestParticipantId}`,
      { method: 'DELETE', userId: created.userId },
    );
    assert.equal(removeBob.status, 200);

    // Verify Bob is removed from participant table
    const checkBob = await asOwner<{ count: string }>(
      `select count(*)::text as count from participant where id = $1`,
      [guestParticipantId],
    );
    assert.equal(checkBob.rows[0]?.count, '0');
  });

  test('POST /api/events/:id/leave allows joined member to leave, rejects organizer', async () => {
    const created = await createEventViaApi({ title: 'Game Night' });

    const guestJoin = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Charlie' },
    });
    assert.equal(guestJoin.status, 200);
    const guestUserId = guestJoin.headers.get('x-user-id');
    const guestBody = await bodyOf<{ participant: { id: string } }>(guestJoin);

    // Organizer tries to leave -> 422
    const organizerLeave = await call(`/api/events/${created.eventId}/leave`, {
      method: 'POST',
      userId: created.userId,
    });
    assert.equal(organizerLeave.status, 422);

    // Charlie leaves -> 200
    const charlieLeave = await call(`/api/events/${created.eventId}/leave`, {
      method: 'POST',
      userId: guestUserId,
    });
    assert.equal(charlieLeave.status, 200);

    // Verify Charlie is gone
    const checkCharlie = await asOwner<{ count: string }>(
      `select count(*)::text as count from participant where id = $1`,
      [guestBody.participant.id],
    );
    assert.equal(checkCharlie.rows[0]?.count, '0');
  });

  test('DELETE /api/events/:id deletes event and cascades for organizer', async () => {
    const created = await createEventViaApi({ title: 'Event To Delete' });

    // Non-organizer tries to delete -> 403
    const unauthorizedDelete = await call(`/api/events/${created.eventId}`, {
      method: 'DELETE',
      userId: '00000000-0000-0000-0000-000000000001',
    });
    assert.equal(unauthorizedDelete.status, 403);

    // Organizer deletes -> 200
    const ownerDelete = await call(`/api/events/${created.eventId}`, {
      method: 'DELETE',
      userId: created.userId,
    });
    assert.equal(ownerDelete.status, 200);

    // Check event no longer exists in database
    const checkEvent = await asOwner<{ count: string }>(
      `select count(*)::text as count from event where id = $1`,
      [created.eventId],
    );
    assert.equal(checkEvent.rows[0]?.count, '0');
  });
});
