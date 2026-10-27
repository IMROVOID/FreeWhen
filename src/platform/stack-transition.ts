/**
 * A navigation is a transition, not a swap.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `expo-router`'s native stack has a platform transition, but the WEB build's
 * `<Stack>` defaulted to none — so a route change replaced the whole page in a
 * single frame. There was no sense of having gone anywhere: the new screen was
 * simply the only screen, and the back gesture's visual cause was missing.
 *
 * ★ THE DIRECTION FOLLOWS THE LAYOUT.
 *
 * `slide_from_right` enters from the physical right, which is the LEADING edge
 * in Persian and the TRAILING edge in English — so a hardcoded value is wrong
 * for one of the two shipping languages, and wrong in the way that reads as a
 * bug rather than as a preference. The value is derived from the resolved
 * layout direction, which on web is the document's `dir` and everywhere else is
 * the locale.
 *
 * ★ REDUCE MOTION GETS A FADE.
 *
 * Style Guide §7.7: a full-screen horizontal slide is exactly the kind of
 * travel that triggers motion sensitivity, so it collapses to the platform's
 * cross-fade. `I18nManager` is deliberately NOT consulted — it is always
 * `isRTL: false` on web, which is what produced the wrong-way back chevrons.
 */

import { useTranslation } from 'react-i18next';

import { isRtlLayout } from '@/src/platform/layout-direction';
import { useMotion } from '@/src/theme/useMotion';

/** The stack options shared by the root and the event shell. */
export interface StackTransition {
  animation: 'slide_from_right' | 'slide_from_left' | 'fade';
  animationDuration: number;
}

/**
 * The transition for the current layout direction and motion preference.
 *
 * A push in a Persian interface comes in from the right (the reading start) and
 * one in English also comes in from the right, so the pair below is chosen so
 * that "forward" always reads as arriving from the side the reader starts on.
 */
export function useStackTransition(): StackTransition {
  const { i18n } = useTranslation();
  const motion = useMotion();

  if (motion.reduce) {
    return { animation: 'fade', animationDuration: 120 };
  }

  return {
    animation: isRtlLayout(i18n.language) ? 'slide_from_left' : 'slide_from_right',
    animationDuration: 240,
  };
}
