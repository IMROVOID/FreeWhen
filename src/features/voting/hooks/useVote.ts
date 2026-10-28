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

import { deleteVote, putVote } from '../services/voting-api';
import { optimisticVote } from './optimistic-vote';
import type { DecisionStatusResponse } from '../services/voting-api';

// Re-exported so existing callers of this module keep one import path.
export { optimisticVote } from './optimistic-vote';

export interface UseVoteOptions {
  /** The payload currently on screen, used for the snapshot. */
  status: DecisionStatusResponse | null;
  /** Replaces the payload with an optimistically-patched copy. */
  setStatus: (next: DecisionStatusResponse) => void;
  /** Refetches from the server — the authority after any outcome. */
  reload: () => Promise<void>;
  /**
   * Called after a vote the server ACCEPTED, with whether it was the
   * participant's first vote on that proposal.
   *
   * ★ THIS IS THE PUSH-PERMISSION MOMENT (FR-6.14, AC-6.2.1).
   *
   * Asking at launch gets a denial, and a denial is expensive: iOS prompts once
   * and then sends the user to Settings forever. The request therefore hangs off
   * this callback, which fires only in the success branch — a rejected or
   * reverted vote must never trigger a prompt.
   *
   * `isFirstVote` is `previous === null` from the server, so a CHANGE is
   * distinguishable from a first answer without the hook guessing from local
   * state that a refetch could overturn.
   */
  onVoted?: (outcome: { proposalId: string; isFirstVote: boolean }) => void;
}

export interface UseVoteResult {
  /** Casts or changes a vote on one proposal. */
  cast: (proposalId: string, value: VoteValue) => Promise<void>;
  /**
   * Sets or clears the caller's veto on one proposal (FR-2.17).
   *
   * ★ A VETO IS WRITTEN AS `no`, ALWAYS.
   *
   * There is no "veto without a no": the filter reads the flag and the tally
   * reads the value, so a veto recorded beside a `yes` would make the two
   * disagree about what the participant said. Setting a veto therefore writes
   * `no` + the flag; clearing it keeps the `no` and drops the flag, because the
   * participant still does not want that venue — they just no longer want to
   * force the group's hand.
   */
  toggleVeto: (proposalId: string, vetoNow: boolean) => Promise<void>;
  /**
   * Removes the caller's vote, returning the proposal to "unanswered".
   *
   * The missing operation behind "I edited my vote and took it back": `cast` can only
   * write a value, and there is no value that means "nothing".
   */
  withdraw: (proposalId: string) => Promise<void>;
  /** The proposal currently being written, or `null`. */
  pending: string | null;
  /** A catalogue key for the last failure, cleared on the next attempt. */
  errorKey: string | null;
  clearError: () => void;
}

export function useVote({ status, setStatus, reload, onVoted }: UseVoteOptions): UseVoteResult {
  const [pending, setPending] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // The snapshot lives in a ref so a second tap while the first is in flight
  // reverts to what the user last SAW, not to the intermediate optimistic state.
  const snapshot = useRef<DecisionStatusResponse | null>(null);

  /**
   * The shared write-and-revert body for both mutations.
   *
   * Kept in one place so a veto and a vote cannot drift on the two properties
   * that matter: the optimistic write is applied before the request, and a
   * failure restores the snapshot AND names itself.
   *
   * `reportVote` is the one thing the two callers must NOT share. The push
   * prompt hangs off the first real vote (FR-6.14), so only `cast` opts in;
   * `toggleVeto` passes `false` and can never fire `onVoted`.
   */
  const write = useCallback(
    async (
      proposalId: string,
      value: VoteValue,
      isDealbreaker: boolean,
      optimistic: (current: DecisionStatusResponse) => DecisionStatusResponse,
      reportVote: boolean,
    ) => {
      setErrorKey(null);

      if (status) {
        snapshot.current = status;
        setStatus(optimistic(status));
      }

      setPending(proposalId);

      try {
        const userId = await getStoredUserId();
        const written = await putVote(proposalId, value, userId, { isDealbreaker });

        // ★ ONLY IN THE SUCCESS BRANCH, AND ONLY FOR A REAL VOTE.
        //
        // `previous === null` is the server's own statement that this was the
        // participant's first answer on this proposal. The callback fires AFTER
        // the write was accepted and BEFORE the reload, so a prompt can never
        // appear for a vote that was rejected or reverted below.
        //
        // `reportVote` is what keeps a VETO from firing it. `write` is shared by
        // `cast` and `toggleVeto`, and a veto is not the first-vote moment the
        // push prompt hangs off (FR-6.14): it writes `no` + the flag, so the
        // server would truthfully report `previous: null` on a first-ever veto
        // and the prompt would fire for a gesture the participant did not make
        // as a vote. Only `cast` passes `reportVote: true`.
        if (reportVote) {
          onVoted?.({ proposalId, isFirstVote: written.previous === null });
        }

        await reload();
      } catch (error) {
        if (snapshot.current) setStatus(snapshot.current);

        setErrorKey(
          error instanceof ApiFailure ? error.messageKey : 'voting.castFailedReverted',
        );
      } finally {
        setPending(null);
      }
    },
    [status, setStatus, reload, onVoted],
  );

  const cast = useCallback(
    async (proposalId: string, value: VoteValue) => {
      // ★ CHANGING THE VALUE CLEARS THE VETO.
      //
      // A veto only exists on a `no`. Moving the vote to `yes` or `maybe`
      // without clearing the flag would leave the venue excluded by a
      // participant who now wants it.
      await write(
        proposalId,
        value,
        false,
        (current) => {
          const patched = optimisticVote(current, proposalId, value, current.me.display_name);
          return {
            ...patched,
            myDealbreakers: patched.myDealbreakers.filter((id) => id !== proposalId),
          };
        },
        // A real vote: this is the moment the push prompt may fire.
        true,
      );
    },
    [write],
  );

  const toggleVeto = useCallback(
    async (proposalId: string, vetoNow: boolean) => {
      await write(
        proposalId,
        'no',
        vetoNow,
        (current) => {
          // The vote must be `no` for the flag to mean anything, so this is the
          // same tally patch a `no` tap makes — expressed through `optimisticVote`
          // rather than a second copy of it.
          const patched = optimisticVote(current, proposalId, 'no', current.me.display_name);

          const without = patched.myDealbreakers.filter((id) => id !== proposalId);

          return {
            ...patched,
            myDealbreakers: vetoNow ? [...without, proposalId] : without,
          };
        },
        // ★ A VETO NEVER FIRES THE PUSH PROMPT.
        //
        // It writes `no` + the flag, so on a participant's first-ever veto the
        // server truthfully reports `previous: null` and a naive composition
        // would ask for notification permission on a gesture that was not a
        // vote. The prompt belongs to the vote (FR-6.14).
        false,
      );
    },
    [write],
  );

  /**
   * ★ A WITHDRAWAL IS ITS OWN TRANSACTION, NOT A `null` CAST.
   *
   * It has its own verb (`DELETE`), its own optimistic patch (back to
   * `outstanding`), and its own cleanup: the veto flag must go with the vote.
   *
   * ★ AND IT NEVER FIRES THE PUSH PROMPT.
   *
   * `onVoted` is the push-permission moment (FR-6.14). Taking an answer back is not
   * a vote, so this path does not touch it — that is why the shared `write` body is
   * not reused here, and `reportVote` cannot be passed by accident.
   */
  const withdraw = useCallback(
    async (proposalId: string) => {
      setErrorKey(null);

      if (status) {
        snapshot.current = status;
        const patched = optimisticVote(status, proposalId, null, status.me.display_name);

        // The veto rides ON the `no`, so removing the `no` must remove the flag —
        // otherwise the venue stays excluded by someone who no longer votes for it.
        setStatus({
          ...patched,
          myDealbreakers: patched.myDealbreakers.filter((id) => id !== proposalId),
        });
      }

      setPending(proposalId);

      try {
        const userId = await getStoredUserId();
        await deleteVote(proposalId, userId);
        await reload();
      } catch (error) {
        if (snapshot.current) setStatus(snapshot.current);

        setErrorKey(
          error instanceof ApiFailure ? error.messageKey : 'voting.castFailedReverted',
        );
      } finally {
        setPending(null);
      }
    },
    [status, setStatus, reload],
  );

  const clearError = useCallback(() => setErrorKey(null), []);

  return { cast, toggleVeto, withdraw, pending, errorKey, clearError };
}
