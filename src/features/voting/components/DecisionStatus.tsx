/**
 * The Decision Status area (Plan 07 Task 4, FR-2.25, PRD-11 S6).
 *
 * ★ THIS IS THE PRODUCT.
 *
 * PRD-17 §3: "Day 3's Decision Status area is the product. If Day 1 slips, cut
 * Day 4's map to a list before cutting anything from Day 3." It answers the only
 * question a participant has — what are we deciding, who has answered, what is
 * leading, and how long is left — without scrolling through chat.
 *
 * ★ THE FIVE REQUIRED ELEMENTS, ALL PRESENT, ALWAYS (FR-2.25).
 *
 *   1. What is being decided (the axis, named)
 *   2. Who has responded (`۷ از ۱۰`), expandable to the outstanding names
 *   3. Which option leads, with the ACTIVE LENS NAMED and its one-line reason
 *   4. What conflicts exist
 *   5. The time remaining, or «مهلتی تعیین نشده»
 *
 * ★ THE LENS NAME IS NEVER SEPARATED FROM THE RANKING (PRD-11 §15.8).
 *
 * An unexplained ranking is exactly the failure mode the research warns about:
 * the group sees a winner with no account of why it won and stops trusting the
 * tool. The reason line renders from `{templateId, params}` per locale, so it
 * reads correctly in either language and in either digit set.
 *
 * ★ EMPTY AND ALONE STATES ARE P0, NOT POLISH (§13.8, AC-11.3.1).
 *
 * The organizer alone on a new event is the FIRST thing every new organizer
 * sees. A blank panel at that moment loses them before the product has started,
 * so both states render an invitation to act.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { renderReason } from '@/src/lib/format';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';
import type { DecisionAxis } from '@/src/types/vote';
import type { Tally } from '@/src/types/vote';

import { OutstandingVoters } from './OutstandingVoters';

/**
 * The lens names.
 *
 * ★ THE WORDS THEMSELVES ARE P08'S.
 *
 * `ranking.lens.*` belongs to Plan 08's namespace, which this phase may not
 * write (see PARALLEL-EXECUTION §3.1). So the key is derived here and rendered
 * through a guarded `t`: when P08's catalogue has landed — which it has in the
 * merged tree — the real word appears, and when it has not the lens id is shown
 * rather than the raw key. No duplicate copy, no cross-namespace write, and no
 * `{balanced}` leaking to a Persian reader in the meantime.
 */
const LENS_KEY: Record<string, string> = {
  balanced: 'ranking.lens.balanced',
  fastest: 'ranking.lens.fastest',
  fairest: 'ranking.lens.fairest',
  cheapest: 'ranking.lens.cheapest',
};

/** The lens name, or the lens id when no catalogue entry has landed yet. */
function lensLabel(lens: string, t: (key: string) => string): string {
  const key = LENS_KEY[lens];
  if (!key) return lens;

  const translated = t(key);
  return translated === key ? lens : translated;
}

export interface DecisionStatusConflict {
  /** A template plus params, exactly like a reason. */
  detail: { templateId: string; params: Record<string, unknown> };
}

export interface DecisionStatusLeader {
  /** The leading proposal's title, or the venue name. */
  title: string;
  lens: string;
  reason: { templateId: string; params: Record<string, unknown> };
}

export interface DecisionStatusProps {
  axis: DecisionAxis;
  tally: Tally;
  /** `null` when nothing is leading yet — an unranked list or no votes. */
  leader: DecisionStatusLeader | null;
  conflicts?: DecisionStatusConflict[];
  /** The voting deadline, or `null` for «مهلتی تعیین نشده». */
  deadlineUtc: string | null;
  /** `now`, injected so the countdown is deterministic in tests. */
  now?: number;
  /** The participant count, so the alone state can be detected. */
  participantCount: number;
  /** The number of proposals on the event. */
  proposalCount: number;
  /** Shows the plan's action as the empty state's invitation. */
  onAddProposal?: () => void;
  testID?: string;
}

/** `۲ ساعت و ۱۴ دقیقه`, or a short form under an hour. */
function formatRemaining(deadlineUtc: string, now: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const remainingMs = Date.parse(deadlineUtc) - now;

  if (remainingMs <= 0) return t('decision.deadlinePassed');

  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return t('decision.timeRemainingShort', { minutes });
  return t('decision.timeRemaining', { hours, minutes });
}

export function DecisionStatus({
  axis,
  tally,
  leader,
  conflicts = [],
  deadlineUtc,
  now = Date.now(),
  participantCount,
  proposalCount,
  onAddProposal,
  testID,
}: DecisionStatusProps) {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const answered = tally.yes + tally.maybe + tally.no;

  // ★ AC-11.3.1 — the organizer alone gets an invitation, not a blank panel.
  if (proposalCount === 0) {
    return (
      <Card variant="raised" testID={testID}>
        <EmptyState
          title={t('decision.emptyTitle')}
          body={t('decision.emptyBody')}
          actionLabel={onAddProposal ? t('decision.emptyAction') : undefined}
          onAction={onAddProposal}
          testID={testID ? `${testID}-empty` : undefined}
        />
      </Card>
    );
  }

  const isAlone = participantCount <= 1;

  return (
    <Card variant="raised" testID={testID} style={styles.card}>
      {/* 1 — what is being decided */}
      <View style={styles.header}>
        <Text variant="h3" numberOfLines={2}>
          {t('decision.statusTitle')}
        </Text>
        <Text variant="caption" color={theme.brand}>
          {t(`decision.axes.${axis}`)}
        </Text>
      </View>

      {/* 2 — who has responded, expandable */}
      <OutstandingVoters
        outstanding={tally.outstanding}
        total={tally.total}
        answered={answered}
        testID={testID ? `${testID}-outstanding` : undefined}
      />

      {isAlone && (
        <Text variant="caption" color={theme.textFaint}>
          {t('decision.youAreAlone')}
        </Text>
      )}

      {/* 3 — what leads, with the lens NAMED and its reason */}
      {leader ? (
        <View style={[styles.leader, { borderColor: theme.line }]}>
          <View style={styles.leaderHead}>
            <Text variant="bodyL" numberOfLines={2} style={styles.leaderTitle}>
              {leader.title}
            </Text>
            <Text variant="caption" color={theme.textMuted}>
              {t('decision.statusLeading')}
            </Text>
          </View>

          {/* The lens name, always adjacent to the ranking (PRD-11 §15.8). */}
          <Text variant="caption" color={theme.brand} testID={testID ? `${testID}-lens` : undefined}>
            {lensLabel(leader.lens, t)}
          </Text>

          <Text variant="caption" color={theme.textMuted}>
            {renderReason(
              {
                templateId: leader.reason.templateId as never,
                params: leader.reason.params as never,
              },
              locale,
            )}
          </Text>
        </View>
      ) : (
        <Text variant="caption" color={theme.textFaint}>
          {t('decision.decidingTitle')}
        </Text>
      )}

      {/* 4 — conflicts */}
      {conflicts.length > 0 && (
        <View testID={testID ? `${testID}-conflicts` : undefined} style={styles.conflicts}>
          {conflicts.slice(0, 3).map((conflict, index) => (
            <Text key={index} variant="caption" color={theme.warning} numberOfLines={2}>
              {renderReason(
                {
                  templateId: conflict.detail.templateId as never,
                  params: conflict.detail.params as never,
                },
                locale,
              )}
            </Text>
          ))}
        </View>
      )}

      {/* 5 — time remaining, or the honest absence of a deadline */}
      <Text
        variant="caption"
        color={theme.textFaint}
        numeric={deadlineUtc !== null}
        testID={testID ? `${testID}-deadline` : undefined}
      >
        {deadlineUtc ? formatRemaining(deadlineUtc, now, t) : t('decision.noDeadline')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[4],
    borderRadius: radius.lg,
  },
  header: {
    gap: space[1],
  },
  leader: {
    gap: space[1],
    borderWidth: border.hairline,
    borderRadius: radius.md,
    padding: space[3],
  },
  leaderHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[2],
  },
  leaderTitle: {
    flex: 1,
  },
  conflicts: {
    gap: space[1],
  },
});
