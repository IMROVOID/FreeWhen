import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { press, spring } from '@/src/theme/motion';
import { useMotion } from '@/src/theme/useMotion';
import { haptics, type HapticStyle } from '@/src/platform/haptics';

export interface PressyProps extends Omit<PressableProps, 'style'> {
  haptic?: HapticStyle;
  /** The press-scale factor. Defaults to 0.96 (Style Guide §7.3). */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Translates `accessibilityState` into the ARIA attributes `react-native-web`
 * actually forwards.
 *
 * ★ WITHOUT THIS, `selected` SILENTLY DISAPPEARS ON WEB.
 *
 * `react-native-web` treats `accessibilityState` as a filtered prop and never
 * derives `aria-checked`/`aria-selected`/`aria-disabled` from it — only the
 * explicit `aria-*` or `accessibility*` props reach the DOM. A vote control that
 * sets `accessibilityState={{ selected }}` therefore announces itself on native
 * and as an unselected group on web, which is the accessibility regression
 * PRD-11 §8 forbids.
 *
 * `selected` maps to `aria-checked` for a radio (the vote control's role) and to
 * `aria-selected` otherwise — the same distinction RN makes internally.
 */
function ariaState(
  state: PressableProps['accessibilityState'],
  role: PressableProps['accessibilityRole'],
): Record<string, unknown> {
  if (!state) return {};

  const out: Record<string, unknown> = {};

  if (state.disabled !== undefined) out['aria-disabled'] = state.disabled;
  if (state.busy !== undefined) out['aria-busy'] = state.busy;
  if (state.expanded !== undefined) out['aria-expanded'] = state.expanded;
  if (state.checked !== undefined) out['aria-checked'] = state.checked === 'mixed' ? 'mixed' : state.checked;

  if (state.selected !== undefined) {
    if (role === 'radio' || role === 'checkbox' || role === 'switch') {
      out['aria-checked'] = state.selected;
    } else {
      out['aria-selected'] = state.selected;
    }
  }

  return out;
}

/**
 * The press feedback required on every tappable element: press-scale, haptic,
 * and a 48pt target (Style Guide §7.3).
 *
 * Under Reduce Motion the SCALE is skipped but the HAPTIC still fires — the
 * feedback is required; only the spring is replaced (§7.7).
 */
export function Pressy({
  children,
  onPress,
  onPressIn,
  onPressOut,
  haptic = 'light',
  scale = press.scale,
  hitSlop = 8,
  ...rest
}: PressyProps) {
  const motion = useMotion();
  const progress = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        {...rest}
        {...ariaState(rest.accessibilityState, rest.accessibilityRole)}
        hitSlop={hitSlop}
        onPressIn={(event) => {
          if (!motion.reduce) {
            progress.value = withSpring(scale, spring.snappy);
          }
          haptics.impact(haptic);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          if (!motion.reduce) {
            progress.value = withSpring(1, spring.snappy);
          }
          onPressOut?.(event);
        }}
        onPress={onPress}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
