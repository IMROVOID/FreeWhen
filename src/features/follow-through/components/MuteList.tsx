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
  /**
   * False greys every row out and makes it read-only.
   *
   * ★ THE GENERAL SWITCH GREYS; IT DOES NOT FORCE.
   *
   * The per-event stored value is left untouched, which is what lets turning the
   * general switch back on restore exactly what was muted before. The rows
   * DISPLAY as muted meanwhile — the app has silenced them — but nothing is
   * written, so there is nothing to undo.
   */
  interactive?: boolean;
  testID?: string;
}

export function MuteList({ events, isLoading, interactive = true, testID }: MuteListProps) {
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
      {/*
        ★ NO SECTION HINT.
        This read «انتخاب کنید کدام رویدادها می‌توانند به شما اطلاع دهند.» above a
        list whose rows are literally event names with a switch beside each one. The
        sentence explained the only thing the shape already said, on a screen the
        user asked to be less wordy.

        Each row is now the NAME and its SWITCH and nothing else.
      */}
      {events.map((event) => (
        <View key={event.id} style={styles.row} testID={`${testID ?? 'mute-list'}-${event.id}`}>
          {/* ★ `align="start"` IS NOT OPTIONAL HERE.
              The default is `start`, but the ROW it sits in is a plain
              `View` whose direction comes from the document. On the web build a
              `Text` that did not declare its own alignment inherited the
              container's, and the container had no `dir`, so the event name
              rendered left-aligned inside an otherwise RTL screen. Declaring it
              puts the name on the reading edge — the right one in Persian —
              independent of what the row does. */}
          <Text variant="body" weight={600} numberOfLines={1} align="start" style={styles.title}>
            {event.title}
          </Text>

          <MuteToggle
            eventId={event.id}
            muted={interactive ? (overrides[event.id] ?? event.notifications_muted) : true}
            onChange={(next) => onToggle(event.id, next)}
            disabled={!interactive}
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
    // ★ A ROW, WITH THE NAME TAKING THE FREE SPACE.
    //
    // This was a plain column, so the event name sat ABOVE its switch instead of
    // beside it, and the name's leading edge followed the column's stretch rather
    // than its own `align="start"`. Laying it out as a row with `flex: 1` on the
    // name is what puts the title on the reading edge and the switch on the
    // opposite one — mirrored automatically by the document direction, so no
    // `row-reverse` branch is needed.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  title: {
    flex: 1,
  },
});
