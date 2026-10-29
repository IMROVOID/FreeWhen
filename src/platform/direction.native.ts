import { I18nManager } from 'react-native';

import type { Language } from '@/src/i18n/types';

/**
 * Applies a language's text direction to the native view manager.
 *
 * ★ THIS IS AN OUTPUT, NOT THE SOURCE OF TRUTH.
 *
 * `I18nManager.forceRTL` only takes effect on a fresh launch, so it cannot be
 * the thing a live switch depends on — `src/platform/layout-direction.ts` reads
 * the language instead, and `app/_layout.tsx` rebuilds the navigator so the
 * mounted tree is laid out under the new direction without an OS restart.
 *
 * It is still set, in BOTH directions, so the primitives that consult the
 * platform manager (a native `TextInput`'s caret, an OS `ScrollView`'s resting
 * offset) agree with the interface on the next launch — and so a stale `true`
 * from a previous launch is flipped back rather than persisting.
 */
export function applyDirection(language: Language): void {
  const shouldBeRtl = language === 'fa';

  if (shouldBeRtl !== I18nManager.isRTL) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }

  // ★ AND THE SWAP IS REMEMBERED FOR *THIS* SESSION ANYWAY.
  //
  // `react-native` caches `isRTL` at module load, so the call above only takes
  // effect next launch. The app's own direction (the language) is already live,
  // so nothing waits on it; this is purely so a native primitive reading
  // `I18nManager.isRTL` mid-session is not the only thing left on the old value.
  // There is no setter for it, so the honest statement is: the app does not read
  // it (see layout-direction.ts).
}
