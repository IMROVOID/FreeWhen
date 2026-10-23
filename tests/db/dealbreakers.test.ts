/**
 * Dealbreakers through the real API (Plan 14 Task 4, PRD-02 FR-2.17, OQ-2.2).
 *
 * ★ THE ROUND TRIP IS THE POINT.
 *
 * The engine filter already reads `dealbreakers` (that is Phase 3's work, and
 * `tests/voting/dealbreakers.test.ts` covers it). What was missing was the WRITE
 * PATH and the way back: a participant marks a veto, it persists on the vote
 * row, and the decision-status payload hands it back so the next render can mute
 * the card. A unit test over the resolver proves none of that — the flag could
 * be dropped by the route, by the upsert, or by the read, and every test would
 * still be green.
 *
 * ★ ONE OUTER SUITE WITH `concurrency: false`, TRUNCATING ONCE.
 *
 * The suites share one database. Node runs sibling `describe` blocks — and tests
 * within one — CONCURRENTLY by default, so a `beforeEach(truncateAll)` in one
 * block deletes the fixtures another block is still using. That surfaces as a
 * `participant_event_id_fkey` violation for a row that existed a moment ago, and
 * reads like a schema bug. `tests/db/jobs.test.ts` establishes the shape used
 * here: one suite, one truncation, sequential bodies.
 *
 * ★ THE THREE PROPERTIES ASSERTED.
 *
 * 1. `is_dealbreaker: true` survives to the `vote` row.
 * 2. Changing the vote to `yes` CLEARS it — a veto cannot outlive the `no` it
 *    was attached to, or the venue stays excluded by someone who now wants it.
 * 3. The veto is per-participant. A guest's veto must not appear in the
 *    organizer's list.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addMember,
  asOwner,
  closePool,
  createUser,
  seedEvent,
  seedVenue,
  truncateAll,
} from './support';
import { bodyOf, call, prepareServerEnv, prepareServerSql } from './server-support';

interface StatusBody {
  proposals: Array<{ proposal: { id: string; title: string } }>;
  myVotes: Record<string, string>;
  myDealbreakers: string[];
}

/** Seeds an OPEN proposal on a venue, returning its id. */
async function seedProposal(eventId: string, proposerId: string, title: string): Promise<string> {
  const venueId = await seedVenue(eventId, { name: `venue-${title}` });

  const row = await asOwner<{ id: string }>(
    `insert into proposal (event_id, created_by, type, title, venue_id, start_utc, end_utc)
     values ($1, $2, 'TIME_AND_PLACE', $3, $4, now() + interval '2 days',
             now() + interval '2 days 2 hours')
     returning id`,
    [eventId, proposerId, title, venueId],
  );

  return row.rows[0]!.id;
}

async function statusFor(eventId: string, userId: string): Promise<StatusBody> {
  const response = await call(`/api/events/${eventId}/decision-status`, { userId });
  assert.equal(response.status, 200);
  return bodyOf<StatusBody>(response);
}

/** Casts a vote, with the veto flag when asked. */
async function vote(
  proposalId: string,
  userId: string,
  value: string,
  isDealbreaker?: boolean,
): Promise<Response> {
  return call(`/api/proposals/${proposalId}/vote`, {
    method: 'PUT',
    userId,
    body: isDealbreaker === undefined ? { value } : { value, is_dealbreaker: isDealbreaker },
  });
}

describe('dealbreakers', { concurrency: false }, () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  before(truncateAll);
  after(closePool);

  test('a veto persists as no + is_dealbreaker on the vote row', async () => {
    // Arrange
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    // Act
    const response = await vote(proposalId, organizerId, 'no', true);
    assert.equal(response.status, 200);

    // Assert
    const stored = await asOwner<{ value: string; is_dealbreaker: boolean }>(
      `select value, is_dealbreaker from vote where proposal_id = $1`,
      [proposalId],
    );

    assert.equal(stored.rows[0]?.value, 'no', 'a veto is a no');
    assert.equal(stored.rows[0]?.is_dealbreaker, true, 'and it carries the flag');
  });

  test('the decision-status payload hands the veto back', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    await vote(proposalId, organizerId, 'no', true);

    const status = await statusFor(eventId, organizerId);

    assert.deepEqual(status.myDealbreakers, [proposalId]);
    assert.equal(status.myVotes[proposalId], 'no');
  });

  test('clearing the flag keeps the no', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    await vote(proposalId, organizerId, 'no', true);

    // Act — the same `no`, without the veto.
    await vote(proposalId, organizerId, 'no', false);

    const status = await statusFor(eventId, organizerId);

    assert.deepEqual(status.myDealbreakers, [], 'the veto is gone');
    assert.equal(status.myVotes[proposalId], 'no', 'the no survives it');
  });

  test('changing the vote to yes clears the veto', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    await vote(proposalId, organizerId, 'no', true);

    // Act — the participant changes their mind and wants to go after all.
    await vote(proposalId, organizerId, 'yes', false);

    const status = await statusFor(eventId, organizerId);

    // ★ A VETO THAT OUTLIVED ITS `no` WOULD EXCLUDE A VENUE THE VOTER SUPPORTS.
    assert.deepEqual(status.myDealbreakers, []);
    assert.equal(status.myVotes[proposalId], 'yes');
  });

  test('a casual no without the flag is not a veto (OQ-2.2)', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    await vote(proposalId, organizerId, 'no');

    const status = await statusFor(eventId, organizerId);

    assert.deepEqual(status.myDealbreakers, [], 'a casual no filters nothing');
    assert.equal(status.myVotes[proposalId], 'no', 'but it is still the stored vote');
  });

  test('a veto is per-participant and does not leak', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    // Sara vetoes.
    const guest = await addMember(eventId, { displayName: 'سارا' });

    await vote(proposalId, guest.userId, 'no', true);

    const organizer = await statusFor(eventId, organizerId);

    assert.deepEqual(
      organizer.myDealbreakers,
      [],
      'the organizer did not cast this veto and must not inherit it',
    );
  });

  test('a non-participant cannot veto', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');

    const outsider = await createUser();
    const response = await vote(proposalId, outsider, 'no', true);

    assert.equal(response.status, 403);

    const stored = await asOwner<{ count: string }>(
      `select count(*)::text as count from vote where proposal_id = $1`,
      [proposalId],
    );
    assert.equal(stored.rows[0]?.count, '0', 'nothing was written');
  });
});
