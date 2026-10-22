/**
 * The event shell (Plan 05, PRD-11 §6).
 *
 * A `Stack` with no visual chrome. Plan 07 mounts the Decision Status band above
 * the event screens here rather than on each screen, because "it must be on
 * every core event screen" (FR-2.25) is only true if the layout enforces it —
 * the alternative is a rule every future screen must remember.
 *
 * ★ THE BAND IS A HEADER, NOT A SCREEN.
 *
 * Its component lives in `src/features/voting/components/`, not in this file: a
 * file under `app/` exports routes, and a co-located component would register as
 * one.
 *
 * ★ THE HOME SCREEN AND THE DECISION SCREEN POLL FOR THEMSELVES.
 *
 * Both need the whole payload — the home screen for its per-card tallies, the
 * decision screen for the status area and the card. Letting the band poll as well
 * would mean two intervals and two identical requests every ten seconds on one
 * screen. So the band is suppressed on those two routes and owns the poll
 * everywhere else, where nothing else is asking.
 */

import { Stack, useLocalSearchParams, useSegments } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DecisionStatusBand } from '@/src/features/voting/components/DecisionStatusBand';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/** The routes that already hold the payload, and so must not be polled twice. */
const SELF_POLLING_ROUTES = new Set(['index', 'decision']);

export default function EventLayout() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const segments = useSegments();

  const eventId = typeof params.id === 'string' ? params.id : '';

  // The last segment is the screen under `/event/[id]`; the layout itself sits
  // one level up, so its absence means the event home.
  const screen = segments[segments.length - 1] ?? 'index';
  const showBand = eventId !== '' && !SELF_POLLING_ROUTES.has(screen);

  return (
    <View style={[styles.shell, { backgroundColor: t.bg }]}>
      {showBand && (
        <View style={[styles.band, { paddingTop: insets.top + space[2] }]}>
          <DecisionStatusBand eventId={eventId} />
        </View>
      )}

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
  band: {
    paddingHorizontal: space[5],
    paddingBottom: space[2],
  },
});
