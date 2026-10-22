/**
 * Reduce Motion (PRD-11 §8, Plan 11 Task 9).
 *
 * ★ IT IS AN ACCESSIBILITY SETTING, NOT A PREFERENCE.
 *
 * A user who has turned motion off has usually done so because motion makes
 * them ill, not because they find it fussy. Ignoring the setting is a defect
 * (§8), which is why this hook has no "override" surface to disable it.
 *
 * ★ IT READS THE OS, AND IT FOLLOWS CHANGES.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is the initial read and
 * `reduceMotionChanged` keeps it current, so toggling the setting in system
 * settings takes effect without a relaunch. A one-shot read is the common bug:
 * the user changes the setting, nothing happens, and they conclude the app
 * ignored them.
 *
 * `useMotion()` in `src/theme` is the richer form of this and is what animation
 * code should use. This hook is the minimal boolean for the places that only
 * need "instant or animated" — the state transitions in this phase.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduce(enabled);
      })
      .catch(() => {
        // A failed query must not leave the app broken; "motion on" is the
        // pre-existing behaviour, and the setting is re-read on the next mount.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);

    return () => {
      active = false;
      // `react-native-web` returns undefined when the media query is unavailable.
      subscription?.remove();
    };
  }, []);

  return reduce;
}
