/**
 * The event's proposals, kept current (Plan 06 Task 12).
 *
 * ★ REALTIME IS AN OPTIMISATION; POLLING IS THE GUARANTEE.
 *
 * The channel names exist (`event:{id}:proposals`) and the server publishes the
 * `proposal` table, but a client that only listens is a client that shows a
 * frozen list whenever the socket is down — which is most of the time on a
 * mobile connection. This hook therefore polls on an interval and treats a
 * failed refresh as "retrying", never as an error over a list the user can
 * still read.
 *
 * ★ A REFRESH NEVER CLEARS THE LIST.
 *
 * The previous proposals stay on screen while the next fetch is in flight, so a
 * bad connection cannot blank a list the user was reading. That is also why the
 * loading flag is separate from the data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import type { Proposal } from '@/src/types/proposal';

import { listProposals } from '../services/create-proposal';

/**
 * The polling interval, in milliseconds.
 *
 * 10 s is the fallback the plan specifies: fast enough that a proposal made on
 * another device appears while the user is still looking at the screen, slow
 * enough that a background screen does not spend the battery on a list nobody
 * is reading.
 */
export const POLL_INTERVAL_MS = 10_000;

export interface UseProposalsResult {
  proposals: Proposal[];
  isLoading: boolean;
  /** A catalogue key, or `null`. */
  errorKey: string | null;
  /** True while a refresh has failed and a retry is pending — non-blocking. */
  isReconnecting: boolean;
  reload: () => Promise<void>;
  /** Replaces one proposal in place, after an edit or a withdrawal. */
  replace: (proposal: Proposal) => void;
  /** Appends a newly created proposal without a refetch. */
  append: (proposal: Proposal) => void;
}

export function useProposals(eventId: string): UseProposalsResult {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const mounted = useRef(true);
  // The first load shows a skeleton; every later refresh does not.
  const loadedOnce = useRef(false);

  const reload = useCallback(async () => {
    if (!loadedOnce.current) setIsLoading(true);

    try {
      const userId = await getStoredUserId();
      const loaded = await listProposals(eventId, userId);

      if (!mounted.current) return;

      setProposals(loaded);
      setErrorKey(null);
      setIsReconnecting(false);
      loadedOnce.current = true;
    } catch (error) {
      if (!mounted.current) return;

      // A 403 means the caller is not a participant. An empty list is the
      // honest answer there — an error banner over data they may not see would
      // only invite them to retry something that cannot succeed.
      if (isApiFailure(error) && error.status === 403) {
        setProposals([]);
        setErrorKey(null);
        return;
      }

      // ★ A FAILED REFRESH KEEPS THE LIST.
      //
      // The user is still reading it, and the alternative is a blank screen
      // that says nothing about what they were looking at a second ago.
      setIsReconnecting(true);
      if (!loadedOnce.current) setErrorKey('proposals.list.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    mounted.current = true;
    loadedOnce.current = false;
    void reload();

    const timer = setInterval(() => {
      void reload();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [reload]);

  const replace = useCallback((updated: Proposal) => {
    setProposals((current) =>
      current.map((proposal) => (proposal.id === updated.id ? updated : proposal)),
    );
  }, []);

  const append = useCallback((created: Proposal) => {
    // Creation order is the list's order (FR-2.4), so a new row goes last.
    setProposals((current) =>
      current.some((proposal) => proposal.id === created.id) ? current : [...current, created],
    );
  }, []);

  return { proposals, isLoading, errorKey, isReconnecting, reload, replace, append };
}
