/**
 * The event home shell — what a participant lands on after joining.
 *
 * Phase 6 builds proposals here and Phase 7 puts the Decision Status area on
 * top. For now the screen proves the route works end to end and gives the
 * organizer their way back to the link, so a freshly created event is never a
 * dead end.
 *
 * ★ THE DECISION STATUS AREA BELONGS ON EVERY EVENT SCREEN (PRD-11 S6).
 *
 * What exists here is the title, the status and the participant count — the
 * three things a participant needs in the seconds after joining, and the frame
 * Phase 7 replaces with the real thing.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { apiRequest } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventSummary } from '@/src/types/event';

export default function EventHomeScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const eventId = typeof params.id === 'string' ? params.id : '';

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMissing, setIsMissing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);

    try {
      const stored = await getStoredUserId();
      setUserId(stored);

      const { data } = await apiRequest<{ event: EventSummary }>(`/api/events/${eventId}`, {
        userId: stored,
      });
      setEvent(data.event);
      setIsMissing(false);
    } catch {
      setEvent(null);
      setIsMissing(true);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.textMuted} />
      </View>
    );
  }

  if (isMissing || !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <EmptyState
          title={t('events.list.emptyTitle')}
          body={t('errors.notParticipant')}
          actionLabel={t('common.back')}
          onAction={() => router.replace('/')}
          testID="event-home-missing"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="event-home"
    >
      <Text variant="h1" align="start" numberOfLines={3}>
        {event.title}
      </Text>

      <View style={[styles.statusRow]}>
        <Text variant="caption" color={theme.brand} align="start">
          {t(`events.status.${event.status}`)}
        </Text>
        <Text variant="caption" color={theme.textMuted} align="start" numeric>
          {t('events.list.participantCount', { count: event.participant_count })}
        </Text>
      </View>

      <Card variant="raised" style={styles.card}>
        <Text variant="h3" align="start">
          {t('join.nextLocation')}
        </Text>
        <Text variant="body" color={theme.textMuted} align="start">
          {t('location.subheading')}
        </Text>
        <Button
          label={t('location.heading')}
          onPress={() =>
            router.push({
              pathname: '/e/[token]/location',
              params: { token: '', event_id: event.id },
            })
          }
          variant="secondary"
          size="medium"
          testID="event-home-location"
          style={styles.cardAction}
        />
      </Card>

      <View style={styles.actions}>
        <Text variant="caption" color={theme.textFaint} align="start">
          {t('invite.subheading')}
        </Text>
        {userId && (
          <Button
            label={t('invite.share')}
            onPress={() => router.push('/')}
            variant="ghost"
            size="medium"
            testID="event-home-back"
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[2],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[2],
  },
  card: {
    gap: space[2],
    marginTop: space[5],
    borderRadius: radius.lg,
  },
  cardAction: {
    marginTop: space[2],
  },
  actions: {
    marginTop: space[6],
    gap: space[2],
  },
});
