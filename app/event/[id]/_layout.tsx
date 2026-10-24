/**
 * The event shell (Plan 05, PRD-11 §6).
 *
 * A `Stack` container providing a clean layout foundation for event routes.
 */

import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { useTheme } from '@/src/theme/useTheme';

export default function EventLayout() {
  const { t } = useTheme();

  return (
    <View style={[styles.shell, { backgroundColor: t.bg }]}>
      <Stack
        screenOptions={{
          headerShown: false,
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
