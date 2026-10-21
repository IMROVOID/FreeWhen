import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/src/components/ui/Avatar';
import { Text } from '@/src/components/ui/Text';
import { border, palette, radius, size, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';
import { haptics } from '@/src/platform/haptics';
import { dur, spring, stagger } from '@/src/theme/motion';

export interface MeetPointProps {
  /** The participants converging on the pill. */
  participants: Array<{ name: string; colorIndex: number }>;
  /** Whether the convergence is playing. */
  active: boolean;
  /** The label inside the converging pill. */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The signature moment: participants drift toward a single pill, the pill
 * flashes Volt, and a haptic fires (Style Guide §1, §7.6.1).
 *
 * Use it for the three reserved moments only — the final time chosen, the
 * final place chosen, and "everyone's in".
 */
export function MeetPoint({
  participants,
  active,
  label,
  testID,
  style,
}: MeetPointProps) {
  const { t } = useTheme();
  const motion = useMotion();

  const progress = useSharedValue(0);
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      progress.value = 0;
      flash.value = 0;
      return;
    }

    if (motion.reduce) {
      // Reduce Motion: the travel is replaced by a soft fade, but the colour
      // flash is retained (Style Guide §7.7).
      progress.value = withTiming(1, { duration: dur.fast });
      flash.value = withTiming(1, { duration: dur.base });
      return;
    }

    progress.value = withSpring(1, spring.bouncy);
    flash.value = withTiming(1, { duration: dur.base });
    haptics.impact('success');
  }, [active, motion.reduce, progress, flash]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.08 }],
    opacity: progress.value,
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flash.value * 0.6,
  }));

  return (
    <View testID={testID} style={[styles.container, style]} accessibilityRole="summary">
      {participants.slice(0, stagger.max).map((participant, index) => (
        <ConvergingAvatar
          key={participant.name}
          name={participant.name}
          colorIndex={participant.colorIndex}
          index={index}
          active={active}
          reduce={motion.reduce}
        />
      ))}

      <Animated.View style={[styles.pill, { backgroundColor: t.primary }, pillStyle]}>
        {label && (
          <Text variant="button" color={t.onPrimary} align="center">
            {label}
          </Text>
        )}
      </Animated.View>

      {/* The Volt Burst — a soft flash behind the pill. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flash, { backgroundColor: palette.volt }, flashStyle]}
      />
    </View>
  );
}

interface ConvergingAvatarProps {
  name: string;
  colorIndex: number;
  index: number;
  active: boolean;
  reduce: boolean;
}

function ConvergingAvatar({ name, colorIndex, index, active, reduce }: ConvergingAvatarProps) {
  const offset = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      offset.value = 0;
      return;
    }

    if (reduce) {
      offset.value = withTiming(0, { duration: dur.fast });
      return;
    }

    // A 40ms stagger between avatars (Style Guide §7.6.1).
    offset.value = withDelay(index * 40, withSpring(1, spring.bouncy));
  }, [active, reduce, index, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (1 - offset.value) * (index % 2 === 0 ? 1 : -1) * 60 },
      { translateY: (1 - offset.value) * 24 },
      { scale: 0.8 + offset.value * 0.2 },
    ],
    opacity: offset.value,
  }));

  return (
    <Animated.View style={[styles.avatarSlot, animatedStyle]} pointerEvents="none">
      <Avatar name={name} colorIndex={colorIndex} size={40} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
  },
  avatarSlot: {
    position: 'absolute',
  },
  pill: {
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.pill,
    borderWidth: border.strong,
    borderColor: palette.volt,
  },
  flash: {
    position: 'absolute',
    width: size.meetPointFlash,
    height: size.meetPointFlash,
    borderRadius: radius.pill,
  },
});
