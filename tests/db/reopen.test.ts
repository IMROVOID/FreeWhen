/**
 * Reopening a confirmed decision (Plan 14 Task 2, PRD-02 FR-2.22, AC-2.6.1).
 *
 * ★ AC-2.6.1 IS THE TEST'S CENTRE: AN EMPTY REASON IS REJECTED.
 *
 * Reopening restarts a vote everyone had finished, so the reason is the thing
 * that makes it explicable rather than chaotic. A server that accepted an empty
 * one would satisfy the UI and defeat the requirement.
 *
 * ★ THE HISTORY SURVIVES (FR-2.22).
 *
 * The decision row is never deleted. `reopened_at` is set and the partial unique
 * index then admits a NEW live decision beside the old one — which is the whole
 * reason the column and the index exist.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { addMember, asOwner, closePool, createUser, seedEvent, seedVenue, truncateAll } from './support';
import { bodyOf, call, prepareServerEnv, prepareServerSql } from './server-support';

/** A live decision, seeded directly so the test exercises the route, not setup. */
async function seedConfirmedDecision(
  eventId: string,
  organizerParticipantId: string,
): Promise<{ proposalId: string; decisionId: string }> {
  const venueId = await seedVenue(eventId, { name: 'کافه دیدار' });

  const proposal = await asOwner<{ id: string }>(
    `insert into proposal (event_id, created_by, type, title, venue_id, start_utc, end_utc, status)
     values ($1, $2, 'TIME_AND_PLACE', 'شام جمعه', $3, now() + interval '2 days',
             now() + interval '2 days 2 hours', 'CHOSEN')
     returning id`,
    [eventId, organizerParticipantId, venueId],
  );
  const proposalId = proposal.rows[0]!.id;

  const decision = await asOwner<{ id: string }>(
    `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
     values ($1, 'place', $2, 'balanced_mean', $3)
     returning id`,
    [eventId, proposalId, organizerParticipantId],
  );

  await asOwner(`update event set status = 'CONFIRMED' where id = $1`, [eventId]);

  return { proposalId, decisionId: decision.rows[0]!.id };
}

describe('AC-2.6.1 — an empty reason is rejected', () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  after(closePool);

  test('an empty reason answers 422 with the field key', async () => {
    // Arrange
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    // Act
    const response = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: '   ' },
      userId: organizerId,
    });

    // Assert
    assert.equal(response.status, 422);
    const body = await bodyOf<{ fields: Record<string, string> }>(response);
    assert.equal(body.fields.reason, 'reopen.validation.reasonRequired');
  });

  test('a missing reason field is rejected the same way', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    const response = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: {},
      userId: organizerId,
    });

    assert.equal(response.status, 422);
  });

  test('after a rejected attempt the decision is still live', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const { decisionId } = await seedConfirmedDecision(eventId, organizerParticipantId);

    await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: '' },
      userId: organizerId,
    });

    const still = await asOwner<{ reopened_at: Date | null }>(
      `select reopened_at from decision where id = $1`,
      [decisionId],
    );

    assert.equal(still.rows[0]?.reopened_at, null, 'a refused reopen changes nothing');
  });
});

describe('FR-2.22 — reopening preserves history', () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  after(closePool);

  test('a valid reason reopens, and the old decision row survives', async () => {
    // Arrange
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const { decisionId, proposalId } = await seedConfirmedDecision(eventId, organizerParticipantId);

    // Act
    const response = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'مکان تعطیل بود' },
      userId: organizerId,
    });

    // Assert
    assert.equal(response.status, 200);

    const body = await bodyOf<{ event_status: string; reopened_proposals: Array<{ id: string; status: string }> }>(
      response,
    );
    assert.equal(body.event_status, 'DECIDING');
    assert.equal(body.reopened_proposals[0]?.status, 'REOPENED');

    const decision = await asOwner<{ reopened_at: Date | null; reopen_reason: string | null }>(
      `select reopened_at, reopen_reason from decision where id = $1`,
      [decisionId],
    );
    assert.ok(decision.rows[0]?.reopened_at, 'the row survives with reopened_at set');
    assert.equal(decision.rows[0]?.reopen_reason, 'مکان تعطیل بود');

    const proposal = await asOwner<{ status: string }>(
      `select status from proposal where id = $1`,
      [proposalId],
    );
    assert.equal(proposal.rows[0]?.status, 'REOPENED', 'the chosen proposal re-enters voting');
  });

  test('the event returns to DECIDING', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'تاریخ اشتباه بود' },
      userId: organizerId,
    });

    const event = await asOwner<{ status: string }>(`select status from event where id = $1`, [eventId]);
    assert.equal(event.rows[0]?.status, 'DECIDING');
  });

  test('the partial unique index admits a new live decision beside the old one', async () => {
    // ★ THIS IS WHY `reopened_at` IS NULLABLE RATHER THAN A DELETE.
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const { proposalId } = await seedConfirmedDecision(eventId, organizerParticipantId);

    await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'دوباره رأی بدهیم' },
      userId: organizerId,
    });

    // A second live decision on the same axis is now legal.
    const inserted = await asOwner<{ id: string }>(
      `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
       values ($1, 'place', $2, 'balanced_mean', $3)
       returning id`,
      [eventId, proposalId, organizerParticipantId],
    );

    assert.ok(inserted.rows[0]?.id);

    const live = await asOwner<{ count: string }>(
      `select count(*)::text as count from decision where event_id = $1 and reopened_at is null`,
      [eventId],
    );
    assert.equal(live.rows[0]?.count, '1', 'exactly one live decision');
  });
});

describe('the reopen is organizer-only and recorded', () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  after(closePool);

  test('a guest cannot reopen a decision they lost', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    const guest = await addMember(eventId, { displayName: 'سارا' });

    const response = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'من نمی‌خواستم' },
      userId: guest.userId,
    });

    assert.equal(response.status, 403);
  });

  test('a non-participant cannot reopen', async () => {
    const { eventId, organizerParticipantId, organizerId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    const stranger = await createUser();
    const response = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'بی‌ربط' },
      userId: stranger,
    });

    assert.equal(response.status, 403);
    assert.notEqual(stranger, organizerId);
  });

  test('the activity log records the reason', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'مکان بسته بود' },
      userId: organizerId,
    });

    const log = await asOwner<{ action: string; detail: { reason?: string } }>(
      `select action, detail from activity_log where event_id = $1 and action = 'reopened'`,
      [eventId],
    );

    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]?.detail.reason, 'مکان بسته بود');
  });

  test('reopening an event with no live decision is a state, not a failure', async () => {
    // The organizer arrived after somebody else reopened.
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    await seedConfirmedDecision(eventId, organizerParticipantId);

    await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'بار اول' },
      userId: organizerId,
    });

    const second = await call(`/api/events/${eventId}/reopen`, {
      method: 'POST',
      body: { reason: 'بار دوم' },
      userId: organizerId,
    });

    assert.equal(second.status, 200);

    const body = await bodyOf<{ already_reopened: boolean }>(second);
    assert.equal(body.already_reopened, true);
  });
});
