/**
 * The comment delete policy, as a NON-SUPERUSER (Plan 14 Task 5, PRD-02 §4.3).
 *
 * ★ THIS IS THE TEST THE API SUITE CANNOT BE.
 *
 * `tests/db/comments.test.ts` proves the ROUTE authorizes correctly — but the
 * route runs on the service role, which bypasses RLS entirely. A missing delete
 * policy would leave every one of those tests green while a client's own delete
 * matched zero rows. That is exactly what happened: migration 011 wrote read and
 * insert policies for `comment` and no delete policy, so the table-level
 * `grant delete` was inert and "the organizer can delete" was unreachable.
 *
 * ★ SO THIS SUITE ISSUES THE DELETE ITSELF, AS `authenticated`, WITH CLAIMS SET.
 *
 * Same mechanism as the RLS suite: `openSession` sets `request.jwt.claims` and
 * `set role authenticated`, so `auth.uid()` resolves and the policy is genuinely
 * in force. The assertion is on the ROW COUNT, not on an exception — a denied
 * delete matches nothing rather than raising.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addMember,
  asOwner,
  closePool,
  closeSession,
  openSession,
  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
} from './support';
import { prepareServerEnv, prepareServerSql } from './server-support';

/**
 * Seeds a proposal that satisfies `place_has_venue`.
 *
 * `seedProposal`'s default type is `PLACE`, which migration 006 requires to carry
 * a `venue_id` — so a bare call violates the check constraint. Giving it a venue
 * keeps the fixture honest about the schema rather than weakening the test.
 */
async function seedPlaceProposal(eventId: string, proposerId: string): Promise<string> {
  const venueId = await seedVenue(eventId, { name: 'کافه دیدار' });

  return seedProposal(eventId, proposerId, { type: 'PLACE', venueId });
}

/** Seeds one comment by `authorParticipantId`, as the owner. */
async function seedComment(
  proposalId: string,
  authorParticipantId: string,
  body: string,
): Promise<string> {
  const row = await asOwner<{ id: string }>(
    `insert into comment (proposal_id, participant_id, body)
     values ($1, $2, $3)
     returning id`,
    [proposalId, authorParticipantId, body],
  );

  return row.rows[0]!.id;
}

/**
 * Deletes a comment as an authenticated participant.
 *
 * Returns the number of rows actually removed — the assertion, because RLS
 * denies by matching nothing.
 */
async function deleteAs(userId: string, commentId: string): Promise<number> {
  const session = await openSession(userId, { isAnonymous: false });

  try {
    const result = await session.query(`delete from comment where id = $1`, [commentId]);
    return result.rowCount;
  } finally {
    await closeSession(session);
  }
}

describe('the comment delete policy holds as a non-superuser', { concurrency: false }, () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  // Truncate ONCE, at the start — the same shape as `tests/db/rls.test.ts`.
  //
  // ★ NOT `beforeEach`. Tests within a suite run concurrently, so a per-test
  // truncation deletes fixtures a sibling is still using and the victim reports
  // a foreign-key error that reads like a schema bug. Each test below creates
  // its own event and asserts on its own ids, so one reset is enough — and the
  // next suite's own `beforeEach(truncateAll)` clears what these leave behind.
  before(truncateAll);
  // ★ AND ONCE AT THE END, SO THIS SUITE LEAVES NOTHING BEHIND.
  //
  // `rls.test.ts` relies on the next file's `beforeEach` to clean up after it.
  // That only works when the next file truncates; a suite that counts rows
  // before its own truncation sees these fixtures and fails for a reason that
  // has nothing to do with the code under test. Cleaning up here makes the
  // suite self-contained.
  after(closePool);

  test('the author may delete their own comment', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedPlaceProposal(eventId, organizerParticipantId);
    const commentId = await seedComment(proposalId, organizerParticipantId, 'اینو پاک می‌کنم');

    // Act — the organizer IS the author here.
    const removed = await deleteAs(organizerId, commentId);

    assert.equal(removed, 1, 'the policy allowed the author');
  });

  test('the organizer may delete someone else’s comment', async () => {
    // Arrange — a guest writes it, the organizer removes it.
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedPlaceProposal(eventId, organizerParticipantId);
    const guest = await addMember(eventId, { displayName: 'سارا' });
    const commentId = await seedComment(proposalId, guest.participantId, 'یک نظر');

    // Act
    const removed = await deleteAs(organizerId, commentId);

    // Assert
    assert.equal(removed, 1, 'the organizer arm of the policy matched');
  });

  test('a peer may NOT delete someone else’s comment', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedPlaceProposal(eventId, organizerParticipantId);
    const sara = await addMember(eventId, { displayName: 'سارا' });
    const darya = await addMember(eventId, { displayName: 'دریا' });
    const commentId = await seedComment(proposalId, sara.participantId, 'نظر سارا');

    // Act — a fellow guest.
    const removed = await deleteAs(darya.userId, commentId);

    // ★ ZERO ROWS, NOT AN ERROR. A refused delete matches nothing.
    assert.equal(removed, 0, 'a peer is neither the author nor the organizer');

    // And the row is still there — the denial was real, not a no-op test.
    const still = await asOwner<{ count: string }>(
      `select count(*)::text as count from comment where id = $1`,
      [commentId],
    );
    assert.equal(still.rows[0]?.count, '1');
  });

  test('a participant of a DIFFERENT event may not delete it', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedPlaceProposal(eventId, organizerParticipantId);
    const commentId = await seedComment(proposalId, organizerParticipantId, 'یک نظر');

    // A participant of some other event, so the identity resolves but the row is
    // not theirs.
    const other = await seedEvent({ title: 'Another event' });
    const outsider = await addMember(other.eventId, { displayName: 'غریبه' });

    const removed = await deleteAs(outsider.userId, commentId);

    assert.equal(removed, 0);
  });

  test('the author may still read the comments after the policy runs', async () => {
    // A sanity check on the read policy, so a failure above is attributable to
    // DELETE and not to a session that cannot see the table at all.
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedPlaceProposal(eventId, organizerParticipantId);
    await seedComment(proposalId, organizerParticipantId, 'قابل خواندن');

    const session = await openSession(organizerId, { isAnonymous: false });

    try {
      const result = await session.query<{ body: string }>(
        `select body from comment where proposal_id = $1`,
        [proposalId],
      );

      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0]?.body, 'قابل خواندن');
    } finally {
      await closeSession(session);
    }
  });
});
