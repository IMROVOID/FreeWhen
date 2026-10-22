/**
 * One row of S1 (Plan 05 Task 6, PRD-11 S1).
 *
 * Title, status, participant count, and the attention badge. The badge is the
 * reason this component exists as its own file: it is the app's lightweight
 * substitute for push and has to read clearly at a glance, in both directions,
 * with notifications switched off.
 *
 * Colour is never the only carrier of the status — the chip has text, and the
 * badge has text. That is what makes the row legible in greyscale and to a
 * screen reader (PRD-11 §8).
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { Card } from '@/src/components/ui/Card';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventStatus, EventSummary } from '@/src/types/event';

export interface EventRowProps {
  event: EventSummary;
  onPress: () => void;
}

/** The status colours. Volt stays reserved for "decided" and nothing else. */
function statusColor(status: EventStatus, theme: ReturnType<typeof useTheme>['t']): string {
  switch (status) {
    case 'CONFIRMED':
      return theme.success;
    case 'OPEN':
    case 'DECIDING':
      return theme.brand;
    case 'DRAFT':
      return theme.textMuted;
    case 'PAST':
    case 'CANCELLED':
      return theme.textFaint;
  }
}

export function EventRow({ event, onPress }: EventRowProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const statusLabel = t(`events.status.${event.status}`);

  return (
    <Card
      variant="surface"
      onPress={onPress}
      testID={`event-row-${event.id}`}
      style={styles.card}
    >
      <View style={styles.header}>
        <Text variant="h3" align="start" numberOfLines={2} style={styles.title}>
          {event.title}
        </Text>

        <View
          style={[styles.statusChip, { backgroundColor: theme.surface2 }]}
          accessibilityLabel={statusLabel}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor(event.status, theme) }]} />
          <Text variant="caption" color={theme.text} align="start">
            {statusLabel}
          </Text>
        </View>
      </View>

      <View style={styles.meta}>
        <Text variant="caption" color={theme.textMuted} align="start" numeric>
          {t('events.list.participantCount', { count: event.participant_count })}
        </Text>

        {event.has_pending_vote && (
          <View
            style={[styles.badge, { backgroundColor: theme.primary }]}
            accessibilityRole="text"
            accessibilityLabel={t('events.list.pendingAction')}
            testID={`event-row-${event.id}-attention`}
          >
            <Text variant="caption" color={theme.onPrimary} align="start">
              {t('events.list.pendingAction')}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  title: {
    flex: 1,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  statusDot: {
    width: space[2],
    height: space[2],
    borderRadius: radius.pill,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    marginTop: space[3],
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
});
