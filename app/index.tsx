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
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { ScreenStateGate, type ScreenState } from '@/src/components/states/ScreenStateGate';
import { EventRow } from '@/src/features/events/components/EventRow';
import { useMyEvents } from '@/src/features/events/hooks/useMyEvents';
import { useOffline } from '@/src/hooks/useOffline';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function EventListScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { events, isLoading, errorKey, reload } = useMyEvents();
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
      ? { kind: 'error', messageKey: errorKey, onRetry: () => void reload() }
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
      <Text variant="h1" align="start">
        {t('events.list.heading')}
      </Text>

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
  createAction: {
    marginTop: space[2],
  },
});

