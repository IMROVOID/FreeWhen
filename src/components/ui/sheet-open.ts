/**
 * When the sheet may be asked to open — and why asking once is not enough.
 *
 * ★ `@gorhom/bottom-sheet` SILENTLY DROPS AN OPEN IT READS TOO EARLY.
 *
 * The library is driven by its `index` prop. Its internal effect is:
 *
 * ```js
 * React.useEffect(() => {
 *   if (animateOnMount && !didAnimateOnMount.value) return;
 *   handleSnapToIndex(_providedIndex);
 * }, [animateOnMount, _providedIndex, didAnimateOnMount, handleSnapToIndex]);
 * ```
 *
 * and `handleSnapToIndex` begins with
 *
 * ```js
 * const isLayoutReady = isLayoutCalculated.get();
 * if (!isLayoutReady) return;
 * ```
 *
 * The effect's dependencies are the `index` VALUE and two mount flags — NOT
 * layout readiness. So the commit that mounts the sheet sets `index` to `0`, the
 * container has not measured yet, the call returns, and when the measurement
 * finally lands **nothing re-runs**: `_providedIndex` is still `0` and the flags
 * are unchanged. The sheet stays at `index −1`.
 *
 * That is not a cosmetic failure. The sheet's `Modal` is presented, so on Android
 * there is a real `TYPE_APPLICATION` window over the app; the panel inside it is
 * translated off-screen. The window eats every touch and paints nothing — the
 * exact report: "the input is swallowed by the overlay but the overlay itself is
 * not visible".
 *
 * ★ SO THE OPEN IS RETRIED ON LAYOUT, WHICH IS THE FIRST MOMENT IT CAN SUCCEED.
 *
 * `onLayout` on the sheet's measuring parent fires precisely when the library's
 * `isLayoutCalculated` becomes true. This module is the decision, kept pure so
 * "does a late measurement still open the sheet" has a test and cannot be
 * re-broken by a refactor.
 */

export interface SheetOpenInput {
  /** Whether the caller wants the sheet open. */
  wanted: boolean;
  /** Whether the library has reported a calculated layout. */
  layoutReady: boolean;
  /** Whether an open has already been delivered for this presentation. */
  alreadyOpened: boolean;
}

/**
 * Whether to call `snapToIndex(0)` now.
 *
 * `alreadyOpened` is the guard that makes the retry idempotent: `onLayout` fires
 * again on every keyboard inset change, rotation and font-scale change, and each
 * one must be a no-op rather than a re-animation of a sheet the user has since
 * dragged or the caller has since closed.
 */
export function shouldOpenSheet({ wanted, layoutReady, alreadyOpened }: SheetOpenInput): boolean {
  return wanted && layoutReady && !alreadyOpened;
}

/**
 * The library's `index` prop for a sheet's presentation state.
 *
 * `-1` is closed and `0` is the first snap point (or, under dynamic sizing, the
 * measured content height). It is still supplied, because it is the controlled
 * value the library reads; `shouldOpenSheet` is what makes the open survive the
 * measurement it needs.
 */
export function sheetIndexFor({ visible, mounted }: { visible: boolean; mounted: boolean }): number {
  return visible && mounted ? 0 : -1;
}
