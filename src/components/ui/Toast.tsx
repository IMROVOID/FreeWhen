import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  tone?: ToastTone;
  /** The auto-dismiss delay in milliseconds. */
  duration?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A pill toast that slides down from the top inset and auto-dismisses after
 * three seconds (Style Guide §11.9).
 */
export function Toast({
  message,
  visible,
  onDismiss,
  tone = 'neutral',
  duration = 3000,
  testID,
  style,
}: ToastProps) {
  const { t } = useTheme();

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  const toneColor =
    tone === 'success'
      ? t.success
      : tone === 'warning'
        ? t.warning
        : tone === 'danger'
          ? t.danger
          : t.textMuted;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { backgroundColor: t.surface1 }, style]}
    >
      <View style={[styles.iconTile, { backgroundColor: toneColor }]} />
      <Text variant="body" color={t.text} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

export interface BannerProps {
  message: string;
  visible: boolean;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A full-width banner, for a persistent message (Style Guide §11.9).
 */
export function Banner({
  message,
  visible,
  tone = 'neutral',
  actionLabel,
  onAction,
  testID,
  style,
}: BannerProps) {
  const { t } = useTheme();

  if (!visible) return null;

  const toneColor =
    tone === 'success'
      ? t.success
      : tone === 'warning'
        ? t.warning
        : tone === 'danger'
          ? t.danger
          : t.info;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: t.surface2 }, style]}
    >
      <View style={[styles.bannerIcon, { backgroundColor: toneColor }]} />
      <Text variant="body" color={t.text} style={styles.bannerText} numberOfLines={3}>
        {message}
      </Text>
      {actionLabel && onAction && (
        <Text variant="body" color={t.primary} onPress={onAction}>
          {actionLabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  iconTile: {
    width: space[5],
    height: space[5],
    borderRadius: radius.pill,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderRadius: radius.lg,
    padding: space[4],
  },
  bannerIcon: {
    width: space[3],
    height: space[3],
    borderRadius: radius.pill,
  },
  bannerText: {
    flex: 1,
  },
});
