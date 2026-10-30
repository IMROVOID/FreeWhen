import { NativeModules, Platform } from 'react-native';

/**
 * Native implementation: recreate the Activity on Android.
 *
 * ★ ANDROID ONLY, BECAUSE iOS NEEDS NOTHING.
 *
 * On iOS React Native resolves `flexDirection: 'row'` from the view's semantic
 * content attribute, which the native `RCTRootView` re-reads on a remount under
 * `I18nManager.forceRTL` — so the iOS half of this defect does not exist. Android
 * caches the direction in the window's `layoutDirection`, which only a new window
 * re-reads.
 *
 * A missing native module is not an error: a development build, a web-first build
 * or an APK predating this change simply keeps the previous behaviour rather than
 * crashing on a language switch.
 */
export function reloadForDirection(): void {
  if (Platform.OS !== 'android') return;

  const module = (
    NativeModules as { DirectionReload?: { recreate?: () => void } }
  ).DirectionReload;

  if (typeof module?.recreate !== 'function') return;

  try {
    module.recreate();
  } catch {
    // A failed recreate must not break the language switch: the catalogue has
    // already changed, so the worst case is a screen still laid out under the old
    // direction until the next launch — which is exactly what it was before.
  }
}
