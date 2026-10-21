import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { REDUCED_MOTION_DURATION, dur, spring } from './motion';

export interface MotionConfig {
  reduce: boolean;
  /** Entrance duration. Springs become a 120ms fade under Reduce Motion. */
  enter: { duration: number };
  /** The spring config, or `undefined` when motion is reduced. */
  spring: typeof spring | undefined;
  parallax: boolean;
  orbit: boolean;
  sparkles: boolean;
  /** The Meet Point travel animation. The colour flash is retained as a fade. */
  meetPointTravel: boolean;
}

/**
 * One helper decides the Reduce Motion configuration — never branch on the
 * flag ad hoc (Style Guide §7.7).
 */
export function useMotion(): MotionConfig {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduce(enabled);
      })
      .catch(() => {
        // A failed query must not leave the app in a broken state; the
        // default of "motion on" is the pre-existing behaviour.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      // react-native-web returns undefined when the media query is unavailable.
      subscription?.remove();
    };
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
