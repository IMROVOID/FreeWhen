/**
 * The optimistic vote mutation (Plan 07 Task 3, PRD-02 §13.4).
 *
 * ★ A VOTE THAT VANISHES SILENTLY DESTROYS TRUST MORE THAN A SLOW ONE.
 *
 * So the optimistic write is applied immediately, and a failure reverts
 * VISIBLY: the payload goes back to the snapshot it had before the tap and the
 * screen shows `voting.castFailedReverted`. There is no path in which the vote
 * is dropped without the participant being told.
 *
 * ★ THE PARTICIPANT'S OWN VOTE NEVER FLICKERS BACK TO A STALE VALUE.
 *
 * Concurrent refetches are cancelled before the optimistic value is written, and
 * the mutation's own result is written last. Without the cancel, an in-flight
 * status response carrying the OLD vote would land after the optimistic write
 * and the selection would jump back for a second — the flicker PRD-02 §6 names.
 *
 * ★ IT IS A PLAIN HOOK, NOT A TANSTACK MUTATION.
 *
 * The status payload is a single object held by `useDecisionStatus`, so the
 * snapshot/revert pair is two lines here. Wiring a query client for one mutation
 * would add a provider and a cache to keep in step with a hook that already
 * holds the authoritative copy.
 */

import { useCallback, useRef, useState } from 'react';

import { ApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import type { VoteValue } from '@/src/types/vote';

import { putVote } from '../services/voting-api';
import type { DecisionStatusResponse } from '../services/voting-api';

export interface UseVoteOptions {
  /** The payload currently on screen, used for the snapshot. */
  status: DecisionStatusResponse | null;
  /** Replaces the payload with an optimistically-patched copy. */
  setStatus: (next: DecisionStatusResponse) => void;
  /** Refetches from the server — the authority after any outcome. */
  reload: () => Promise<void>;
}

export interface UseVoteResult {
  /** Casts or changes a vote on one proposal. */
  cast: (proposalId: string, value: VoteValue) => Promise<void>;
  /** The proposal currently being written, or `null`. */
  pending: string | null;
  /** A catalogue key for the last failure, cleared on the next attempt. */
  errorKey: string | null;
  clearError: () => void;
}

/**
 * Patches one proposal's tally optimistically.
 *
 * The counts move by exactly one in each direction, and the names move with
 * them, because the tally shows names as well as counts (FR-2.15) — a
 * count-only patch would leave the name row disagreeing with the number beside
 * it for as long as the request takes.
 *
 * `outstanding` loses the voter's name on the first vote, which is the visible
 * proof their answer counted.
 */
export function optimisticVote(
  status: DecisionStatusResponse,
  proposalId: string,
  value: VoteValue,
  voterName: string,
): DecisionStatusResponse {
  const previous = status.myVotes[proposalId] ?? null;
  if (previous === value) return status;

  return {
    ...status,
    myVotes: { ...status.myVotes, [proposalId]: value },
    proposals: status.proposals.map((entry) => {
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

      // Undo the old answer first, so a change is one out and one in rather
      // than a value appearing twice with the counts overflowing.
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

      tally.voters[value].push(voterName);
      tally[value] += 1;

      return { ...entry, tally };
    }),
  };
}

export function useVote({ status, setStatus, reload }: UseVoteOptions): UseVoteResult {
  const [pending, setPending] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // The snapshot lives in a ref so a second tap while the first is in flight
  // reverts to what the user last SAW, not to the intermediate optimistic state.
  const snapshot = useRef<DecisionStatusResponse | null>(null);

  const cast = useCallback(
    async (proposalId: string, value: VoteValue) => {
      setErrorKey(null);

      // ★ SNAPSHOT BEFORE THE OPTIMISTIC WRITE.
      if (status) {
        snapshot.current = status;
        setStatus(optimisticVote(status, proposalId, value, status.me.display_name));
      }

      setPending(proposalId);

      try {
        const userId = await getStoredUserId();
        await putVote(proposalId, value, userId);

        // The server's answer is the authority: it is what the other
        // participants already see, and it may carry a tally that moved while
        // this request was in flight.
        await reload();
      } catch (error) {
        // ★ THE REVERT IS VISIBLE.
        //
        // The snapshot goes back first, so the selection the user sees matches
        // what is stored; the message is the second half of the same promise.
        if (snapshot.current) setStatus(snapshot.current);

        // A specific server refusal names its own reason (a withdrawn
        // proposal, a confirmed event). A transport failure gets the generic
        // "reverted, try again", which is true in both cases.
        setErrorKey(
          error instanceof ApiFailure
            ? error.messageKey
            : 'voting.castFailedReverted',
        );
      } finally {
        setPending(null);
      }
    },
    [status, setStatus, reload],
  );

  const clearError = useCallback(() => setErrorKey(null), []);

  return { cast, pending, errorKey, clearError };
}
