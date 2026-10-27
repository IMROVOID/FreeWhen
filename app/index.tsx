/**
 * S1 — the event list (Plan 05 Task 6, PRD-11 S1).
 *
 * What the user sees on launch: the events they created or joined, most
 * recently active first, each with a status chip and — if they still owe a
 * vote — an attention badge.
 *
 * ★ THE EMPTY STATE IS P0, NOT A NICETY.
 *
 * A brand-new user's first screen is empty by definition, so the empty state IS
 * their first impression. It invites the one action that matters rather than
 * showing nothing.
 *
 * ★ ALL FOUR APPLICABLE STATES RUN THROUGH `ScreenStateGate` (Plan 11 Task 3).
 *
 * Loading is skeleton rows, not a full-screen spinner (§6), and an error offers
 * a retry rather than a sentence on its own. Permission-denied is genuinely N/A
 * here — the list needs no permission — so the gate is used with four states and
 * not a placeholder fifth.
 */

import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gear } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ScreenStateGate, type ScreenState } from '@/src/components/states/ScreenStateGate';
import { EventRow } from '@/src/features/events/components/EventRow';
import { JoinEventCard } from '@/src/features/events/components/JoinEventCard';
import { useMyEvents } from '@/src/features/events/hooks/useMyEvents';
import { useOffline } from '@/src/hooks/useOffline';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function EventListScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { events, isLoading, errorKey, errorTitleKey, reload } = useMyEvents();
  const { isOffline } = useOffline();

  const openEvent = useCallback(
    (eventId: string) => {
      router.push(`/event/${eventId}`);
    },
    [router],
  );

  const createAction = (
    <Button
      label={t('events.list.create')}
      onPress={() => router.push('/new')}
      variant="primary"
      size="medium"
      testID="event-list-create"
    />
  );

  // ★ THE STATE IS DERIVED IN ONE PLACE, SO NO BRANCH CAN FALL THROUGH.
  const state: ScreenState = isLoading
    ? { kind: 'loading', rows: 3 }
    : errorKey
      ? {
          kind: 'error',
          messageKey: errorKey,
          titleKey: errorTitleKey ?? undefined,
          onRetry: () => void reload(),
        }
      : events.length === 0
        ? {
            kind: 'empty',
            prompt: t('states.eventsEmpty'),
            body: t('states.eventsEmptyBody'),
            action: createAction,
          }
        : {
            kind: 'ready',
            children: (
              <>
                {events.map((event) => (
                  <EventRow key={event.id} event={event} onPress={() => openEvent(event.id)} />
                ))}
                <Button
                  label={t('events.list.create')}
                  onPress={() => router.push('/new')}
                  variant="secondary"
                  size="medium"
                  testID="event-list-create-secondary"
                  style={styles.createAction}
                />
              </>
            ),
          };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="event-list"
    >
      {/* ★ SETTINGS LIVES HERE, NOT ON THE EVENT SCREEN.
          It was a tile in the event home's action grid, which made an app-wide
          door read as one more thing you can do to this event. The app's own
          home is where "the app" lives, so the door is a header control beside
          the heading — present before any event exists, and reachable from the
          list rather than from inside a plan. */}
      <View style={styles.headerRow}>
        <View style={styles.headingBlock}>
          <Text variant="h1" align="start">
            {t('events.list.heading')}
          </Text>
        </View>

        <Pressy
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.heading')}
          testID="home-settings"
          style={styles.settingsControl}
        >
          <View style={[styles.settingsInner, { backgroundColor: theme.surface2 }]}>
            <Gear size={22} color={theme.text} weight="bold" />
          </View>
        </Pressy>
      </View>

      <JoinEventCard onJoin={(token) => router.push(`/e/${token}`)} />

      <ScreenStateGate state={state} offline={isOffline} testID="event-list-states" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  headingBlock: {
    flex: 1,
  },
  settingsControl: {
    // A 44pt control with `Pressy`'s slop clears the 48pt target.
    width: size.stepperButton,
    height: size.stepperButton,
  },
  settingsInner: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createAction: {
    marginTop: space[2],
  },
});

