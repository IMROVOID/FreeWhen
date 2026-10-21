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
