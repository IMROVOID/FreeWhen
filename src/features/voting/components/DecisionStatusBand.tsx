/**
 * The one-line decision summary shown above every event screen (Plan 07 Task 4).
 *
 * ★ IT EXISTS BECAUSE THE STATUS AREA MUST BE ON EVERY EVENT SCREEN (P2, FR-2.25).
 *
 * The full area (S6/S12) lives on `app/event/[id]/decision.tsx`, where voting and
 * confirmation happen. This band carries the one fact a participant needs from
 * anywhere else — who has answered, and whether the decision is already made —
 * and taps through to it. Mounting a second full area in the layout would double
 * both the polling and the render weight of the app's signature component.
 *
 * ★ IT NEVER BLOCKS, AND IT RENDERS NOTHING WHEN IT CANNOT KNOW.
 *
 * A layout-level element must not take the screen beneath it down, so every state
 * here is one line of text at worst: no event means no band, a dropped socket
 * means a quiet `reconnecting` note, and a failed load means the band simply is
 * not there.
 */

import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Users } from 'phosphor-react-native';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { toPersianDigits } from '@/src/lib/jalali';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { useDecisionStatus } from '../hooks/useDecisionStatus';
import type { DecisionStatusResponse } from '../services/voting-api';
import type { ConnectionState } from '../services/realtime-engine';

export interface DecisionStatusBandProps {
  eventId: string;
  /**
   * A payload the host screen already holds.
   *
   * ★ TWO POLLERS ON ONE SCREEN IS A BUG, NOT A SAFETY NET.
   *
   * The event home shows vote controls, which need the same payload this band
   * summarises. Two independent `useDecisionStatus` calls would run two intervals
   * and two requests every ten seconds for identical data. A screen that already
   * polls passes what it has; every other screen lets the band own its own.
   */
  shared?: {
    status: DecisionStatusResponse | null;
    connection: ConnectionState;
  };
}

export function DecisionStatusBand({ eventId, shared }: DecisionStatusBandProps) {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isFa = i18n.language === 'fa';

  // The hook is still called unconditionally — rules of hooks — but its work is
  // disabled when the host supplies the payload.
  const own = useDecisionStatus({ eventId, enabled: shared === undefined });

  const status = shared ? shared.status : own.status;
  const connection = shared ? shared.connection : own.connection;

  if (!status) return null;

  const proposals = status.proposals;
  const answered = proposals.reduce(
    (sum, entry) => sum + entry.tally.yes + entry.tally.maybe + entry.tally.no,
    0,
  );

  const open = proposals.filter(
    (entry) => entry.proposal.status === 'OPEN' || entry.proposal.status === 'REOPENED',
  );
  const focus = open[0] ?? proposals[0] ?? null;
  const focusAnswered = focus ? focus.tally.yes + focus.tally.maybe + focus.tally.no : 0;
  const total = focus?.tally.total ?? status.participants.length;
  const votedCount = Math.min(total, focusAnswered > 0 ? focusAnswered : answered);
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((votedCount / total) * 100))) : 0;
  const isConfirmed = Object.keys(status.decisions).length > 0;

  const percentLabel = isFa ? `${toPersianDigits(String(percent))}٪` : `${percent}%`;

  return (
    <Pressy
      onPress={() =>
        router.push({ pathname: '/event/[id]/decision', params: { id: eventId, axis: 'time' } })
      }
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={t('voting.tallySummary', { voted: votedCount, total })}
      testID="event-decision-band"
      style={styles.container}
    >
      <View
        style={[
          styles.band,
          {
            backgroundColor: theme.surface2,
            borderColor: theme.line,
          },
        ]}
      >
        {/* Progress fill track.
            ★ A ZERO-WIDTH FILL IS NOT RENDERED AT ALL.
            At `0%` the track still drew its rounded edge, so an event where
            nobody had voted showed a coloured sliver that read as a failed
            theme colour rather than "no progress yet". */}
        {percent > 0 ? (
          <View
            style={[
              styles.progressTrack,
              {
                backgroundColor: isConfirmed ? theme.brand : theme.primary,
                width: `${percent}%`,
              },
            ]}
          />
        ) : null}

        {/* Content row over the fill track */}
        <View style={styles.contentRow}>
          <View style={styles.labelSection}>
            {isConfirmed ? (
              <CheckCircle size={18} color={theme.brand} weight="fill" />
            ) : (
              <Users size={18} color={theme.textMuted} weight="bold" />
            )}
            <Text
              variant="body"
              weight={600}
              color={isConfirmed ? theme.brand : theme.text}
              numeric
              numberOfLines={1}
            >
              {isConfirmed
                ? t('decision.viewDecision')
                : t('voting.tallySummary', { voted: votedCount, total })}
            </Text>
          </View>

          <View style={styles.trailingSection}>
            {connection === 'reconnecting' ? (
              <Text variant="caption" color={theme.textFaint}>
                {t('voting.reconnecting')}
              </Text>
            ) : (
              <View style={[styles.percentBadge, { backgroundColor: theme.surface3 }]}>
                <Text variant="caption" weight={700} color={theme.brand} numeric>
                  {percentLabel}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  band: {
    height: size.buttonMedium,
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Logical inset, so the fill grows from the leading edge in both directions
    // without a conditional physical side.
    insetInlineStart: 0,
    opacity: 0.22,
    borderRadius: radius.pill,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    gap: space[2],
  },
  labelSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flex: 1,
  },
  trailingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  percentBadge: {
    paddingHorizontal: space[2],
    paddingVertical: space[1] / 2,
    borderRadius: radius.pill,
  },
});
