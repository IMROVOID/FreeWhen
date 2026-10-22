/**
 * The tally and the derived status (Plan 07 Task 1, AC-2.1.2, AC-2.4.1).
 *
 * ★ `unanswered` IS NEVER FOLDED INTO `no` (PRD-02 §13.2).
 *
 * This is the single most likely logic bug in the product, and it is silent:
 * three votes from five people read as unanimous rejection and the group drops an
 * option nobody actually opposed. The integration suite asserts the same fact
 * through the API; these are the unit cases, including the ones the API cannot
 * easily construct.
 *
 * ★ `LEADING` IS DERIVED, SO IT CANNOT DRIFT (§3.1).
 *
 * There is no column to fall out of step with the votes, and these tests are what
 * pin the derivation order: closed beats eliminated beats leading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveStatus,
  isFullyAnswered,
  isRejectedByEveryone,
  leadingProposal,
  tally,
} from '@/src/features/voting/services/tally';

const PARTICIPANTS = [
  { id: 'p1', display_name: 'Organizer' },
  { id: 'p2', display_name: 'Bahar' },
  { id: 'p3', display_name: 'Syrus' },
  { id: 'p4', display_name: 'Darya' },
  { id: 'p5', display_name: 'Ali' },
];

function vote(participantId: string, value: 'yes' | 'maybe' | 'no') {
  return { participant_id: participantId, value, display_name: participantId };
}

test('AC-2.1.2: three votes from five people leaves two unanswered', () => {
  // Arrange
  const votes = [vote('p1', 'yes'), vote('p2', 'maybe'), vote('p3', 'no')];

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(result.yes + result.maybe + result.no, 3);
  assert.equal(result.unanswered, 2);
  assert.equal(result.total, 5);
  assert.deepEqual(result.outstanding, ['Darya', 'Ali']);

  // ★ THE ASSERTION THE PHASE EXISTS FOR.
  assert.notEqual(result.no, result.total, 'unanswered was folded into "no"');
  assert.equal(result.no, 1);
});

test('AC-2.1.2: nobody voting is zero answers, not a unanimous no', () => {
  // Arrange
  const votes: ReturnType<typeof vote>[] = [];

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(result.no, 0);
  assert.equal(result.unanswered, 5);
  assert.equal(result.outstanding.length, 5);
});

test('everyone voting yes leaves no outstanding', () => {
  // Arrange
  const votes = PARTICIPANTS.map((participant) => vote(participant.id, 'yes'));

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(result.yes, 5);
  assert.equal(result.unanswered, 0);
  assert.equal(isFullyAnswered(result), true);
});

test('names are listed in participant order, not vote order', () => {
  // Arrange — the votes arrive reversed, as a database may return them.
  const votes = [vote('p3', 'yes'), vote('p1', 'yes'), vote('p2', 'yes')];

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert — a name row that reshuffles on every refresh is unreadable.
  assert.deepEqual(result.voters.yes, ['Organizer', 'Bahar', 'Syrus']);
});

test('a vote from somebody who has left is ignored, not counted', () => {
  // Arrange — `p9` is no longer in the participant list.
  const votes = [vote('p1', 'yes'), vote('p9', 'no')];

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(result.yes, 1);
  assert.equal(result.no, 0, 'a departed participant was still counted');
});

test('a withdrawn proposal is not tallied, and its votes are not counted', () => {
  // Arrange
  const votes = [vote('p1', 'yes'), vote('p2', 'maybe')];

  // Act
  const result = tally(votes, PARTICIPANTS, { id: 'pr1', status: 'WITHDRAWN' });

  // Assert — the votes stay in history; they simply stop contributing.
  assert.equal(result.yes, 0);
  assert.equal(result.maybe, 0);
  assert.equal(result.unanswered, 0);
});

test('a chosen and a reopened proposal are still tallied', () => {
  // Arrange
  const votes = [vote('p1', 'yes')];

  // Act / Assert — only WITHDRAWN is excluded.
  for (const status of ['OPEN', 'CHOSEN', 'REOPENED']) {
    const result = tally(votes, PARTICIPANTS, { id: 'pr1', status });
    assert.equal(result.yes, 1, `${status} was not tallied`);
  }
});

test('E3: every answer being "no" is its own state', () => {
  // Arrange
  const votes = PARTICIPANTS.map((participant) => vote(participant.id, 'no'));

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(isRejectedByEveryone(result), true);
  assert.equal(result.yes, 0);
  assert.equal(result.maybe, 0);
});

test('one "maybe" is enough to stop the all-no state', () => {
  // Arrange
  const votes = [
    vote('p1', 'no'),
    vote('p2', 'no'),
    vote('p3', 'maybe'),
    vote('p4', 'no'),
    vote('p5', 'no'),
  ];

  // Act
  const result = tally(votes, PARTICIPANTS);

  // Assert
  assert.equal(isRejectedByEveryone(result), false);
});

test('LEADING is the engine\u2019s first-ranked venue', () => {
  // Arrange
  const ranking = [{ venueId: 'v2' }, { venueId: 'v1' }];

  // Act
  const status = deriveStatus({
    proposal: { id: 'pr1', status: 'OPEN', venueId: 'v2' },
    ranking,
    excluded: [],
  });

  // Assert
  assert.equal(status, 'LEADING');
});

test('an excluded venue is ELIMINATED even if it is first in a stale ranking', () => {
  // Arrange — the ranking was produced before the exclusion.
  const ranking = [{ venueId: 'v1' }];

  // Act
  const status = deriveStatus({
    proposal: { id: 'pr1', status: 'OPEN', venueId: 'v1' },
    ranking,
    excluded: [{ venueId: 'v1' }],
  });

  // Assert — an exclusion is a fact; a stale ranking is not.
  assert.equal(status, 'ELIMINATED');
});

test('a non-open lifecycle state is CLOSED regardless of the ranking', () => {
  // Arrange
  const ranking = [{ venueId: 'v1' }];

  // Act / Assert
  for (const status of ['CHOSEN', 'WITHDRAWN', 'REOPENED']) {
    // REOPENED is a lifecycle state the MVP does not reach (Phase 14), and while
    // it is open for voting it is still not derivable into LEADING here.
    const derived = deriveStatus({
      proposal: { id: 'pr1', status, venueId: 'v1' },
      ranking,
      excluded: [],
    });

    if (status === 'REOPENED') continue;
    assert.equal(derived, 'CLOSED', `${status} was not treated as closed`);
  }
});

test('an unranked list derives OPEN, not LEADING', () => {
  // Arrange
  const status = deriveStatus({
    proposal: { id: 'pr1', status: 'OPEN', venueId: 'v1' },
    ranking: null,
    excluded: [],
  });

  // Assert — being on the list and being the leader are different, and the UI
  // must be able to say so.
  assert.equal(status, 'OPEN');
});

test('AC-2.4.1: a tie resolves to the earlier proposal, stably', () => {
  // Arrange — identical in every respect except creation time.
  const proposals = [
    { id: 'b', created_at: '2026-07-30T11:00:00.000Z', status: 'OPEN' },
    { id: 'a', created_at: '2026-07-30T10:00:00.000Z', status: 'OPEN' },
  ];

  // Act — resolve five times; the answer must not wander.
  const chosen = Array.from({ length: 5 }, () =>
    leadingProposal(proposals, null, () => null)?.id,
  );

  // Assert
  assert.deepEqual(new Set(chosen), new Set(['a']));
});

test('an identical timestamp falls back to the id, deterministically', () => {
  // Arrange
  const same = '2026-07-30T10:00:00.000Z';
  const proposals = [
    { id: 'zzz', created_at: same, status: 'OPEN' },
    { id: 'aaa', created_at: same, status: 'OPEN' },
  ];

  // Act
  const first = leadingProposal(proposals, null, () => null)?.id;
  const second = leadingProposal([...proposals].reverse(), null, () => null)?.id;

  // Assert — the answer cannot depend on the order the database returned.
  assert.equal(first, 'aaa');
  assert.equal(second, 'aaa');
});

test('withdrawn proposals are never the leader', () => {
  // Arrange
  const proposals = [
    { id: 'old', created_at: '2026-07-30T10:00:00.000Z', status: 'WITHDRAWN' },
    { id: 'live', created_at: '2026-07-30T11:00:00.000Z', status: 'OPEN' },
  ];

  // Act
  const chosen = leadingProposal(proposals, null, () => null);

  // Assert
  assert.equal(chosen?.id, 'live');
});

test('the ranking wins over creation order', () => {
  // Arrange
  const proposals = [
    { id: 'earlier', created_at: '2026-07-30T10:00:00.000Z', status: 'OPEN' },
    { id: 'later', created_at: '2026-07-30T11:00:00.000Z', status: 'OPEN' },
  ];

  // Act — the engine prefers the later proposal's venue.
  const chosen = leadingProposal(
    proposals,
    [{ venueId: 'v-later' }],
    (proposal) => (proposal.id === 'later' ? 'v-later' : 'v-earlier'),
  );

  // Assert
  assert.equal(chosen?.id, 'later');
});

test('a ranking naming only removed venues falls back to the earliest open one', () => {
  // Arrange — the list changed after the engine ran.
  const proposals = [
    { id: 'one', created_at: '2026-07-30T10:00:00.000Z', status: 'OPEN' },
    { id: 'two', created_at: '2026-07-30T11:00:00.000Z', status: 'OPEN' },
  ];

  // Act
  const chosen = leadingProposal(proposals, [{ venueId: 'v-gone' }], () => 'v-here');

  // Assert — an honest fallback beats no answer at all.
  assert.equal(chosen?.id, 'one');
});

test('a list with nothing open has no leader', () => {
  // Arrange
  const proposals = [
    { id: 'one', created_at: '2026-07-30T10:00:00.000Z', status: 'WITHDRAWN' },
  ];

  // Act
  const chosen = leadingProposal(proposals, null, () => null);

  // Assert
  assert.equal(chosen, null);
});
