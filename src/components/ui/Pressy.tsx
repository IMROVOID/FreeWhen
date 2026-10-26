import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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

const LAYOUT_PROPS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'alignSelf',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'zIndex',
]);

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
  style,
  ...rest
}: PressyProps) {
  const motion = useMotion();
  const progress = useSharedValue(1);

  const flatStyle = StyleSheet.flatten(style) as ViewStyle | undefined;
  const outerStyle: ViewStyle = {};
  const innerStyle: ViewStyle = {};

  if (flatStyle) {
    for (const [key, val] of Object.entries(flatStyle)) {
      if (LAYOUT_PROPS.has(key)) {
        (outerStyle as Record<string, unknown>)[key] = val;
      } else {
        (innerStyle as Record<string, unknown>)[key] = val;
      }
    }
  }

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progress.value }],
  }));

  const hasFlex = outerStyle.flex !== undefined;
  const hasHeight = outerStyle.height !== undefined;
  const hasWidth = outerStyle.width !== undefined;

  return (
    <Animated.View style={[animatedStyle, outerStyle]}>
      <Pressable
        {...rest}
        {...ariaState(rest.accessibilityState, rest.accessibilityRole)}
        hitSlop={hitSlop}
        style={[
          hasFlex && styles.fillFlex,
          hasHeight && styles.fillHeight,
          hasWidth && styles.fillWidth,
          styles.noOutline,
          innerStyle,
        ]}
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

/**
 * ★ NO BROWSER FOCUS RING.
 *
 * On web a focused `Pressable` becomes a real `<button>`, and the browser
 * draws its default outline around it — a second ring on top of the surface
 * the component already paints. Every Button, chip and tile in the app showed
 * it, which made focus look like a rendering fault rather than a state.
 *
 * ★ TWO CONSTRAINTS THIS SHAPE WORKS AROUND.
 *
 *  - `outline` is a rejected SHORTFORM in react-native-web's style validator,
 *    so the longhands are used or the value is dropped.
 *  - React Native types `outlineStyle` as `solid | dotted | dashed`, which has
 *    no `none` member, so the value is asserted rather than widened globally.
 *    Native ignores both keys, which is why this is safe to send everywhere.
 */
const hiddenOutline = {
  outlineStyle: 'none',
  outlineWidth: 0,
} as unknown as ViewStyle;

const styles = StyleSheet.create({
  fillFlex: {
    flex: 1,
  },
  fillHeight: {
    height: '100%',
  },
  fillWidth: {
    width: '100%',
  },
  noOutline: hiddenOutline,
});
