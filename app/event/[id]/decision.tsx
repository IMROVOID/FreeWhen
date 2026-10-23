/**
 * S12 — the Decision Card screen and the confirmed state (Plan 07 Task 9).
 *
 * ★ THE CARD REPLACES THE STATUS AREA IN PLACE (FR-2.26, AC-11.5.1).
 *
 * When the axis has a live decision this screen renders the card where the
 * status area would have been. It is not a separate destination to hunt for: a
 * participant who was looking at the tally sees the outcome take its place, and
 * the Meet Point fires on that transition.
 *
 * ★ THE CARD IS BUILT FROM THE DECISION ROW (PRD-02 §13.5).
 *
 * `buildDecisionCard` is pure and runs over the row plus its proposal, so two
 * devices produce identical content. Nothing here re-ranks, re-sorts or applies
 * per-user ordering.
 *
 * ★ CONFIRMATION LIVES HERE, SO THE ORGANIZER CONFIRMS WHERE THE RESULT APPEARS.
 *
 * The confirm action opens the sheet; the sheet's warning names the outstanding
 * voters and never blocks; and the same screen shows the outcome afterwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/src/components/ui/Toast';
import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { getStoredUserId } from '@/src/lib/session';
import { isApiFailure } from '@/src/lib/api';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { DecisionAxis } from '@/src/types/vote';

import { ConfirmSheet } from '@/src/features/voting/components/ConfirmSheet';
import { DecisionCard } from '@/src/features/voting/components/DecisionCard';
import { DecisionStatus } from '@/src/features/voting/components/DecisionStatus';
import { DecisionStatusBand } from '@/src/features/voting/components/DecisionStatusBand';
import { OutstandingVoters } from '@/src/features/voting/components/OutstandingVoters';
import { TallyBar } from '@/src/features/voting/components/TallyBar';
import { VoteControl } from '@/src/features/voting/components/VoteControl';
import { useDecisionStatus } from '@/src/features/voting/hooks/useDecisionStatus';
import { useVote } from '@/src/features/voting/hooks/useVote';
import { shouldRequestAfterVote, usePushPermission } from '@/src/features/notifications/hooks/usePushPermission';
import { buildDecisionCard } from '@/src/features/voting/services/decision-card';
import { confirm, planConfirmation } from '@/src/features/voting/services/confirm';
import { ReopenSheet } from '@/src/features/voting/components/ReopenSheet';
import { resolveDealbreakers } from '@/src/features/voting/services/dealbreakers';
import type { WireTally } from '@/src/features/voting/services/voting-api';

/**
 * The tally a row shows when the payload has none yet.
 *
 * A dealbroken proposal is still voted on, so its tally must render — an empty
 * object would crash `TallyBar` and the muted card would take the screen down
 * with it, which is the opposite of "stays visible".
 */
const EMPTY_TALLY: WireTally = {
  yes: 0,
  maybe: 0,
  no: 0,
  unanswered: 0,
  total: 0,
  voters: { yes: [], maybe: [], no: [] },
  outstanding: [],
};
import { reopenDecision } from '@/src/features/voting/services/reopen';

// Phase 10 — follow-through, mounted only on the confirmed branch.
import { RsvpControls } from '@/src/features/follow-through/components/RsvpControls';
import { AttendeeList } from '@/src/features/follow-through/components/AttendeeList';
import { RunningLateAction } from '@/src/features/follow-through/components/RunningLateAction';
import { CantMakeItAction } from '@/src/features/follow-through/components/CantMakeItAction';
import { SharePlanButton } from '@/src/features/follow-through/components/SharePlanButton';
import { AddToCalendarButton } from '@/src/features/follow-through/components/AddToCalendarButton';
import { MuteToggle } from '@/src/features/follow-through/components/MuteToggle';
import { fetchRsvps, type RsvpState } from '@/src/features/follow-through/services/rsvp';
import type { ShareablePlan } from '@/src/features/follow-through/services/share-plan';

export default function DecisionScreen() {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; axis?: string }>();

  const eventId = typeof params.id === 'string' ? params.id : '';
  const axis: DecisionAxis = params.axis === 'place' ? 'place' : 'time';

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const { status, isLoading, errorKey, connection, reload } = useDecisionStatus({ eventId });

  /**
   * ★ PUSH PERMISSION IS ASKED AFTER THE FIRST VOTE, NEVER AT LAUNCH (FR-6.14).
   *
   * The hook reads the current status on mount and does not prompt; only
   * `requestAfterFirstVote()` asks, and it is called from `onVoted` — the
   * success branch of a vote — so the prompt arrives at the moment the user has
   * just shown the app is worth something. The hook's own `ASKED_KEY` guards a
   * second prompt, so there is deliberately no second check here.
   */
  const { requestAfterFirstVote, hasAsked } = usePushPermission();

  const onVoted = useCallback(
    ({ isFirstVote }: { proposalId: string; isFirstVote: boolean }) => {
      if (!shouldRequestAfterVote({ isFirstVote, hasAsked })) return;
      void requestAfterFirstVote();
    },
    [requestAfterFirstVote, hasAsked],
  );

  // A local copy so the optimistic patch has somewhere to land. The hook's own
  // payload stays the source of truth across refetches.
  const [local, setLocal] = useState(status);
  useEffect(() => {
    setLocal(status);
  }, [status]);

  const { cast, toggleVeto, pending, errorKey: voteError, clearError } = useVote({
    status: local,
    setStatus: setLocal,
    reload,
    onVoted,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // ★ PHASE 14 — REOPENING IS ORGANIZER-ONLY AND ONLY FROM A CONFIRMED STATE.
  //
  // Reopening anything else would be undoing a decision that does not exist. The
  // reason is required by the sheet AND by the server (AC-2.6.1); this screen only
  // decides when the affordance is offered.
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenedNotice, setReopenedNotice] = useState<string | null>(null);

  // ★ PHASE 10 — RSVP EXISTS ONLY ON THE CONFIRMED BRANCH.
  //
  // The state is fetched only when a decision is live, so a participant cannot
  // even see counts before the group has decided (FR-6.1, AC-6.1.1). `canRsvp`
  // inside `RsvpControls` is the second guard.
  const [rsvpState, setRsvpState] = useState<RsvpState | null>(null);

  // The card's attendee counts read RSVPs by participant id, while the controls
  // work in names. Holding both keeps one fetch serving both consumers.
  const [rsvpsById, setRsvpsById] = useState<Record<string, 'going' | 'maybe' | 'cannot'>>({});

  // ★ THE PER-EVENT MUTE, SEEDED FROM THE SERVER.
  //
  // `null` means "not yet known": rendering the switch as off before the payload
  // arrives would show a muted participant an unmuted switch, and the first tap
  // would then write a value they never chose.
  const [mutedHere, setMutedHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (local) setMutedHere(local.notifications_muted);
  }, [local]);

  const isConfirmedEvent = local?.event.status === 'CONFIRMED';

  // The confirmed state is what fires the Meet Point, and only on the edge.
  const wasConfirmed = useRef(false);

  const proposals = local?.proposals ?? [];

  // ★ DEALBREAKERS ARE APPLIED HERE, AND THEY MUTE RATHER THAN DROP (P08).
  //
  // The engine's hard filter reads `dealbreakers`, and a veto has to reach it or
  // the veto does nothing. But the card list must not shrink: `resolveDealbreakers`
  // returns every proposal, flagged, so the muted ones render with their reason
  // instead of vanishing.
  const resolved = useMemo(() => {
    // `proposals` is `?? []`, so it is a fresh array every render and cannot be
    // the memo's dependency. `local` is the payload it derives from, which is
    // the value that actually changes.
    const entries = local?.proposals ?? [];
    const records = (local?.myDealbreakers ?? []).map((proposalId) => ({
      proposalId,
      participantId: local!.me.id,
      displayName: local!.me.display_name,
    }));

    return resolveDealbreakers(
      entries.map((entry) => entry.proposal),
      records,
    );
  }, [local]);

  const tallyFor = (proposalId: string) =>
    proposals.find((entry) => entry.proposal.id === proposalId)?.tally ?? EMPTY_TALLY;
  const decision = local?.decisions[axis] ?? null;

  const chosenEntry = decision?.proposal_id
    ? (proposals.find((entry) => entry.proposal.id === decision.proposal_id) ?? null)
    : null;

  const card = useMemo(() => {
    if (!decision || !local) return null;

    return buildDecisionCard({
      decision,
      proposal: chosenEntry?.proposal ?? null,
      participants: local.participants,
      homeTz: local.event.home_tz,
      locale,
      // Phase 10 wires the RSVPs the card was always ready to receive; before
      // them its counts were necessarily zero.
      rsvps: rsvpsById,
    });
  }, [decision, chosenEntry, local, locale, rsvpsById]);

  const plan = useMemo(() => {
    if (!local) return null;

    const outstandingByProposal: Record<string, string[]> = {};
    for (const entry of local.proposals) {
      outstandingByProposal[entry.proposal.id] = entry.tally.outstanding;
    }

    return planConfirmation({
      axis,
      proposals: local.proposals.map((entry) => entry.proposal),
      // The engine's ranking is Phase 8's; until the screen holds it, the
      // server picks the same leader with its own creation-order tiebreak.
      ranking: null,
      outstandingByProposal,
    });
  }, [local, axis]);

  useEffect(() => {
    if (decision && !wasConfirmed.current) wasConfirmed.current = true;
    if (!decision) wasConfirmed.current = false;
  }, [decision]);

  const loadRsvps = useCallback(async () => {
    if (!isConfirmedEvent) {
      setRsvpState(null);
      return;
    }

    try {
      const userId = await getStoredUserId();
      const payload = await fetchRsvps(eventId, userId);
      setRsvpState({ attendance: payload.attendance, mine: payload.mine });
      setRsvpsById(payload.rsvps);
    } catch {
      // A failed read leaves the controls hidden rather than showing zeroes that
      // would read as "nobody is coming". The card above still states the plan.
      setRsvpState(null);
    }
  }, [eventId, isConfirmedEvent]);

  useEffect(() => {
    void loadRsvps();
  }, [loadRsvps]);

  const onConfirm = useCallback(async () => {
    if (!plan) return;

    setConfirming(true);
    setConfirmError(null);

    try {
      const userId = await getStoredUserId();
      await confirm({
        eventId,
        plan,
        userId,
        warnedOutstanding: plan.outstanding.length > 0,
      });

      setSheetOpen(false);
      await reload();
    } catch {
      // Confirmation is retryable and nothing was lost; the sheet stays open so
      // the organizer can try again rather than being returned to a list.
      setConfirmError('errors.validationFailed');
    } finally {
      setConfirming(false);
    }
  }, [plan, eventId, reload]);

  /**
   * Reopens the confirmed decision.
   *
   * ★ THE RELOAD IS THE POINT. The decision this screen was rendering no longer
   * exists as live, so leaving the stale card on screen would show a decision the
   * group has just undone — the exact contradiction the reopen exists to correct.
   */
  const onReopen = useCallback(
    async (reason: string) => {
      setReopenError(null);

      try {
        const userId = await getStoredUserId();
        const result = await reopenDecision(eventId, reason, userId);

        // Nothing live to reopen: the status is already what it should be, so
        // the screen reloads rather than reporting a failure.
        setReopenedNotice(result.alreadyReopened ? 'reopen.notFound' : 'reopen.done');
        await reload();
      } catch (error) {
        setReopenError(isApiFailure(error) ? error.messageKey : 'errors.validationFailed');
        throw error;
      }
    },
    [eventId, reload],
  );

  // ★ A SKELETON, NOT A CENTRED SPINNER (§6, Plan 11 Task 6).
  if (isLoading) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[5] },
        ]}
      >
        <ListSkeleton rows={3} testID="decision-loading" />
      </View>
    );
  }

  if (!local) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[5] },
        ]}
      >
        <ErrorState
          messageKey={errorKey ?? 'errors.notParticipant'}
          onRetry={() => void reload()}
          testID="decision-unavailable"
        />
      </View>
    );
  }

  const answered = proposals.reduce(
    (sum, entry) => sum + entry.tally.yes + entry.tally.maybe + entry.tally.no,
    0,
  );

  const isOrganizer = local.me.role === 'organizer';
  const isConfirmed = decision !== null;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[10] },
        ]}
        testID="decision-screen"
      >
        <Text variant="h1" numberOfLines={2}>
          {t('decision.title')}
        </Text>

        <Text variant="caption" color={theme.textMuted}>
          {t(`decision.axes.${axis}`)}
        </Text>

        {/* Phase 7 — the band, fed by THIS screen's payload. The layout suppresses
            its own on this route so one screen has one poller (FR-2.25). */}
        <DecisionStatusBand eventId={eventId} shared={{ status: local, connection }} />

        {connection === 'reconnecting' && (
          <Text variant="caption" color={theme.textMuted} testID="decision-reconnecting">
            {t('voting.reconnecting')}
          </Text>
        )}

        {/* ★ CONFIRMED: the card takes the status area's place, in place. */}
        {isConfirmed && card ? (
          <DecisionCard
            card={card}
            celebrate
            onViewActivity={() =>
              router.push({ pathname: '/event/[id]/decision', params: { id: eventId, axis } })
            }
            testID="decision-card"
          />
        ) : (
          <DecisionStatus
            {...toStatusProps(local, axis)}
            onAddProposal={() =>
              router.push({ pathname: '/event/[id]/propose', params: { id: eventId } })
            }
            testID="decision-status"
          />
        )}

        {/* ★ PHASE 14 — THE REOPENED BANNER (AC-2.6.1).
            It says that the decision moved AND why, because a group that only
            sees the state change has no way to know whether the organizer lost
            confidence or the venue closed. */}
        {reopenedNotice && (
          <Banner
            message={t(reopenedNotice)}
            visible
            tone="warning"
            actionLabel={t('common.ok')}
            onAction={() => setReopenedNotice(null)}
            testID="decision-reopen-notice"
          />
        )}

        {/* Outreach is the organizer's job, and it stays visible either way. */}
        {!isConfirmed && (
          <OutstandingVoters
            outstanding={local.participants
              .map((participant) => participant.display_name)
              .filter((name) =>
                proposals.some((entry) => entry.tally.outstanding.includes(name)),
              )}
            total={local.participants.length}
            answered={answered}
            testID="decision-outstanding-all"
          />
        )}

        {/* ★ PHASE 10 — FOLLOW-THROUGH. Everything here needs a confirmed plan.
            RSVP, the calendar file, sharing, running late and dropping out are all
            about a place and time that now exist; before that the vote is the only
            honest signal (FR-6.1). */}
        {isConfirmed &&
          card &&
          rsvpState && (
            <View style={styles.followThrough} testID="decision-follow-through">
              <AttendeeList attendance={rsvpState.attendance} testID="decision-attendees" />

              <RsvpControls
                eventId={eventId}
                eventStatus={local.event.status}
                state={rsvpState}
                myName={local.me.display_name}
                onChange={setRsvpState}
                testID="decision-rsvp"
              />

              <AddToCalendarButton
                event={{
                  decisionId: card.decisionId,
                  title: card.venueName || card.axis,
                  venueName: card.venueName,
                  venueAddress: card.venueAddress,
                  startUtc: card.startUtc ?? local.event.voting_deadline ?? '',
                  endUtc: card.endUtc,
                  description: [card.datePrimary, card.timeRange].filter(Boolean).join(' · '),
                }}
                testID="decision-calendar"
              />

              <SharePlanButton plan={shareablePlan(card)} testID="decision-share" />

              <RunningLateAction
                eventId={eventId}
                statuses={[]}
                onReported={() => void loadRsvps()}
                testID="decision-running-late"
              />

              <CantMakeItAction
                eventId={eventId}
                alreadyCannot={rsvpState.mine === 'cannot'}
                onChanged={() => void loadRsvps()}
                testID="decision-cant-make-it"
              />

              {/* ★ THE PER-EVENT MUTE, OFFERED WHERE THE USER IS IN THE EVENT.
                  Settings lists every event; here the one they are looking at
                  is offered where they are already thinking about notifications
                  — and the hint restates the N4 exception beside the switch.
                  `mutedHere === null` means the payload has not landed, so the
                  switch is not rendered rather than rendered as off. */}
              {mutedHere !== null && (
                <MuteToggle
                  eventId={eventId}
                  muted={mutedHere}
                  onChange={setMutedHere}
                  testID="decision-mute"
                />
              )}
            </View>
          )}

        <Banner
          message={voteError ? t(voteError) : ''}
          visible={voteError !== null}
          tone="danger"
          actionLabel={t('common.ok')}
          onAction={clearError}
          testID="decision-vote-error"
        />

        <Banner
          message={confirmError ? t(confirmError) : ''}
          visible={confirmError !== null}
          tone="danger"
          actionLabel={t('common.retry')}
          onAction={() => void onConfirm()}
          testID="decision-confirm-error"
        />

        {/* Per-proposal voting, on the screen where the decision is made. */}
        {!isConfirmed &&
          resolved.map(({ proposal: entry, excluded, exclusion }) => {
            const mine = local.myVotes[entry.id] ?? null;
            const withdrawn = entry.status === 'WITHDRAWN';
            const vetoed = local.myDealbreakers.includes(entry.id);

            return (
              <View
                key={entry.id}
                style={[styles.proposalRow, excluded ? styles.proposalRowMuted : undefined]}
                testID={`decision-proposal-${entry.id}`}
              >
                <Text variant="h3" numberOfLines={2} color={excluded ? theme.textFaint : undefined}>
                  {entry.title}
                </Text>

                {/* ★ AN EXCLUDED VENUE STAYS VISIBLE, MUTED, WITH A REASON
                    NAMING THE PERSON (P08 rule). Dropping the card would leave
                    the group wondering where it went — and nobody would know
                    somebody had vetoed it. */}
                {exclusion && (
                  <Text
                    variant="caption"
                    color={theme.textMuted}
                    testID={`decision-vetoed-${entry.id}`}
                  >
                    {t('dealbreaker.vetoedBy', { name: exclusion.participantName })}
                  </Text>
                )}

                <TallyBar tally={tallyFor(entry.id)} testID={`decision-tally-${entry.id}`} />

                <VoteControl
                  current={mine}
                  onVote={(value) => void cast(entry.id, value)}
                  disabled={withdrawn}
                  pending={pending === entry.id}
                  showHelper={mine === null && !withdrawn}
                  veto={vetoed}
                  onToggleVeto={
                    withdrawn ? undefined : () => void toggleVeto(entry.id, !vetoed)
                  }
                  testID={`decision-vote-${entry.id}`}
                />
              </View>
            );
          })}

        {!isConfirmed && isOrganizer && proposals.length > 0 && (
          <Button
            label={t('decision.confirmAction')}
            onPress={() => setSheetOpen(true)}
            variant="brand"
            testID="decision-confirm"
          />
        )}

        {/* ★ REOPENING IS OFFERED ONLY WHERE IT CAN APPLY: a confirmed event, to
            its organizer. A guest who was overruled can ask; they cannot unilaterally
            restart a vote the group just finished. */}
        {isConfirmed && isOrganizer && (
          <Button
            label={t('reopen.action')}
            onPress={() => setReopenOpen(true)}
            variant="ghost"
            size="medium"
            testID="decision-reopen"
          />
        )}

        <Button
          label={t('common.back')}
          onPress={() => router.back()}
          variant="ghost"
          size="medium"
          testID="decision-back"
        />
      </ScrollView>

      {plan && (
        <ConfirmSheet
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          onConfirm={() => void onConfirm()}
          proposalTitle={plan.proposalTitle}
          outstanding={plan.outstanding}
          pending={confirming}
          testID="decision-confirm-sheet"
        />
      )}

      <ReopenSheet
        visible={reopenOpen}
        onDismiss={() => setReopenOpen(false)}
        onReopen={onReopen}
        errorKey={reopenError}
        testID="decision-reopen-sheet"
      />
    </View>
  );
}

/**
 * The status area's props, derived from the payload.
 *
 * ★ THE AREA SPEAKS ABOUT ONE PROPOSAL, AND SAYS WHICH.
 *
 * `FR-2.25`'s five elements are about a single thing being decided ("۷ از ۱۰",
 * the leading option, its reason). So the headline tally and the leader are both
 * taken from the SAME proposal — the earliest open one — rather than totalled
 * across the list. A tally summed over unrelated cards would answer a question
 * nobody asked, and pairing that sum with one card's leader would be worse.
 *
 * The lens and reason come from the engine's ranking, which Phase 8 mounts
 * inside this area. Until the screen holds a ranking there is no honest way to
 * name a lens, so the area renders no leader rather than inventing one.
 */
function toStatusProps(
  local: NonNullable<ReturnType<typeof useDecisionStatus>['status']>,
  axis: DecisionAxis,
) {
  const open = local.proposals.filter(
    (entry) => entry.proposal.status === 'OPEN' || entry.proposal.status === 'REOPENED',
  );

  const focus = open[0] ?? null;

  return {
    axis,
    tally: focus?.tally ?? {
      yes: 0,
      maybe: 0,
      no: 0,
      unanswered: local.participants.length,
      total: local.participants.length,
      voters: { yes: [], maybe: [], no: [] },
      outstanding: local.participants.map((participant) => participant.display_name),
    },
    leader: null,
    deadlineUtc: local.event.voting_deadline,
    participantCount: local.participants.length,
    proposalCount: local.proposals.length,
  };
}

/**
 * The plan, reduced to what a share message needs (Task 10).
 *
 * ★ NO COORDINATES (§8). The shared text carries the venue's NAME, which is the
 * same exposure as the line beside it. A coordinate in a group chat is a location
 * disclosure to people who were never invited.
 */
function shareablePlan(card: {
  venueName: string;
  venueAddress: string | null;
  startUtc: string | null;
  timeRange: string | null;
  going: number;
  maybe: number;
}): ShareablePlan {
  return {
    title: card.venueName,
    venueName: card.venueName,
    startUtc: card.startUtc,
    timeRange: card.timeRange,
    venueAddress: card.venueAddress,
    going: card.going,
    maybe: card.maybe,
    link: null,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[4],
  },
  proposalRow: {
    gap: space[3],
  },
  /**
   * The muted treatment for a dealbroken proposal.
   *
   * ★ MUTED, NOT HIDDEN (P08 rule). Reduced opacity is the one visual channel
   * that says "this is set aside" without removing the card from the flow — the
   * reason line and the tally inside it stay fully readable, because the group
   * needs to know both what was vetoed and by whom.
   */
  proposalRowMuted: {
    opacity: 0.55,
  },
  followThrough: {
    gap: space[4],
  },
});
