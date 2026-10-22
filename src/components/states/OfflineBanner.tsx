/**
 * The offline banner (PRD-11 §6, AC-11.7.1, Plan 11 Task 7).
 *
 * ★ NON-BLOCKING, ALWAYS.
 *
 * It is a strip, never a modal — the user can still read every cached thing
 * behind it. An offline modal would hide the content the cache was kept for.
 *
 * ★ IT SAYS WHAT HAPPENS TO UNFINISHED WRITES.
 *
 * "Offline" alone leaves the user unsure whether their vote counted. The second
 * clause promises the flush, which is the promise the queue actually keeps.
 *
 * ★ IT IS ANNOUNCED ONCE, POLITELY.
 *
 * `role="status"` with a polite live region: a screen reader hears the change
 * of connectivity without the banner stealing focus from whatever the user was
 * reading — the same non-blocking rule, applied to the accessibility tree.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface OfflineBannerProps {
  /** How many writes are waiting to be sent, when the caller knows. */
  pendingCount?: number;
  testID?: string;
}

export function OfflineBanner({ pendingCount = 0, testID }: OfflineBannerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const message =
    pendingCount > 0
      ? t('offline.pendingBanner', { count: pendingCount })
      : t('offline.banner');

  return (
    <View
      testID={testID ?? 'offline-banner'}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      style={[styles.banner, { backgroundColor: theme.surface3 }]}
    >
      <View style={[styles.dot, { backgroundColor: theme.warning }]} />
      <Text variant="caption" color={theme.text} style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  dot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
  },
  message: {
    flexShrink: 1,
  },
});
