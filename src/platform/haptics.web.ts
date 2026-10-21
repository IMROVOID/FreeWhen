import type { Haptics } from './haptics';

/**
 * Web has no haptic API. The no-op is CORRECT, not a stub: press feedback on
 * web is the CSS active state, which the `Pressy` primitive provides.
 */
export const haptics: Haptics = {
  impact() {
    // Intentionally empty — see above.
  },
};
