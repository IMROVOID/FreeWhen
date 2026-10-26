/**
 * The confirmation toast — an OVERLAY, never part of the page flow.
 *
 * ★ WHY THIS EXISTS SEPARATELY FROM `Toast`.
 *
 * `Toast` was rendered inside the card that owned the copy action, so it took
 * part in layout: it appeared between the URL card and the next button, shoved
 * them apart for three seconds, then vanished and let them snap back. The
 * confirmation was reflowing the very page it confirmed.
 *
 * This component is absolutely positioned over the screen instead. It covers
 * the same three seconds without moving a single pixel of content.
 *
 * ★ IT MUST NOT EAT TOUCHES.
 *
 * A full-width strip pinned to the bottom sits exactly where a thumb reaches
 * for the primary action. `pointerEvents="none"` lets every touch through to
 * the page underneath — the toast is information, not a target.
 *
 * ★ SWIPE-TO-DISMISS IS A GESTURE PAN, NOT A SECOND TIMER.
 *
 * The auto-dismiss timer is the primary path (Style Guide §11.9). The swipe is
 * the impatient path: a horizontal pan right or left, on whichever side the
 * reader's language considered "away". Both directions are accepted because
 * the dismiss intent is unambiguous and an RTL layout flips which side feels
 * natural.
 */

import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CheckCircle, Info, WarningCircle, XCircle } from 'phosphor-react-native';

import { Text } from './Text';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type OverlayToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface OverlayToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  /** Drives the icon, and with it the meaning. */
  tone?: OverlayToastTone;
  /** The auto-dismiss delay in milliseconds. */
  duration?: number;
  testID?: string;
}

/** The horizontal travel, in px, that counts as "swipe it away". */
const SWIPE_DISMISS_DISTANCE = 72;

/**
 * A confirmation that floats over the screen and leaves it as it found it.
 */
export function OverlayToast({
  message,
  visible,
  onDismiss,
  tone = 'neutral',
  duration = 3000,
  testID,
}: OverlayToastProps) {
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    // A fresh message starts centred, not left where the previous swipe ended.
    translateX.value = 0;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss, translateX]);

  // ★ MEMOISED, BECAUSE gesture-handler CACHES ON IDENTITY.
  //
  // Rebuilding the description every render hands the detector a new object,
  // which drops the recogniser's cached state mid-gesture. `onDismiss` is the
  // only input that matters.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          translateX.value = event.translationX;
        })
        .onEnd((event) => {
          const flicked =
            Math.abs(event.translationX) > SWIPE_DISMISS_DISTANCE ||
            Math.abs(event.velocityX) > 800;

          if (flicked) {
            // Direction from the VELOCITY when the finger barely travelled —
            // a fast flick has near-zero translation, and `translationX || 1`
            // sent a rightward flick to the left.
            const direction = Math.sign(event.velocityX || event.translationX || 1);
            translateX.value = withTiming(direction * 400, { duration: 160 }, (finished) => {
              if (finished) runOnJS(onDismiss)();
            });
            return;
          }

          translateX.value = withTiming(0, { duration: 140 });
        }),
    [onDismiss, translateX],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!visible) return null;

  return (
    /**
     * ★ `box-none`, NOT `none`.
     *
     * The layer spans the screen, so it must not swallow taps aimed at the page
     * behind it. But `pointerEvents="none"` also disables hit-testing for the
     * gesture itself, which made the swipe unreachable on web. `box-none` lets
     * touches pass through the empty area while the toast pill inside stays a
     * target — the page keeps working AND the swipe exists.
     */
    <View
      style={[styles.layer, { bottom: insets.bottom + space[8] }]}
      pointerEvents="box-none"
      testID={testID}
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.toast,
            { backgroundColor: theme.surface2, borderColor: theme.line },
            animatedStyle,
          ]}
        >
          <ToneIcon tone={tone} />
          <Text variant="body" color={theme.text} numberOfLines={2} style={styles.label}>
            {message}
          </Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function ToneIcon({ tone }: { tone: OverlayToastTone }) {
  const { t: theme } = useTheme();

  const color =
    tone === 'success'
      ? theme.success
      : tone === 'warning'
        ? theme.warning
        : tone === 'danger'
          ? theme.danger
          : theme.info;

  const Icon =
    tone === 'success'
      ? CheckCircle
      : tone === 'warning'
        ? WarningCircle
        : tone === 'danger'
          ? XCircle
          : Info;

  return <Icon size={20} color={color} weight="fill" />;
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    // `alignSelf: 'stretch'` pins both edges without naming a side, which is
    // what keeps this free of a physical `left`/`right` pair.
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingStart: space[5],
    paddingEnd: space[5],
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    paddingStart: space[4],
    paddingEnd: space[4],
    paddingVertical: space[3],
    maxWidth: '100%',
  },
  label: {
    flexShrink: 1,
  },
});
