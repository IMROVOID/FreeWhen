/**
 * The event shell (Plan 05, PRD-11 §6).
 *
 * A `Stack` with no visual chrome, because Phase 6 adds proposals, voting and
 * chat as siblings and Phase 7 puts the Decision Status area above all of them.
 * Creating the shell here — rather than in Phase 6 — is what lets this phase
 * hand over a working route instead of a promise.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/src/theme/useTheme';

export default function EventLayout() {
  const { t } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
