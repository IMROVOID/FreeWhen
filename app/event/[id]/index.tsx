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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { PullToSync } from '@/src/components/ui/PullToSync';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { Text } from '@/src/components/ui/Text';
import { Banner } from '@/src/components/ui/Toast';
import { EmptyState } from '@/src/components/states/EmptyState';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { EventManagementModal } from '@/src/features/events/components/EventManagementModal';
import { StartPointSheet } from '@/src/features/participants/components/StartPointSheet';
import { listParticipants } from '@/src/features/participants/services/participants';
import { shouldOfferStartPoint } from '@/src/features/participants/services/start-point-gate';
import { EventShareModal } from '@/src/features/events/components/EventShareModal';
import { QuickActionsGrid } from '@/src/features/events/components/QuickActionsGrid';
import { deleteEvent, leaveEvent, renameEvent } from '@/src/features/events/services/event-management';
import { rotateInvite } from '@/src/features/events/services/invite';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
import { ProposalCard } from '@/src/features/proposals/components/ProposalCard';
import { VoteShareBar } from '@/src/features/proposals/components/VoteShareBar';
import { useProposals } from '@/src/features/proposals/hooks/useProposals';
import { RANKED_VIEW, rankProposals, shareOfAllAnswers } from '@/src/features/proposals/services/ranking';
import { DecisionStatusBand } from '@/src/features/voting/components/DecisionStatusBand';
import { TallyBar } from '@/src/features/voting/components/TallyBar';
import { VoteControl } from '@/src/features/voting/components/VoteControl';
import { useDecisionStatus } from '@/src/features/voting/hooks/useDecisionStatus';
import { useVote } from '@/src/features/voting/hooks/useVote';
import { useOffline } from '@/src/hooks/useOffline';
import { apiRequest, isApiFailure } from '@/src/lib/api';
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
  is_organizer?: boolean;
  invite_code?: string | null;
  invite_url?: string | null;
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
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);

  /**
   * The caller's own start-point state, and whether this visit has asked.
   *
   * `answered` starts false on every mount: the question is a first-entry
   * question, and the server cannot tell "never asked" from "chose to skip"
   * (both are `'none'`), so the local flag is what stops a skip being re-asked
   * on every visit. The state is fetched once, alongside the participants the
   * screens below already load.
   */
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [startPointState, setStartPointState] = useState<string | null>(null);
  const [startPointAnswered, setStartPointAnswered] = useState(false);
  const [startPointKnown, setStartPointKnown] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      const stored = await getStoredUserId();
      if (!active) return;
      setMyUserId(stored);

      if (!eventId) return;

      try {
        const entries = await listParticipants(eventId, stored);
        if (!active) return;
        setStartPointState(entries.find((entry) => entry.is_self)?.start_point_state ?? null);
      } catch {
        // A failed read is "we do not know", not "no start point" — see the gate.
        if (!active) return;
        setStartPointState(null);
      } finally {
        if (active) setStartPointKnown(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [eventId]);

  const askForStartPoint = shouldOfferStartPoint({
    state: startPointState,
    ready: startPointKnown && !isLoadingEvent,
    asked: startPointAnswered,
  });

  const { proposals, isLoading, isReconnecting, errorKey, reload: reloadProposals } = useProposals(eventId);
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

  /**
   * The proposals in vote-descending order (Plan 49 T13, FR-2.4 ranked view).
   *
   * Derived on every render rather than sorted in place, so `proposals` keeps the
   * server's creation order — which the ranked label's counterpart ("stable order
   * otherwise") and the tiebreak in `rankProposals` both depend on.
   */
  const rankedProposals = useMemo(
    () => rankProposals(proposals.map((proposal) => ({ ...proposal, tally: tallyFor(proposal.id) }))),
    [proposals, tallyFor],
  );

  const loadEvent = useCallback(async () => {    setIsLoadingEvent(true);

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
      setLoadErrorKey(null);
    } catch (error) {
      // ★ "NOT A PARTICIPANT" IS A VERDICT; A DROPPED CONNECTION IS NOT.
      //
      // This used to catch everything into one flag and render
      // `errors.notParticipant`, so a subway tunnel told the user they were
      // not a member of their own event — with no retry, because the screen
      // had decided the event did not exist. The key now comes from the
      // failure, and the screen offers the request again.
      setEvent(null);
      setLoadErrorKey(
        isApiFailure(error) ? error.messageKey : 'errors.networkError',
      );
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

  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [managementModalVisible, setManagementModalVisible] = useState(false);

  const handleRename = useCallback(
    async (newTitle: string) => {
      const stored = await getStoredUserId();
      const updated = await renameEvent(eventId, newTitle, stored);
      setEvent((prev) => (prev ? { ...prev, title: updated.title } : prev));
    },
    [eventId],
  );

  const handleRegenerateCode = useCallback(async () => {
    const stored = await getStoredUserId();
    const result = await rotateInvite(eventId, stored);
    const inviteCode = extractInviteToken(result.invite.url);
    setEvent((prev) =>
      prev ? { ...prev, invite_url: result.invite.url, invite_code: inviteCode } : prev,
    );
  }, [eventId]);

  const handleDelete = useCallback(async () => {
    const stored = await getStoredUserId();
    await deleteEvent(eventId, stored);
    router.replace('/');
  }, [eventId, router]);

  const handleLeave = useCallback(async () => {
    const stored = await getStoredUserId();
    await leaveEvent(eventId, stored);
    router.replace('/');
  }, [eventId, router]);

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

  if (loadErrorKey !== null || !event) {
    return (
      <View
        style={[
          styles.failureScreen,
          { backgroundColor: theme.bg, paddingTop: insets.top, paddingHorizontal: space[5] },
        ]}
      >
        {/* ★ THE BACK CONTROL SITS AT THE FOOT OF THE PAGE.
            It used to be centred in the viewport, which on a short page put it
            floating in the middle of the screen with nothing under it — the
            same defect as every other short screen that ended in mid-air. The
            `flex: 1` container and `marginTop: 'auto'` footer put it where every
            other primary action lives, and it stays there as the error message
            wraps to any number of lines. */}
        <View style={styles.failureBody}>
          {/* ★ A RETRY, AND THE REAL REASON.
              The failure used to be reported as "you are not a participant" with
              only a Back button — the one explanation that is both untrue and
              unfixable when the actual cause was the network. `ErrorState`
              renders the sentence the key names and offers the request again,
              and Back stays available for the case where leaving is the answer. */}
          <ErrorState
            messageKey={loadErrorKey ?? 'errors.unknown'}
            onRetry={() => void loadEvent()}
            testID="event-home-missing"
          />
        </View>

        <View style={styles.failureFooter}>
          <Button
            label={t('common.back')}
            onPress={() => router.replace('/')}
            variant="secondary"
            size="medium"
            testID="event-home-back"
          />
        </View>
      </View>
    );
  }

  const homeTz = event.home_tz;

  return (
    <PullToSync
      onRefresh={async () => {
        // Both sources this screen reads. The pollers already refresh on their own
        // interval; a pull is a manual nudge of the same two calls.
        await Promise.all([reloadVotes(), reloadProposals()]);
      }}
      testID="event-home-pull"
    >
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        // No `insets.top` here: `ScreenHeader` applies it, and adding it twice
        // would double the notch gap.
        { paddingTop: 0, paddingBottom: insets.bottom + space[10] },
      ]}
      testID="event-home"
    >
      {/* ★ AC-11.7.1 — the strip sits above the content; everything below
          stays readable while it is showing. */}
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="event-home-offline" />}

      {/* ★ A WAY BACK EXISTS. The router header is off for this whole subtree,
          so before `ScreenHeader` the event home had no exit at all beyond the
          OS gesture — which a desktop web build does not have. */}
      <ScreenHeader
        title={event.title}
        onBack={() => router.replace('/')}
        testID="event-home-header"
      />

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
          {/* ★ FR-2.4 — A RE-ORDERED LIST MUST SAY IT IS RE-ORDERED.
              "Re-ordering by score happens only in the ranked view, and the list
              must state that it is ranked — otherwise users misread creation
              order as ranking." The list below is vote-descending, so it carries
              the declaration. */}
          {RANKED_VIEW ? (
            <Text variant="caption" color={theme.textMuted} testID="event-home-proposals-ranked-label">
              {t('proposals.list.rankedLabel')}
            </Text>
          ) : null}

          {rankedProposals.map((proposal) => (
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

              {/* ★ THE SHARE BAR IS NOT A REPLACEMENT FOR THE PILL ABOVE.
                  The pill answers "how many of this group answered THIS
                  proposal"; the bar answers "what fraction of all answers are
                  this proposal's". Both are shown, because neither answers the
                  other's question. */}
              <VoteShareBar
                share={shareOfAllAnswers(
                  { ...proposal, tally: tallyFor(proposal.id) },
                  rankedProposals.map((entry) => ({ ...entry, tally: tallyFor(entry.id) })),
                )}
                testID={`event-home-share-${proposal.id}`}
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

      {proposals.length > 0 && (
        <Button
          label={t('proposals.newProposal')}
          onPress={openPropose}
          testID="event-home-new-proposal"
          style={styles.action}
        />
      )}

      <QuickActionsGrid
        onOpenSlots={() =>
          router.push({ pathname: '/event/[id]/time', params: { id: event.id, homeTz } })
        }
        onShare={() => setShareModalVisible(true)}
        onOpenActivity={() =>
          router.push({ pathname: '/event/[id]/activity', params: { id: event.id } })
        }
        onOpenChat={() => router.push({ pathname: '/event/[id]/chat', params: { id: event.id } })}
        onOpenManagement={() => setManagementModalVisible(true)}
      />

      <EventShareModal
        visible={shareModalVisible}
        onDismiss={() => setShareModalVisible(false)}
        eventTitle={event.title}
        inviteCode={event.invite_code}
        inviteUrl={event.invite_url}
        testID="event-share-modal"
      />

      <EventManagementModal
        visible={managementModalVisible}
        onDismiss={() => setManagementModalVisible(false)}
        isOwner={Boolean(event.is_organizer)}
        eventTitle={event.title}
        onRename={handleRename}
        onRegenerateCode={handleRegenerateCode}
        onDeleteEvent={handleDelete}
        onLeaveEvent={handleLeave}
        testID="event-management-modal"
      />

      {/*
        ★ THE OWNER IS ASKED FOR A STARTING POINT TOO.

        The prompt only ever existed as a route the invite screen replaced itself
        with after a join, so an organiser — a participant with an `'organizer'`
        row and no start point, exactly like a member — was the one person in
        their own event whose travel time the ranking left out. The condition is
        "I am a participant here and I have not answered", never the role; see
        `src/features/participants/services/start-point-gate.ts`.

        It is a sheet rather than a redirect because this person has just arrived
        on the event they created, and moving them off it before they have seen it
        is a worse answer than asking over it.
      */}
      <StartPointSheet
        visible={askForStartPoint}
        eventId={eventId}
        userId={myUserId}
        onDismiss={() => setStartPointAnswered(true)}
      />
    </ScrollView>
    </PullToSync>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  /**
   * A failure page fills the screen so its footer can be pinned to the bottom.
   *
   * The old `centered` style centred the whole block, which left the Back
   * control floating mid-screen when the message was short.
   */
  failureScreen: {
    flex: 1,
    justifyContent: 'center',
  },
  failureBody: {
    flexGrow: 0,
  },
  failureFooter: {
    // `auto` pushes it to the foot and keeps it there as the message grows.
    marginTop: 'auto',
    paddingTop: space[6],
    paddingBottom: space[8],
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
});
