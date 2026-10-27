/**
 * The enter/exit choreography every overlay shares.
 *
 * ★ WHY THIS IS A HOOK AND NOT A LINE IN EACH OVERLAY.
 *
 * Every overlay in the product animated in and vanished out, and each one did it
 * for a slightly different reason — a re-arming effect on the web sheet, an
 * `if (!visible) return null` in the toast, a raw platform `Modal` in the chat
 * menu. The pattern they all need is the same and easy to get subtly wrong:
 *
 *  - stay mounted for one animation AFTER `visible` goes false, or the exit is
 *    cut off at frame one;
 *  - arm that teardown exactly once per close, because a state write inside an
 *    effect re-runs that effect and re-arms the timer — which is how the web
 *    sheet ended up restarting its exit every pass;
 *  - collapse to a fade under Reduce Motion rather than removing the transition
 *    (Style Guide §7.7).
 *
 * `open` is 0→1 for the whole life of the overlay, so a child can drive opacity
 * AND a translate from one value and the two cannot disagree mid-flight.
 *
 * ★ THE PROGRESS IS A PLAIN NUMBER, NOT A SHARED VALUE.
 *
 * The reanimated `withTiming` builders are what make a transition smooth on a
 * device, but they are also the thing a Node test cannot observe. Keeping the
 * hook's contract to "here is the target and whether you are still rendered" lets
 * both the animation and its assertions exist; the caller feeds `open` into
 * `useSharedValue`/`withTiming` where it can.
 */

import { useEffect, useState } from 'react';

import { REDUCED_MOTION_DURATION, dur } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';

export interface OverlayTransition {
  /** Whether the overlay should be in the tree at all. */
  rendered: boolean;
  /** `1` when open, `0` when closed — the target for opacity and translate. */
  open: 0 | 1;
  /** How long the exit takes, so a caller can match its own teardown. */
  exitDuration: number;
}

export interface OverlayTransitionOptions {
  /** The exit length when motion is allowed; ignored under Reduce Motion. */
  exitMs?: number;
}

export function useOverlayTransition(
  visible: boolean,
  { exitMs = dur.base }: OverlayTransitionOptions = {},
): OverlayTransition {
  const motion = useMotion();

  // Outlives `visible` by one animation.
  const [rendered, setRendered] = useState(visible);

  // The one-shot, for the reason in this file's header.
  const [armed, setArmed] = useState(visible);

  const exitDuration = motion.reduce ? REDUCED_MOTION_DURATION : exitMs;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setArmed(true);
      return;
    }

    if (!armed) return;
    setArmed(false);

    const timer = setTimeout(() => setRendered(false), exitDuration);
    return () => clearTimeout(timer);
  }, [visible, armed, exitDuration]);

  return { rendered, open: visible ? 1 : 0, exitDuration };
}
