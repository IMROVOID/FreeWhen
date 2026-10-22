/**
 * The event home — the proposal list with its way into the flow.
 *
 * Phase 6 owns this screen's body. Phase 7 puts the Decision Status area on top
 * and adds vote controls to each card; the cards themselves are already
 * phase-7-ready, so that phase adds controls rather than rebuilding the list.
 *
 * ★ THE LIST STATES ITS ORDER (FR-2.4).
 *
 * Creation order read as a ranking is a real misreading, and a group will argue
 * about a score nobody computed. The heading says "in the order they were made"
 * in plain words, and the ranked view — which Phase 8 builds and labels
 * explicitly — is the only place a score is ever shown.
 *
 * ★ A FAILED REFRESH NEVER BLANKS THE LIST.
 *
 * The hook keeps the last good proposals on screen and reports reconnecting
 * separately, so a bad connection is a status line rather than an empty state
 * that looks like the group has no options.
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
import { ProposalCard } from '@/src/features/proposals/components/ProposalCard';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { apiRequest } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventSummary } from '@/src/types/event';

/** The event shell the proposal list needs. */
interface EventShell {
  id: string;
  title: string;
  status: string;
  participant_count: number;
  date_window_start: string;
  date_window_end: string;
  home_tz: string;
}

export default function EventHomeScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const eventId = typeof params.id === 'string' ? params.id : '';

  const [event, setEvent] = useState<EventShell | null>(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isMissing, setIsMissing] = useState(false);

  const { proposals, isLoading, isReconnecting, errorKey } = useProposals(eventId);

  const loadEvent = useCallback(async () => {
    setIsLoadingEvent(true);

    try {
      const stored = await getStoredUserId();

      const { data } = await apiRequest<{ event: EventSummary }>(`/api/events/${eventId}`, {
        userId: stored,
      });

      // `home_tz` is not on `EventSummary`; it is read from the wire so a
      // proposal's slot renders in the event's zone rather than the device's.
      const raw = data.event as unknown as EventShell;
      setEvent({
        ...raw,
        home_tz: raw.home_tz ?? 'Asia/Tehran',
      });
      setIsMissing(false);
    } catch {
      setEvent(null);
      setIsMissing(true);
    } finally {
      setIsLoadingEvent(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  if (isLoadingEvent) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.textMuted} testID="event-home-loading" />
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

  const homeTz = event.home_tz;

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

      <View style={styles.statusRow}>
        <Text variant="caption" color={theme.brand} align="start">
          {t(`events.status.${event.status}`)}
        </Text>
        <Text variant="caption" color={theme.textMuted} align="start" numeric>
          {t('events.list.participantCount', { count: event.participant_count })}
        </Text>
      </View>

      {/* FR-2.4 — the ordering is stated, never implied. */}
      <View style={styles.listHeading}>
        <Text variant="h3">{t('proposals.heading')}</Text>
        <Text variant="caption" color={theme.textFaint}>
          {t('proposals.subheading')}
        </Text>
      </View>

      {isReconnecting && (
        <Text variant="caption" color={theme.textMuted} testID="event-home-reconnecting">
          {t('proposals.reconnecting')}
        </Text>
      )}

      {isLoading ? (
        <ActivityIndicator color={theme.textMuted} testID="event-home-proposals-loading" />
      ) : errorKey ? (
        <Card variant="raised">
          <Text variant="body" color={theme.textMuted}>
            {t(errorKey)}
          </Text>
        </Card>
      ) : proposals.length === 0 ? (
        <Card variant="raised" testID="event-home-proposals-empty">
          <Text variant="h3">{t('proposals.emptyTitle')}</Text>
          <Text variant="body" color={theme.textMuted}>
            {t('proposals.emptyBody')}
          </Text>
        </Card>
      ) : (
        <View style={styles.list} testID="event-home-proposals">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              homeTz={homeTz}
              testID={`event-home-proposal-${proposal.id}`}
            />
          ))}
        </View>
      )}

      <Button
        label={t('proposals.newProposal')}
        onPress={() =>
          router.push({
            pathname: '/event/[id]/propose',
            params: {
              id: event.id,
              windowStart: event.date_window_start,
              windowEnd: event.date_window_end,
              homeTz,
            },
          })
        }
        testID="event-home-new-proposal"
        style={styles.action}
      />

      <Button
        label={t('slots.heading')}
        onPress={() =>
          router.push({ pathname: '/event/[id]/time', params: { id: event.id, homeTz } })
        }
        variant="secondary"
        size="medium"
        testID="event-home-slots"
      />

      <Button
        label={t('invite.share')}
        onPress={() => router.push('/')}
        variant="ghost"
        size="medium"
        testID="event-home-back"
      />
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
  listHeading: {
    marginTop: space[6],
    gap: space[1],
  },
  list: {
    gap: space[3],
    marginTop: space[3],
  },
  action: {
    marginTop: space[6],
    borderRadius: radius.pill,
  },
});
