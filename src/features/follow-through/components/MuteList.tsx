/**
 * The per-event mute list for Settings (Plan 10 Task 6, FR-6.19).
 *
 * ★ THE PREFERENCE IS PER EVENT, SO THE CONTROL IS PER EVENT.
 *
 * `MuteToggle` mutes one participant in one event. Settings is not event-scoped,
 * so this lists the caller's events and mounts one toggle each — rendering a
 * single global switch would have to pick an event silently, and the choice the
 * user thought they made would apply to a different event than they assumed.
 *
 * ★ IT READS FROM THE EVENT LIST, NOT ONE REQUEST PER ROW.
 *
 * `EventSummary.notifications_muted` is the caller's own flag for that event, so
 * the list the app already fetches carries the state. A request per event would
 * turn opening Settings into N round trips on a connection this product is
 * explicitly built for.
 *
 * Events nobody should be able to mute are still listed: a confirmed event still
 * sends its decision, and hiding the row would imply the mute could suppress it.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import type { EventSummary } from '@/src/types/event';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { MuteToggle } from './MuteToggle';

export interface MuteListProps {
  events: EventSummary[];
  isLoading: boolean;
  testID?: string;
}

export function MuteList({ events, isLoading, testID }: MuteListProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  // The optimistic value lives here, keyed by event, so a rejected write can be
  // reverted to the last state the server confirmed rather than to a guess.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const onToggle = useCallback((eventId: string, muted: boolean) => {
    setOverrides((current) => ({ ...current, [eventId]: muted }));
  }, []);

  if (isLoading) {
    return <ListSkeleton rows={2} testID={testID ? `${testID}-loading` : undefined} />;
  }

  if (events.length === 0) {
    return (
      <Text variant="caption" color={theme.textMuted} testID={testID ? `${testID}-empty` : undefined}>
        {t('notifications.muteList.empty')}
      </Text>
    );
  }

  return (
    <View style={styles.list} testID={testID}>
      <Text variant="caption" color={theme.textMuted}>
        {t('notifications.muteList.hint')}
      </Text>

      {events.map((event) => (
        <View key={event.id} style={styles.row} testID={`${testID ?? 'mute-list'}-${event.id}`}>
          <Text variant="body" weight={600} numberOfLines={1}>
            {event.title}
          </Text>

          <MuteToggle
            eventId={event.id}
            muted={overrides[event.id] ?? event.notifications_muted}
            onChange={(next) => onToggle(event.id, next)}
            testID={`mute-${event.id}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space[4],
  },
  row: {
    gap: space[2],
  },
});
