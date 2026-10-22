/**
 * The ranking, kept current (Plan 08 Task 3, 10; PRD-04 FR-4.1).
 *
 * ★ `NoVenueMeetsThreshold` IS A SUCCESS, NOT AN ERROR.
 *
 * The server answers it with 200 and a `suggestions` list. Modelling it as a
 * failure would show an error banner over a working answer and hide the one
 * thing that helps: an invitation to relax a limit.
 *
 * ★ A REFRESH NEVER CLEARS THE LIST.
 *
 * Same rule as `useProposals`: the previous ranking stays on screen while the
 * next lens loads, so a bad connection cannot blank a list the user was
 * reading. The loading flag is separate from the data.
 *
 * ★ THE LENS IS A QUERY PARAMETER, NOT A MUTATION (AC-5.6.1).
 *
 * Refetching under a different lens re-ranks. It never writes a vote, a
 * proposal or a decision.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest, isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { trackRankingFailed } from '@/src/features/venues/services/analytics';
import type {
  Conflict,
  Coverage,
  Exclusion,
  Lens,
  RankedVenue,
  Suggestion,
} from '@/src/engine/types';

/** The server's success envelope (`server/routes/rank-travel.ts`). */
interface RankSuccessBody {
  state: 'ok';
  lens: Lens;
  ranking: RankedVenue[];
  coverage: Coverage;
  excluded: Exclusion[];
  conflicts: Conflict[];
}

/** The no-viable-option envelope — also a 200. */
interface RankNoViableBody {
  state: 'NoVenueMeetsThreshold';
  lens: Lens;
  ranking: RankedVenue[];
  coverage: Coverage;
  excluded: Exclusion[];
  suggestions: Suggestion[];
}

type RankBody = RankSuccessBody | RankNoViableBody;

export interface UseRankingResult {
  venues: RankedVenue[];
  excluded: Exclusion[];
  coverage: Coverage;
  conflicts: Conflict[];
  /** Present only on the no-viable path. */
  suggestions: Suggestion[];
  /** True when the engine answered `NoVenueMeetsThreshold`. */
  isNoViableOption: boolean;
  isLoading: boolean;
  /** A catalogue key, or `null`. Only set when there is nothing to show. */
  errorKey: string | null;
  /** True while a refresh has failed and a retry is pending — non-blocking. */
  isReconnecting: boolean;
  reload: () => Promise<void>;
}

/** The empty coverage a first render carries until the server answers. */
const EMPTY_COVERAGE: Coverage = {
  compared: 0,
  total: 0,
  missing: [],
  wideGeography: false,
};

export function useRanking(eventId: string, lens: Lens): UseRankingResult {
  const [venues, setVenues] = useState<RankedVenue[]>([]);
  const [excluded, setExcluded] = useState<Exclusion[]>([]);
  const [coverage, setCoverage] = useState<Coverage>(EMPTY_COVERAGE);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isNoViableOption, setIsNoViableOption] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const mounted = useRef(true);
  const loadedOnce = useRef(false);

  const reload = useCallback(async () => {
    if (!loadedOnce.current) setIsLoading(true);

    try {
      const userId = await getStoredUserId();

      const { data } = await apiRequest<RankBody>(
        `/api/events/${eventId}/rank?lens=${lens}`,
        { method: 'POST', userId },
      );

      if (!mounted.current) return;

      setVenues(data.ranking ?? []);
      setExcluded(data.excluded ?? []);
      setCoverage(data.coverage ?? EMPTY_COVERAGE);
      setConflicts(data.state === 'ok' ? (data.conflicts ?? []) : []);
      setSuggestions(data.state === 'NoVenueMeetsThreshold' ? (data.suggestions ?? []) : []);
      setIsNoViableOption(data.state === 'NoVenueMeetsThreshold');

      setErrorKey(null);
      setIsReconnecting(false);
      loadedOnce.current = true;
    } catch (error) {
      if (!mounted.current) return;

      // A 403 means the caller is not a participant: an empty ranking is the
      // honest answer, and a retry cannot succeed.
      if (isApiFailure(error) && error.status === 403) {
        setVenues([]);
        setErrorKey(null);
        loadedOnce.current = true;
        return;
      }

      trackRankingFailed(isApiFailure(error) ? 'refused' : 'transport');

      // ★ A FAILED REFRESH KEEPS THE LIST.
      setIsReconnecting(true);
      if (!loadedOnce.current) setErrorKey('ranking.loadFailed');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [eventId, lens]);

  useEffect(() => {
    mounted.current = true;
    void reload();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return {
    venues,
    excluded,
    coverage,
    conflicts,
    suggestions,
    isNoViableOption,
    isLoading,
    errorKey,
    isReconnecting,
    reload,
  };
}
