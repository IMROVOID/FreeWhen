/**
 * Motion tokens — transcribed from `docs/specs/FRONTEND_STYLE_GUIDE.md` §7.2 and §14.
 *
 * Springs for anything the user touches or that changes size/position; timing
 * and `ease.out` for opacity, colour and entrances (§7.2).
 */

import { Easing } from 'react-native-reanimated';

export const dur = {
  instant: 90,
  fast: 160,
  base: 260,
  slow: 420,
  hero: 700,
} as const;

export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
} as const;

export const spring = {
  snappy: { damping: 18, stiffness: 320, mass: 0.8 },
  bouncy: { damping: 12, stiffness: 220, mass: 0.9 },
  soft: { damping: 22, stiffness: 140, mass: 1.0 },
} as const;

export const press = {
  scale: 0.96,
} as const;

export const stagger = {
  step: 45,
  max: 8,
} as const;

/** Style Guide §7.7 — springs collapse to a 120ms fade under Reduce Motion. */
export const REDUCED_MOTION_DURATION = 120;
