/**
 * The direction hook.
 *
 * Kept in its own module because `src/platform/layout-direction.ts` is imported
 * by pure modules that must not pull React in — `tests/ui/*` loads it from a
 * non-React context.
 */

import { useSyncExternalStore } from 'react';

import {
  directionServerSnapshot,
  directionSnapshot,
  subscribeDirection,
} from './layout-direction';

/**
 * Whether the interface reads right-to-left, re-rendering on a language change.
 *
 * ★ THIS IS THE ONE TO USE INSIDE A COMPONENT.
 *
 * `isRtlLayout(language)` is correct for a pure function call, but a component
 * that calls it does not re-render when the language changes, so any geometry it
 * derived from the old answer survives — the stale segmented-control offset and
 * the switch knob resting outside its track. This subscribes instead.
 */
export function useLayoutDirection(): boolean {
  return useSyncExternalStore(subscribeDirection, directionSnapshot, directionServerSnapshot);
}

/** The current language code, for callers that need the code and the direction. */
export type { LayoutDirection } from './layout-direction';
