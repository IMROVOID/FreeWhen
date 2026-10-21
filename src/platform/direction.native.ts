import { I18nManager } from 'react-native';

import type { Language } from '@/src/i18n/types';

export function applyDirection(language: Language): void {
  const shouldBeRtl = language === 'fa';

  // Set direction in BOTH directions. A stale `true` from a previous launch
  // must be flipped back when the user switches to English, or English mode
  // renders mirrored.
  if (shouldBeRtl !== I18nManager.isRTL) {
    I18nManager.allowRTL(shouldBeRtl);
    I18nManager.forceRTL(shouldBeRtl);
  }
}
