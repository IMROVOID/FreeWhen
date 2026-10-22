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
import { Text } from '@/src/components/ui/Text';
import { formatDate } from '@/src/lib/format';
import { toPersianDigits } from '@/src/lib/jalali';
import { trackOpeningHoursWarningShown } from '@/src/features/proposals/services/analytics';
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
  testID?: string;
}

/** The digits rule: Persian numerals in `fa`, Latin in `en` (AC-3.1.1). */
function localiseDigits(value: string, language: string): string {
  return language === 'en' ? value : toPersianDigits(value);
}

export function ProposalCard({ proposal, homeTz, onPress, testID }: ProposalCardProps) {
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
          {/* ★ ABSENCE OF HOURS IS NOT "CLOSED" (E9). */}
          {hoursUnknown && (
            <Text variant="caption" color={theme.textFaint}>
              {t('proposals.card.hoursUnknown')}
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
