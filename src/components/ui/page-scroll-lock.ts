/**
 * Locks page scrolling while a web overlay is open.
 *
 * See `page-scroll-lock.ts` for why this exists. Two pieces live there — the
 * shared counter and this hook — because the counter has to be module scope
 * (every sheet contributes to one lock) while the hook is per component.
 */

import { useEffect } from 'react';

let holders = 0;
let previousOverflow: string | null = null;

function body(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.body ?? null;
}

/**
 * Takes the shared lock, returning its release.
 *
 * The release is idempotent: a component whose close callback fires AND whose
 * cleanup runs must not decrement the counter twice and unlock the page early.
 */
export function lockPageScroll(): () => void {
  const element = body();

  if (element) {
    if (holders === 0) {
      previousOverflow = element.style.overflow;
      element.style.overflow = 'hidden';
    }
    holders += 1;
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;

    if (!element) return;

    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      element.style.overflow = previousOverflow ?? '';
      previousOverflow = null;
    }
  };
}

/**
 * Holds the page-scroll lock for as long as `locked` is true.
 *
 * ★ A COUNTER, NOT A BOOLEAN.
 *
 * Sheets stack — a confirm sheet over a share sheet. A boolean would have the
 * inner close release the lock the outer still needs. The counter keeps the page
 * frozen until the LAST overlay leaves, and restores whatever `overflow` the page
 * had before the first one opened rather than assuming it was empty.
 *
 * On native there is no document and this is a no-op.
 */
export function usePageScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    return lockPageScroll();
  }, [locked]);
}

/** Test hook: how many overlays currently hold the lock. */
export function pageScrollLockCount(): number {
  return holders;
}

/** Test hook: forget all holders. Never called by product code. */
export function resetPageScrollLock(): void {
  holders = 0;
  previousOverflow = null;
  const element = body();
  if (element) element.style.overflow = '';
}
