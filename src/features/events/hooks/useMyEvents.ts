/**
 * S1's data (Plan 05 Task 6).
 *
 * ★ THE ATTENTION BADGE IS THE POINT OF THIS HOOK.
 *
 * Push notifications are requested only after the first vote (Phase 10), and a
 * participant who denied them still needs to know an event is waiting on them.
 * `has_pending_vote` therefore comes from the server, computed against the vote
 * table — never inferred from a client-side cache that goes stale the moment
 * somebody else votes.
 *
 * A `useState`/`useEffect` hook rather than React Query: this screen has one
 * list, one reload, and no cache to share, and a provider in the root layout
 * would be a global this phase does not need.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import type { EventSummary } from '@/src/types/event';

import { listMyEvents } from '../services/invite';

export interface UseMyEventsResult {
  events: EventSummary[];
  isLoading: boolean;
  /** A catalogue key, or `null`. */
  errorKey: string | null;
  reload: () => Promise<void>;
}

export function useMyEvents(): UseMyEventsResult {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // Stops a reload from landing after unmount and setting state on a dead tree.
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setErrorKey(null);

    try {
      const userId = await getStoredUserId();
      const loaded = await listMyEvents(userId);

      if (mounted.current) setEvents(loaded);
    } catch (error) {
      if (!mounted.current) return;

      // A 403 on an identity the server has forgotten means this device is a
      // stranger again — an empty list is the honest answer, not an error
      // banner over a list the user cannot act on.
      setEvents([]);
      setErrorKey(isApiFailure(error) && error.status === 403 ? null : 'events.list.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { events, isLoading, errorKey, reload };
}
