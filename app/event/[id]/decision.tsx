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
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/src/components/ui/Toast';
import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { getStoredUserId } from '@/src/lib/session';
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
import { buildDecisionCard } from '@/src/features/voting/services/decision-card';
import { confirm, planConfirmation } from '@/src/features/voting/services/confirm';

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

  // A local copy so the optimistic patch has somewhere to land. The hook's own
  // payload stays the source of truth across refetches.
  const [local, setLocal] = useState(status);
  useEffect(() => {
    setLocal(status);
  }, [status]);

  const { cast, pending, errorKey: voteError, clearError } = useVote({
    status: local,
    setStatus: setLocal,
    reload,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // The confirmed state is what fires the Meet Point, and only on the edge.
  const wasConfirmed = useRef(false);

  const proposals = local?.proposals ?? [];
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
    });
  }, [decision, chosenEntry, local, locale]);

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

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <ActivityIndicator color={theme.textMuted} testID="decision-loading" />
      </View>
    );
  }

  if (!local) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <EmptyState
          title={t('decision.emptyTitle')}
          body={errorKey ? t(errorKey) : t('errors.notParticipant')}
          actionLabel={t('common.retry')}
          onAction={() => void reload()}
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
          proposals.map((entry) => {
            const mine = local.myVotes[entry.proposal.id] ?? null;
            const withdrawn = entry.proposal.status === 'WITHDRAWN';

            return (
              <View
                key={entry.proposal.id}
                style={styles.proposalRow}
                testID={`decision-proposal-${entry.proposal.id}`}
              >
                <Text variant="h3" numberOfLines={2}>
                  {entry.proposal.title}
                </Text>

                <TallyBar tally={entry.tally} testID={`decision-tally-${entry.proposal.id}`} />

                <VoteControl
                  current={mine}
                  onVote={(value) => void cast(entry.proposal.id, value)}
                  disabled={withdrawn}
                  pending={pending === entry.proposal.id}
                  showHelper={mine === null && !withdrawn}
                  testID={`decision-vote-${entry.proposal.id}`}
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
    gap: space[4],
  },
  proposalRow: {
    gap: space[3],
  },
});
