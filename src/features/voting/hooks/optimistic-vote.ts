/**
 * The optimistic tally patch for a vote, a change, or a withdrawal.
 *
 * ★ PURE, AND SEPARATE FROM THE HOOK ON PURPOSE.
 *
 * This is the one part of voting a test can drive without a React renderer or the
 * React Native runtime, and it is also the part most likely to be subtly wrong — a
 * withdrawal is NOT the inverse of a cast (see below). It lives here so
 * `tests/voting/withdraw.test.ts` can call it directly.
 */

import type { VoteValue } from '@/src/types/vote';

import type { DecisionStatusResponse } from '../services/voting-api';
/**
 * Patches one proposal's tally optimistically.
 *
 * `value === null` means the caller is WITHDRAWING. That is deliberately not
 * expressed as the inverse of a cast: a cast moves the voter out of `outstanding`
 * into a bucket, and a withdrawal has to put them back — decrementing the bucket,
 * incrementing `unanswered`, re-appending the name to `outstanding` and deleting the
 * `myVotes` key. Getting any of those wrong leaves the card drawing no selection
 * while the tally still counts one, which is the defect this pair of functions
 * exists to prevent.
 *
 * The counts move by exactly one in each direction, and the names move with them,
 * because the tally shows names as well as counts (FR-2.15) — a count-only patch
 * would leave the name row disagreeing with the number beside it for as long as the
 * request takes.
 *
 * `outstanding` loses the voter's name on the first vote, which is the visible proof
 * their answer counted, and regains it on a withdrawal.
 */
export function optimisticVote(
  status: DecisionStatusResponse,
  proposalId: string,
  value: VoteValue | null,
  voterName: string,
): DecisionStatusResponse {
  const previous = status.myVotes[proposalId] ?? null;

  // Nothing to do: re-tapping the current answer, or withdrawing when no vote exists.
  if (previous === value) return status;

  const proposals = status.proposals.map((entry) => {
    if (entry.proposal.id !== proposalId) return entry;

    const tally = {
      ...entry.tally,
      voters: {
        yes: [...entry.tally.voters.yes],
        maybe: [...entry.tally.voters.maybe],
        no: [...entry.tally.voters.no],
      },
      outstanding: [...entry.tally.outstanding],
    };

    // Undo the old answer first, so a change is one out and one in rather than a
    // value appearing twice with the counts overflowing.
    if (previous) {
      const list = tally.voters[previous];
      const index = list.indexOf(voterName);
      if (index >= 0) list.splice(index, 1);
      tally[previous] = Math.max(0, tally[previous] - 1);
    } else {
      const index = tally.outstanding.indexOf(voterName);
      if (index >= 0) tally.outstanding.splice(index, 1);
      tally.unanswered = Math.max(0, tally.unanswered - 1);
    }

    if (value === null) {
      // ★ A WITHDRAWAL LEAVES THE VOTER UNANSWERED, NOT "NO".
      //
      // Silence and a `no` are different answers, and the ranking treats a `no` as
      // dissent — so returning to `outstanding` is the only correct resting state.
      if (!tally.outstanding.includes(voterName)) tally.outstanding.push(voterName);
      tally.unanswered += 1;
    } else {
      tally.voters[value].push(voterName);
      tally[value] += 1;
    }

    return { ...entry, tally };
  });

  const myVotes = { ...status.myVotes };

  if (value === null) {
    delete myVotes[proposalId];
  } else {
    myVotes[proposalId] = value;
  }

  return { ...status, myVotes, proposals };

}
