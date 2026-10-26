import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { OverlayToast, type OverlayToastTone } from './OverlayToast';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type ToastTone = OverlayToastTone;

export interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  tone?: ToastTone;
  /** The auto-dismiss delay in milliseconds. */
  duration?: number;
  testID?: string;
}

/**
 * The one confirmation toast, as an overlay.
 *
 * ★ THIS IS A RE-EXPORT, NOT A SECOND IMPLEMENTATION.
 *
 * The original pill was rendered in the page flow, so it pushed the content
 * around while it was visible. Every call site now uses `OverlayToast`; this
 * alias exists so the import name stays stable and there is exactly one
 * behaviour to maintain.
 */
export function Toast({ message, visible, onDismiss, tone = 'neutral', duration = 3000, testID }: ToastProps) {
  return (
    <OverlayToast
      message={message}
      visible={visible}
      onDismiss={onDismiss}
      tone={tone}
      duration={duration}
      testID={testID}
    />
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
