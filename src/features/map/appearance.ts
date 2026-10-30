/**
 * The map's theme, resolved once and handed to both renderers.
 *
 * ★ THE MAP'S ACCENT IS THE APP'S ACCENT, NOT A MAP CONSTANT.
 *
 * The request was explicit: the map should react to the appearance colour. Every
 * map surface — the marker, the route line, the selected pin — therefore takes
 * `accent` from `useTheme().t.primary` rather than naming a hex. A hardcoded
 * colour here is the failure mode this test suite exists to prevent, because it
 * would look correct on the default theme and wrong on all of the others.
 *
 * ★ THE PITCH IS A DEFAULT, NOT A LOCK.
 *
 * The product asks for 3D. A pitch of 50° reads as three-dimensional at every
 * frame size the app supports, and the user is free to flatten the camera — the
 * value is the resting pose, never a clamp.
 */

import { DEFAULT_PITCH } from './types';

/** What a renderer needs to know about the app's appearance. */
export interface MapAppearance {
  /** The app theme's discriminant, which selects the MapBox style. */
  mode: 'light' | 'dark';
  /** The app's primary colour, as a CSS colour string. */
  accent: string;
  /** The resting camera pitch, in degrees. */
  pitch: number;
}

/** The minimum and maximum zoom either renderer accepts. */
export const MIN_MAP_ZOOM = 3;
export const MAX_MAP_ZOOM = 20;

/**
 * Builds the appearance object from the theme's own values.
 *
 * Deliberately a pure function of its arguments: `useTheme()` is called by the
 * component, so the mapping from a theme to a map appearance is testable without
 * mounting a provider.
 */
export function mapAppearance(
  themeName: 'light' | 'dark',
  primary: string,
): MapAppearance {
  return {
    mode: themeName,
    accent: primary,
    pitch: DEFAULT_PITCH,
  };
}

/** Holds a zoom inside the range both renderers support. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 12;
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom));
}
