import { I18nManager } from 'react-native';

import type { Language } from '@/src/i18n/types';

/**
 * Writes the language's reading direction into the native view manager.
 *
 * ★ THE PREFERENCE IS AN OUTPUT. ALWAYS WRITE IT.
 *
 * This used to guard the write:
 *
 * ```js
 * if (shouldBeRtl !== I18nManager.isRTL) { … forceRTL(shouldBeRtl) … }
 * ```
 *
 * and that guard was the bug. `react-native`'s `I18nManager` snapshots the
 * native constants ONCE at module load:
 *
 * ```js
 * const i18nConstants: I18nManagerConstants = getI18nManagerConstants();
 * ```
 *
 * and exports `isRTL` from that snapshot. There is no setter, and
 * `Activity.recreate()` does not reload the JS bundle — so for the whole life of
 * a process `I18nManager.isRTL` reports whatever the DEVICE locale implied at
 * launch, regardless of what the user picked since.
 *
 * On an English-locale device that snapshot is permanently `false`. Switching
 * Persian → English computed `false !== false`, so `forceRTL(false)` was never
 * called: the stored preference kept saying RTL, and the window rebuild that
 * follows re-read that same stale value and brought the app back up in the OLD
 * direction. The report is exact — "the App does try to reload and return to Home
 * when changing the Language but the Layout still doesn't change until
 * restarting".
 *
 * Writing the value unconditionally is the only spelling that cannot be wrong for
 * a device whose locale disagrees with the user's choice, and `forceRTL` writes a
 * single `SharedPreferences` boolean — setting it to what it already is costs
 * nothing.
 *
 * ★ AND `allowRTL` IS SET THE SAME WAY.
 *
 * `I18nUtil.isRTL` is
 * `supportsRtl && (forced || (allowed && deviceLocaleIsRtl))`. `allowRTL(true)`
 * is the default, but a previous launch could have left it `false`, which would
 * make `forceRTL(true)` inert. Both are written so the result depends only on the
 * language.
 */
export function applyDirection(language: Language): void {
  const shouldBeRtl = language === 'fa';

  I18nManager.allowRTL(shouldBeRtl);
  I18nManager.forceRTL(shouldBeRtl);
}
