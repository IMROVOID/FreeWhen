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

  const reload = useCallback(async () => {
    if (!loadedOnce.current) setIsLoading(true);

    try {
      const userId = await getStoredUserId();
      const loaded = await fetchDecisionStatus(eventId, userId, openedAt.current);

      if (!mounted.current) return;

      setStatus(loaded);
      setErrorKey(null);
      loadedOnce.current = true;
    } catch (error) {
      if (!mounted.current) return;

      // 403 means the caller is not a participant. An empty answer is the
      // honest one there, and a banner would invite a retry that cannot work.
      if (isApiFailure(error) && error.status === 403) {
        setStatus(null);
        setErrorKey(null);
        return;
      }

      // ★ THE LAST GOOD TALLY STAYS ON SCREEN.
      if (!loadedOnce.current) setErrorKey('decision.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    mounted.current = true;
    loadedOnce.current = false;
    openedAt.current = new Date().toISOString();
    void reload();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const { connection } = useRealtime({
    eventId,
    refetch: () => {
      void reload();
    },
    subscribe,
    intervalMs,
    enabled,
  });

  return { status, isLoading, errorKey, connection, reload };
}
