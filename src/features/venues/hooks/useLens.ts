/**
 * The active lens (Plan 08 Task 2, 10; PRD-05 §6.2, AC-5.6.1).
 *
 * ★ UI STATE, NOT A DATA MUTATION.
 *
 * Changing the lens re-ranks. It never touches a vote, a proposal or the
 * confirmed decision — this hook holds one string and exposes one setter, so
 * there is nothing here that could mutate anything else. That is the
 * structural half of AC-5.6.1; the test asserts the other half.
 *
 * ★ THE DEFAULT IS NAMED, NOT IMPLIED.
 *
 * `balanced` is the product's default lens (PRD-05 §6.2), not "whichever the
 * server happens to sort first".
 */

import { useCallback, useRef, useState } from 'react';

import { trackLensChanged } from '@/src/features/venues/services/analytics';
import type { Lens } from '@/src/engine/types';

/** The default lens. Named, so it can be asserted. */
export const DEFAULT_LENS: Lens = 'balanced';

export interface UseLensResult {
  lens: Lens;
  setLens: (lens: Lens) => void;
}

export function useLens(initial: Lens = DEFAULT_LENS): UseLensResult {
  const [lens, setLensState] = useState<Lens>(initial);

  // The previous value is tracked in a ref rather than read from the updater:
  // React may invoke an updater more than once, and an analytics call inside
  // one would double-count and could fire out of order.
  const previous = useRef<Lens>(initial);

  const setLens = useCallback((next: Lens) => {
    if (next === previous.current) return;

    trackLensChanged(previous.current, next);
    previous.current = next;
    setLensState(next);
  }, []);

  return { lens, setLens };
}
