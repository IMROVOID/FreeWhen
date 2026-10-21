import * as ExpoHaptics from 'expo-haptics';

import type { Haptics } from './haptics';

export const haptics: Haptics = {
  impact(style) {
    if (style === 'success') {
      void ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success);
      return;
    }

    void ExpoHaptics.impactAsync(
      style === 'medium'
        ? ExpoHaptics.ImpactFeedbackStyle.Medium
        : ExpoHaptics.ImpactFeedbackStyle.Light,
    );
  },
};
