/**
 * One proposal, as the event screens render it (Plan 06 Task 9).
 *
 * ★ EVERY CARD STATES WHAT IT IS AND WHEN IT WAS MADE.
 *
 * A list of options that does not say how it is ordered reads as a ranking, and
 * a user who reads creation order as a ranking will argue with the group about
 * a score nobody computed. The order is therefore stated by the list, and each
 * card carries only facts: type, time in Jalali with Gregorian beneath it, the
 * proposer, and notes.
 *
 * ★ A WITHDRAWN PROPOSAL IS STRUCK THROUGH, NOT REMOVED (PRD-02 E4).
 *
 * The row survives so the history survives. Removing the card would erase the
 * fact that somebody suggested it and changed their mind — which is precisely
 * the context the group needs when they wonder why a place is no longer on the
 * table.
 */

import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { formatDate } from '@/src/lib/format';
import { toPersianDigits } from '@/src/lib/jalali';
import { trackOpeningHoursWarningShown } from '@/src/features/proposals/services/analytics';
import {
  ADVISORY_KEY_BY_VERDICT,
  openingHoursAdvisory,
} from '@/src/features/proposals/services/opening-hours';
import { endsNextDay, formatLocalTime } from '@/src/features/proposals/services/slot-time';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Proposal } from '@/src/types/proposal';
import type { Language } from '@/src/i18n/types';

export interface ProposalCardProps {
  proposal: Proposal;
  /** The event's home timezone — the slot is rendered in it, not the device's. */
  homeTz: string;
  onPress?: () => void;
  /** Opens the comment sheet for this proposal. Absent = no affordance. */
  onOpenComments?: () => void;
  /** How many comments the proposal carries, when the caller knows. */
  commentCount?: number;
  testID?: string;
}

/** The digits rule: Persian numerals in `fa`, Latin in `en` (AC-3.1.1). */
function localiseDigits(value: string, language: string): string {
  return language === 'en' ? value : toPersianDigits(value);
}

/**
 * The instant the hours advisory is computed at.
 *
 * A timed proposal is checked at its own start — that is the moment the group
 * cares about. A place-only proposal has no start, so `now` is the honest
 * question ("is it open if we went today?"), and `openingHoursAdvisory` treats
 * an unparseable start the same way.
 */
function advisoryInstant(proposal: Proposal): Date {
  if (proposal.start_utc && Number.isFinite(Date.parse(proposal.start_utc))) {
    return new Date(proposal.start_utc);
  }

  return new Date();
}

export function ProposalCard({
  proposal,
  homeTz,
  onPress,
  onOpenComments,
  commentCount,
  testID,
}: ProposalCardProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const language = (i18n.language === 'en' ? 'en' : 'fa') as Language;
  const isWithdrawn = proposal.status === 'WITHDRAWN';

  const date = proposal.start_utc ? formatDate(proposal.start_utc, language) : null;
  const startTime = proposal.start_utc ? formatLocalTime(proposal.start_utc, homeTz) : null;
  const endTime = proposal.end_utc ? formatLocalTime(proposal.end_utc, homeTz) : null;
  const crossesMidnight =
    proposal.start_utc !== null &&
    proposal.end_utc !== null &&
    endsNextDay(proposal.start_utc, proposal.end_utc, homeTz);

  // The struck-through treatment for a withdrawn row.
  const struck = isWithdrawn ? { textDecorationLine: 'line-through' as const } : undefined;

  // Absence of hours is a data-quality signal, so it is measured when shown.
  const hoursUnknown = proposal.venue != null && proposal.venue.opening_hours == null;

  // ★ THE ADVISORY REPORTS; IT NEVER REFUSES (AC-3.3.1).
  //
  // Nothing below gates a button, a vote or the card's presence — the verdict
  // only chooses which line to print and which colour to print it in. A closed
  // verdict is a warning on a proposal that stays exactly as votable as before.
  const hoursVerdict =
    proposal.venue != null
      ? openingHoursAdvisory(proposal.venue.opening_hours, advisoryInstant(proposal), homeTz)
          .advisory
      : null;

  const hoursAdvisory = hoursVerdict ? ADVISORY_KEY_BY_VERDICT[hoursVerdict] : null;

  useEffect(() => {
    if (hoursUnknown) trackOpeningHoursWarningShown(false);
  }, [hoursUnknown]);

  return (
    <Card
      variant="surface"
      onPress={onPress}
      testID={testID}
      style={styles.card}
    >
      <View style={styles.header}>
        <Text
          variant="h3"
          color={isWithdrawn ? theme.textFaint : undefined}
          style={struck}
          numberOfLines={2}
        >
          {proposal.title}
        </Text>

        <Chip
          label={t(`proposals.type.${proposal.type}`)}
          testID={testID ? `${testID}-type` : undefined}
        />
      </View>

      {date && (
        <View style={styles.timeBlock}>
          <Text variant="body" color={isWithdrawn ? theme.textFaint : theme.text} style={struck}>
            {t('proposals.card.timeLine', {
              date: date.primary,
              start: localiseDigits(startTime ?? '', language),
              end: localiseDigits(endTime ?? '', language),
            })}
          </Text>

          {/* The other calendar, always present, always secondary (PRD-03 §3.2). */}
          <Text variant="caption" color={theme.textMuted}>
            {t('time.secondaryCalendar', {
              calendar: t(language === 'fa' ? 'time.gregorian' : 'time.jalali'),
            })}
            {': '}
            {date.secondary}
          </Text>

          {/* E4 — a slot must say when it runs into the next day. */}
          {crossesMidnight && (
            <Text variant="caption" color={theme.warning}>
              {t('proposals.card.endsNextDay')}
            </Text>
          )}
        </View>
      )}

      {proposal.venue && (
        <View style={styles.timeBlock}>
          <Text variant="body" color={isWithdrawn ? theme.textFaint : theme.text} style={struck}>
            {proposal.venue.name}
          </Text>
          {proposal.venue.address && (
            <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
              {proposal.venue.address}
            </Text>
          )}
          {/* ★ ABSENCE OF HOURS IS NOT "CLOSED" (E9).
              The advisory resolves `null` to «نامشخص» rather than to a blank
              line, which would read as "open". */}
          {hoursAdvisory && (
            <Text
              variant="caption"
              color={hoursVerdict === 'closed' ? theme.warning : theme.textFaint}
              testID={testID ? `${testID}-hours-advisory` : undefined}
            >
              {t(hoursAdvisory)}
            </Text>
          )}
        </View>
      )}

      {proposal.notes && (
        <Text
          variant="body"
          color={theme.textMuted}
          numberOfLines={4}
          style={isWithdrawn ? struck : undefined}
        >
          {proposal.notes}
        </Text>
      )}

      <View style={styles.footer}>
        <Text variant="caption" color={theme.textFaint}>
          {t('proposals.card.proposedBy', { name: proposal.proposer_name })}
        </Text>

        {/* FR-2.9 — a proposal that arrived after voting began says so. */}
        {proposal.is_late && (
          <Text variant="caption" color={theme.warning}>
            {t('proposals.card.lateMarker')}
          </Text>
        )}

        {isWithdrawn && (
          <Text variant="caption" color={theme.textFaint}>
            {t('proposals.status.WITHDRAWN')}
          </Text>
        )}

        {/* ★ COMMENTS ARE AN AFFORDANCE, NOT A GATE.
            Opening the sheet is optional and never required to vote, propose or
            see the decision — that is the P14 constraint, and the reason this is
            a plain button on the card rather than a step in a flow. */}
        {onOpenComments && (
          <Pressy
            onPress={onOpenComments}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('comments.open')}
            testID={testID ? `${testID}-comments` : undefined}
          >
            <Text variant="caption" color={theme.textMuted}>
              {typeof commentCount === 'number' && commentCount > 0
                ? t('comments.count', { count: commentCount })
                : t('comments.action')}
            </Text>
          </Pressy>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  timeBlock: {
    gap: space[1],
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[2],
    borderRadius: radius.sm,
  },
});
