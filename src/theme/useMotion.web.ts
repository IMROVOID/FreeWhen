/**
 * Reduce Motion — web implementation.
 *
 * ★ THE MEDIA QUERY IS THE ONLY SIGNAL ON WEB.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a native API;
 * `react-native-web` returns an unresolved promise for it, so the native hook
 * would leave the app at its default "motion on" forever. `prefers-reduced-motion`
 * is what the browser actually exposes (PRD-18 §6 row 4, Style Guide §7.7).
 *
 * ★ THE RETURN SHAPE IS IDENTICAL TO `useMotion.ts`.
 *
 * Call sites do not branch on platform — they read `reduce`, `enter`,
 * `spring` and the four feature flags from whichever implementation Metro
 * resolved. A shape difference here would be a runtime `undefined`, not a
 * type error, because `tsc` only ever sees the native file.
 */

import { useEffect, useState } from 'react';

import { MotionConfig } from './useMotion';
import { REDUCED_MOTION_DURATION, dur, spring } from './motion';

const QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export type { MotionConfig };

export function useMotion(): MotionConfig {
  // Read synchronously on the first render: the static export has no
  // `matchMedia`, so this resolves to `false` and a reduced-motion user
  // corrects on the first frame rather than after a flash of animation.
  const [reduce, setReduce] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);

    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduce
    ? {
        reduce: true,
        enter: { duration: REDUCED_MOTION_DURATION },
        spring: undefined,
        parallax: false,
        orbit: false,
        sparkles: false,
        meetPointTravel: false,
      }
    : {
        reduce: false,
        enter: { duration: dur.slow },
        spring,
        parallax: true,
        orbit: true,
        sparkles: true,
        meetPointTravel: true,
      };
}
