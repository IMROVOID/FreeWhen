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

import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ElementRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { Card } from '@/src/components/ui/Card';
import {
  anchorFromPress,
  anchorFromRow,
  pressPointOf,
  type MenuAnchor,
} from '@/src/features/events/services/menu-placement';
import { haptics } from '@/src/platform/haptics';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventStatus, EventSummary } from '@/src/types/event';

export interface EventRowProps {
  event: EventSummary;
  onPress: () => void;
  /**
   * Opens the row's context menu, at the point that was pressed.
   *
   * ★ THE ROW IS THE ONLY PLACE THE EVENT CAN BE ACTED ON.
   *
   * Leaving an event, changing where you travel from, and — for the owner — renaming
   * or deleting it all lived inside the event, behind an action grid. The row you are
   * looking at was the one surface where none of it was reachable, so this is a hold
   * rather than another button: the row already carries a status chip and an
   * attention badge, and a third control would make a list of them unreadable.
   *
   * ★ IT CARRIES THE PRESS POINT, NOT JUST THE ROW.
   *
   * `nativeEvent.locationX/locationY` are the touch's position INSIDE the row, so
   * adding the row's window rect gives the finger's window point — which is what
   * the menu is placed from. Passing only the rect is what pinned the menu to a
   * corner: with a row spanning the whole list, "the row's leading edge" is the
   * list's edge, wherever the finger actually was.
   *
   * The rect comes from `measureInWindow` at the moment of the hold, because the
   * list scrolls and an offset captured earlier would place the menu somewhere
   * else.
   */
  onLongPress?: (anchor: MenuAnchor) => void;
}

/** How long a press must hold before the menu opens. */
const LONG_PRESS_MS = 420;

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

export function EventRow({ event, onPress, onLongPress }: EventRowProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const statusLabel = t(`events.status.${event.status}`);

  /**
   * The wrapper this row measures.
   *
   * The bounds are taken at the moment of the hold, not on layout: the list scrolls,
   * so a rect captured during layout would place the menu wherever the row used to be.
   */
  const containerRef = useRef<ElementRef<typeof View>>(null);

  /**
   * Measures the row, then reports the press point in WINDOW coordinates.
   *
   * `measureInWindow` is asynchronous, so the press offset is carried through the
   * callback rather than read after it.
   */
  const report = useCallback(
    (event?: unknown) => {
      if (!onLongPress) return;

      const press = event === undefined ? null : pressPointOf(event);

      containerRef.current?.measureInWindow((x, y, width, height) => {
        const rect = { x, y, width, height };
        onLongPress(press ? anchorFromPress(rect, press) : anchorFromRow(rect));
      });
    },
    [onLongPress],
  );

  return (
    <View
      ref={containerRef}
      // Screen readers get the menu as an explicit action, since a hold is not a
      // gesture they perform. There is no press point, so the anchor is the row's
      // centre — a menu at the middle of the row it belongs to.
      accessibilityActions={
        onLongPress ? [{ name: 'longpress', label: t('events.contextMenu.open') }] : undefined
      }
      onAccessibilityAction={(event_) => {
        if (event_.nativeEvent.actionName !== 'longpress') return;
        report();
      }}
    >
      <Card
        variant="surface"
        onPress={onPress}
        onLongPress={
          onLongPress
            ? (event_) => {
                haptics.impact('medium');
                // The point conversion is platform-aware: a DOM event has no
                // `locationX`, so `pressPointOf` derives it — see menu-placement.
                report(event_);
              }
            : undefined
        }
        delayLongPress={LONG_PRESS_MS}
        testID={`event-row-${event.id}`}
        style={styles.card}
      >
      <View style={styles.header}>
        {/* ★ THE TITLE STARTS WHERE THE LANGUAGE STARTS.
            `align="start"` is the RIGHT edge in a Persian layout and the left in
            English, which is what "move the event titles to the right" means in
            an RTL product. It has to be declared: the title's parent is a plain
            row, and a `Text` that does not state its alignment takes the
            container's, which on the web build is the document default rather
            than the document direction. */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // ★ NO `marginBottom` HERE.
    //
    // The row used to carry `marginBottom: space[3]` while its container
    // (`ScreenStateGate`) also applied `gap: space[3]`, so the gap between two
    // event boxes was twice the design system's step — 24 where every other list
    // in the app uses 12. The list container owns the rhythm; a row that also
    // spaces itself makes the sheet's spacing unchangeable from one place.
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  /**
   * ★ THE TITLE SHRINKS, IT DOES NOT CLAIM THE ROW.
   *
   * `flex: 1` let the title take every pixel the status chip did not want, so
   * a short event name left a wide band of empty leading space before the
   * chip and the chip drifted to the middle of the card. `flexShrink` lets a
   * long name wrap while a short one stays beside the chip, which is what puts
   * the title on its reading edge and the status on the opposite one.
   */
  title: {
    flexShrink: 1,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    // The chip is never the thing that gives way; the title wraps first.
    flexShrink: 0,
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
