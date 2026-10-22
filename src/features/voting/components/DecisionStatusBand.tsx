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

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { border, radius, space } from '@/src/theme/tokens';
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
  const { t } = useTranslation();
  const router = useRouter();

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
  const total = focus?.tally.total ?? status.participants.length;
  const isConfirmed = Object.keys(status.decisions).length > 0;

  return (
    <Pressy
      onPress={() =>
        router.push({ pathname: '/event/[id]/decision', params: { id: eventId, axis: 'time' } })
      }
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={t('voting.tallySummary', { voted: answered, total })}
      testID="event-decision-band"
    >
      <View style={[styles.band, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        <Text
          variant="caption"
          color={isConfirmed ? theme.brand : theme.text}
          numeric
          numberOfLines={1}
          style={styles.text}
        >
          {isConfirmed
            ? t('decision.viewDecision')
            : t('voting.tallySummary', { voted: answered, total })}
        </Text>

        {connection === 'reconnecting' && (
          <Text variant="caption" color={theme.textFaint}>
            {t('voting.reconnecting')}
          </Text>
        )}
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    borderWidth: border.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  text: {
    flex: 1,
  },
});
