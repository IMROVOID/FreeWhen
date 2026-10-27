/**
 * The event shell (Plan 05, PRD-11 §6).
 *
 * A `Stack` container providing a clean layout foundation for event routes.
 *
 * ★ IT DECLARES THE SAME TRANSITION AS THE ROOT STACK.
 *
 * A nested stack with no animation cuts even when the root slides, which reads
 * as a second, broken navigation: the header would slide away while the screen
 * under it blinked. The value comes from the same helper so the two cannot
 * disagree on direction or on Reduce Motion.
 */

import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { useStackTransition } from '@/src/platform/stack-transition';
import { useTheme } from '@/src/theme/useTheme';

export default function EventLayout() {
  const { t } = useTheme();
  const transition = useStackTransition();

  return (
    <View style={[styles.shell, { backgroundColor: t.bg }]}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: transition.animation,
          animationDuration: transition.animationDuration,
          contentStyle: { backgroundColor: t.bg },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
