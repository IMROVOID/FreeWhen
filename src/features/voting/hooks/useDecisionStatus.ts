/**
 * The Decision Status payload, kept current (Plan 07 Task 4).
 *
 * ★ A FAILED REFRESH KEEPS THE TALLY.
 *
 * Same rule as `useProposals`: the last good payload stays on screen and a bad
 * connection is a status line, never an empty panel. A status area that blanked
 * on a dropped request would read as "the group has no options" — the exact
 * misreading this phase exists to prevent.
 *
 * ★ THE FIRST LOAD SHOWS A SKELETON; LATER LOADS DO NOT.
 *
 * The timestamp of the first request is sent as `opened_at`, so the server can
 * measure how long the area took to become useful rather than how long the app
 * had been warm (PRD-02 §9 `decision_status_viewed`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';

import {
  fetchDecisionStatus,
  type DecisionStatusResponse,
} from '../services/voting-api';
import { useRealtime, type ConnectionState, type Subscribe } from './useRealtime';

export interface UseDecisionStatusResult {
  status: DecisionStatusResponse | null;
  isLoading: boolean;
  /** A catalogue key, or `null`. */
  errorKey: string | null;
  connection: ConnectionState;
  reload: () => Promise<void>;
}

export interface UseDecisionStatusOptions {
  eventId: string;
  /** Injected in the tests; omitted in the app, where the poll carries it. */
  subscribe?: Subscribe;
  intervalMs?: number;
  enabled?: boolean;
}

export function useDecisionStatus({
  eventId,
  subscribe,
  intervalMs,
  enabled = true,
}: UseDecisionStatusOptions): UseDecisionStatusResult {
  const [status, setStatus] = useState<DecisionStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mounted = useRef(true);
  const loadedOnce = useRef(false);
  const openedAt = useRef(new Date().toISOString());

  /**
   * The outcome of the last reload, for the poller's backoff.
   *
   * `reload` is async and the poller's `refetch` is synchronous, so the result is
   * left here and read after the fact. `null` means "no request has finished
   * yet", which the engine treats as healthy.
   */
  const lastFailed = useRef<boolean | null>(null);

  /**
   * Set once `useRealtime` has created its engine, so `reload` can report the
   * outcome of a poll-driven request.
   *
   * A ref because `reload` is memoised on `eventId` alone — capturing the
   * reporter would rebuild it on every render and restart the poll.
   */
  const reportRef = useRef<((failed: boolean) => void) | null>(null);

  /**
   * Whether the in-flight reload was started by the poll.
   *
   * Only a poll-driven attempt feeds the backoff curve. `reload` is also called
   * on mount and when the socket reconnects, and counting those would let a
   * single manual retry reset a backoff the poll had earned — the cadence would
   * oscillate instead of converging.
   */
  const fromPoll = useRef(false);

  const reload = useCallback(async (opts?: { fromPoll?: boolean }) => {
    if (opts?.fromPoll) fromPoll.current = true;
    if (!loadedOnce.current) setIsLoading(true);

    try {
      const userId = await getStoredUserId();
      const loaded = await fetchDecisionStatus(eventId, userId, openedAt.current);

      if (!mounted.current) return;

      setStatus(loaded);
      setErrorKey(null);
      loadedOnce.current = true;
      lastFailed.current = false;
    } catch (error) {
      if (!mounted.current) return;

      // 403 means the caller is not a participant. An empty answer is the
      // honest one there, and a banner would invite a retry that cannot work —
      // but it is not a server failure either, so the poll keeps its cadence.
      if (isApiFailure(error) && error.status === 403) {
        setStatus(null);
        setErrorKey(null);
        lastFailed.current = false;
        return;
      }

      // ★ THE LAST GOOD TALLY STAYS ON SCREEN.
      if (!loadedOnce.current) setErrorKey('decision.loadFailed');
      lastFailed.current = true;
    } finally {
      if (mounted.current) {
        setIsLoading(false);

        // ★ ONLY THE POLL'S OWN ATTEMPT FEEDS THE CURVE.
        if (fromPoll.current) {
          fromPoll.current = false;
          reportRef.current?.(lastFailed.current === true);
        }
      }
    }
  }, [eventId]);

  useEffect(() => {
    mounted.current = true;
    loadedOnce.current = false;
    openedAt.current = new Date().toISOString();
    lastFailed.current = null;
    void reload();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  /**
   * Set once `useRealtime` has created its engine, so `reload` can report the
   * outcome of the request it just made.
   *
   * A ref because `reload` is memoised on `eventId` alone — capturing the
   * reporter would rebuild it on every render and restart the poll.
   */
  const { connection, reportPollResult } = useRealtime({
    eventId,
    refetch: () => {
      void reload({ fromPoll: true });
    },
    subscribe,
    intervalMs,
    enabled,
  });

  reportRef.current = reportPollResult;

  return { status, isLoading, errorKey, connection, reload };
}
