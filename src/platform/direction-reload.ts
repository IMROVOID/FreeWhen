/**
 * Rebuilding the native window so a layout-direction change takes effect.
 *
 * Shared file: the interface only. `direction.native.ts`-style siblings hold the
 * implementations.
 */

/**
 * Rebuilds the native window, if the platform needs it.
 *
 * ★ A REACT REMOUNT DOES NOT CHANGE NATIVE ROW ORDER, AND THAT WAS THE DEFECT.
 *
 * `app/_layout.tsx` keys the app's root on the resolved direction, which discards
 * every piece of React state and forces the tree to be re-created. That is
 * necessary and it is not sufficient: `flexDirection: 'row'` is resolved by the
 * PLATFORM's layout engine from the parent's `layoutDirection`, which belongs to
 * the Activity's window — not to React. So after switching to English every string
 * changed (the catalogue is JS), every `align="start"` moved (the app sets an
 * absolute `textAlign`), and every row kept its Persian order until the process
 * was killed.
 *
 * `I18nManager.forceRTL` is documented as "takes effect on the next app reload",
 * and that is literally true: it writes a `SharedPreferences` boolean that
 * nothing re-reads while a surface is alive. Recreating the Activity makes the
 * window re-read it, which is the same thing the OS does on a locale change and
 * the same thing the user was doing by hand with a force-stop.
 *
 * Called only after a language change actually flipped the direction, so a switch
 * between two same-direction locales costs nothing.
 */
export function reloadForDirection(): void {
  // Replaced at runtime by the `.native.ts` / `.web.ts` siblings.
}
