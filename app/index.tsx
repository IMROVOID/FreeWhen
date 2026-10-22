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
 */

import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { EventRow } from '@/src/features/events/components/EventRow';
import { useMyEvents } from '@/src/features/events/hooks/useMyEvents';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function EventListScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { events, isLoading, errorKey, reload } = useMyEvents();

  const openEvent = useCallback(
    (eventId: string) => {
      router.push(`/event/${eventId}`);
    },
    [router],
  );

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

      {isLoading && events.length === 0 && (
        <View style={styles.loading} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.textMuted} />
        </View>
      )}

      {!isLoading && errorKey && (
        <View style={styles.errorBlock}>
          <Text variant="body" color={theme.textMuted} align="start">
            {t(errorKey)}
          </Text>
          <Button
            label={t('common.retry')}
            onPress={() => void reload()}
            variant="ghost"
            size="medium"
          />
        </View>
      )}

      {!isLoading && !errorKey && events.length === 0 && (
        <EmptyState
          title={t('events.list.emptyTitle')}
          body={t('events.list.emptyBody')}
          actionLabel={t('events.list.create')}
          onAction={() => router.push('/new')}
          testID="event-list-empty"
        />
      )}

      {events.length > 0 && (
        <View style={styles.rows}>
          {events.map((event) => (
            <EventRow key={event.id} event={event} onPress={() => openEvent(event.id)} />
          ))}

          <Button
            label={t('events.list.create')}
            onPress={() => router.push('/new')}
            variant="secondary"
            size="medium"
            testID="event-list-create"
            style={styles.createAction}
          />
        </View>
      )}
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
  loading: {
    marginTop: space[8],
    alignItems: 'center',
  },
  errorBlock: {
    gap: space[3],
    marginTop: space[6],
  },
  rows: {
    marginTop: space[2],
  },
  createAction: {
    marginTop: space[2],
  },
});
