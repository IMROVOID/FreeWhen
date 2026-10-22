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
 *
 * ★ THE ORGANIZER-ALONE STATE IS ACTIONABLE (AC-11.3.1, Plan 11 Task 4).
 *
 * One participant, zero proposals is the most-seen empty state in the product:
 * it is what every organizer sees seconds after creating an event. It offers the
 * first-proposal action directly instead of describing the emptiness.
 *
 * ★ OFFLINE KEEPS THE PROPOSALS READABLE AND MARKS A QUEUED VOTE (AC-11.7.1).
 *
 * A vote that LOOKS submitted but has not left the device destroys trust in the
 * tally, so the pending write is labelled next to the tally rather than hidden.
 * The banner is a strip above the content, never a modal.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { Banner } from '@/src/components/ui/Toast';
import { EmptyState } from '@/src/components/states/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { ProposalCard } from '@/src/features/proposals/components/ProposalCard';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { DecisionStatusBand } from '@/src/features/voting/components/DecisionStatusBand';
import { TallyBar } from '@/src/features/voting/components/TallyBar';
import { VoteControl } from '@/src/features/voting/components/VoteControl';
import { useDecisionStatus } from '@/src/features/voting/hooks/useDecisionStatus';
import { useVote } from '@/src/features/voting/hooks/useVote';
import { useOffline } from '@/src/hooks/useOffline';
import { apiRequest } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventSummary } from '@/src/types/event';
import type { Tally } from '@/src/types/vote';

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
  const { isOffline, pendingCount } = useOffline();

  // ★ THE VOTE STATE LIVES HERE, AND ITS PAYLOAD IS THE DECISION STATUS.
  //
  // The tally has to come from somewhere, and the Decision Status payload is the
  // one endpoint that carries every proposal's tally plus the caller's own votes
  // in a single request. Reusing it on this screen keeps one source of truth for
  // the numbers the cards show and the numbers the status area shows.
  const {
    status: voteStatus,
    connection: voteConnection,
    reload: reloadVotes,
  } = useDecisionStatus({ eventId });

  const [localVotes, setLocalVotes] = useState(voteStatus);
  useEffect(() => {
    setLocalVotes(voteStatus);
  }, [voteStatus]);

  const { cast, pending: pendingVote, errorKey: voteError, clearError } = useVote({
    status: localVotes,
    setStatus: setLocalVotes,
    reload: reloadVotes,
  });

  const myVotes = localVotes?.myVotes ?? {};
  const isConfirmed = localVotes ? Object.keys(localVotes.decisions).length > 0 : false;

  /**
   * The tally for one proposal.
   *
   * An empty tally until the payload arrives, rather than a hidden card: the
   * proposal is real and its controls are usable the moment the status lands,
   * and a skeleton row that appears and disappears is worse than a zero.
   */
  const tallyFor = useCallback(
    (proposalId: string): Tally =>
      localVotes?.proposals.find((entry) => entry.proposal.id === proposalId)?.tally ?? {
        yes: 0,
        maybe: 0,
        no: 0,
        unanswered: 0,
        total: 0,
        voters: { yes: [], maybe: [], no: [] },
        outstanding: [],
      },
    [localVotes],
  );

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

  // One navigation target for the three places that offer a first proposal.
  const openPropose = useCallback(() => {
    if (!event) return;
    router.push({
      pathname: '/event/[id]/propose',
      params: {
        id: event.id,
        windowStart: event.date_window_start,
        windowEnd: event.date_window_end,
        homeTz: event.home_tz,
      },
    });
  }, [event, router]);

  // ★ LOADING IS A SKELETON, NOT A CENTRED SPINNER (§6).
  if (isLoadingEvent) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[8], paddingHorizontal: space[5] },
        ]}
      >
        <ListSkeleton rows={2} testID="event-home-loading" />
      </View>
    );
  }

  if (isMissing || !event) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.bg, paddingTop: insets.top, paddingHorizontal: space[5] },
        ]}
      >
        <Card variant="raised" testID="event-home-missing">
          <Text variant="h3">{t('states.errorTitle')}</Text>
          <Text variant="body" color={theme.textMuted}>
            {t('errors.notParticipant')}
          </Text>
          <Button
            label={t('common.back')}
            onPress={() => router.replace('/')}
            variant="secondary"
            size="medium"
            style={styles.missingAction}
          />
        </Card>
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
      {/* ★ AC-11.7.1 — the strip sits above the content; everything below
          stays readable while it is showing. */}
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="event-home-offline" />}

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

      {/* Phase 7 — the Decision Status band, fed by THIS screen's payload.
          The layout suppresses its own band on this route so one screen has one
          poller (FR-2.25). */}
      <DecisionStatusBand
        eventId={eventId}
        shared={{ status: localVotes, connection: voteConnection }}
      />

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

      {/* ★ A FAILED VOTE REVERTS VISIBLY (§13.4). The selection goes back to
          what is stored and this line says why — never a silent rollback. */}
      <Banner
        message={voteError ? t(voteError) : ''}
        visible={voteError !== null}
        tone="danger"
        actionLabel={t('common.ok')}
        onAction={clearError}
        testID="event-home-vote-error"
      />

      {isLoading ? (
        <ListSkeleton rows={3} testID="event-home-proposals-loading" />
      ) : errorKey ? (
        <ErrorState
          messageKey={errorKey}
          onRetry={() => void reloadVotes()}
          testID="event-home-proposals-error"
        />
      ) : proposals.length === 0 ? (
        /* ★ AC-11.3.1 — one participant, zero proposals. The prompt is the
           first-proposal ACTION, not a description of the emptiness. */
        <EmptyState
          prompt={t('states.organizerAlone')}
          body={t('states.organizerAloneBody')}
          testID="event-home-proposals-empty"
          action={
            <Button
              label={t('proposals.newProposal')}
              onPress={openPropose}
              variant="primary"
              size="medium"
              testID="event-home-proposals-empty-action"
            />
          }
        />
      ) : (
        <View style={styles.list} testID="event-home-proposals">
          {proposals.map((proposal) => (
            <View key={proposal.id} style={styles.proposalBlock}>
              <ProposalCard proposal={proposal} homeTz={homeTz} testID={`event-home-proposal-${proposal.id}`} />

              {/* Phase 7 — vote controls belong ON the first screen, not behind
                  a tab (PRD-11 §4.2). The 20-second acquisition rule depends on
                  it, so the card gains its controls in place. */}
              <TallyBar
                tally={tallyFor(proposal.id)}
                showNames
                testID={`event-home-tally-${proposal.id}`}
              />

              {/* ★ AC-11.7.1 — a queued vote is MARKED. A vote that looks
                  submitted but is still on the device would poison the tally. */}
              {isOffline && myVotes[proposal.id] && (
                <Text
                  variant="caption"
                  color={theme.textMuted}
                  testID={`event-home-pending-${proposal.id}`}
                >
                  {t('offline.pendingWrite')}
                </Text>
              )}

              <VoteControl
                current={myVotes[proposal.id] ?? null}
                onVote={(value) => void cast(proposal.id, value)}
                disabled={proposal.status === 'WITHDRAWN' || isConfirmed}
                pending={pendingVote === proposal.id}
                showHelper={(myVotes[proposal.id] ?? null) === null}
                testID={`event-home-vote-${proposal.id}`}
              />
            </View>
          ))}
        </View>
      )}

      <Button
        label={t('proposals.newProposal')}
        onPress={openPropose}
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

      {/* ★ S14 — the history is one tap from the decision it explains.
          Plan 11 Task 6 builds the screen; this is its way in. */}
      <Button
        label={t('a11y.openActivity')}
        accessibilityLabel={t('a11y.openActivity')}
        onPress={() => router.push({ pathname: '/event/[id]/activity', params: { id: event.id } })}
        variant="ghost"
        size="medium"
        testID="event-home-activity"
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
  proposalBlock: {
    gap: space[3],
  },
  action: {
    marginTop: space[6],
    borderRadius: radius.pill,
  },
  missingAction: {
    marginTop: space[2],
  },
});
