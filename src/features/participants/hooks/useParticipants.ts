/**
 * S13's data (Plan 09 Task 13).
 *
 * Same shape as `useMyEvents`: one list, one reload, no shared cache — a React
 * Query provider in the root layout would be a global this screen does not need.
 *
 * ★ A 403 MEANS "NOT IN THIS EVENT", WHICH IS AN EMPTY LIST, NOT AN ERROR.
 *
 * The device may hold an identity the server has since deleted (account
 * deletion, or the 30-day anonymous sweep). Showing a failure banner would blame
 * the network for a state the person created deliberately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { isApiFailure } from '@/src/lib/api';

import { listParticipants, type ParticipantAudienceEntry } from '../services/participants';

export interface UseParticipantsResult {
  participants: ParticipantAudienceEntry[];
  isLoading: boolean;
  /** A catalogue key, or `null`. */
  errorKey: string | null;
  reload: () => Promise<void>;
}

export function useParticipants(eventId: string, userId: string | null): UseParticipantsResult {
  const [participants, setParticipants] = useState<ParticipantAudienceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mounted = useRef(true);

  const reload = useCallback(async () => {
    if (eventId === '') return;

    setIsLoading(true);
    setErrorKey(null);

    try {
      const loaded = await listParticipants(eventId, userId);
      if (mounted.current) setParticipants(loaded);
    } catch (error) {
      if (!mounted.current) return;

      setParticipants([]);
      setErrorKey(isApiFailure(error) && error.status === 403 ? null : 'errors.unknown');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId, userId]);

  useEffect(() => {
    mounted.current = true;
    void reload();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { participants, isLoading, errorKey, reload };
}
