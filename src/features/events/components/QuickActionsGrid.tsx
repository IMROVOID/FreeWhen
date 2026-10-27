/**
 * The event home's quick actions, as one component.
 *
 * ★ FIVE TILES, TWO PER ROW, AND THE LAST ONE TAKES THE ROW.
 *
 * The grid lays out two per row. With five tiles the fifth lands alone, and
 * `flex: 1` then stretched it into a full-width bar that read as a separate
 * control pinned under the page. That is why Settings was added here in the
 * first place — as a sixth tile, purely so the count stayed even.
 *
 * That was the wrong fix. Settings is not about this event; it is an app door,
 * and in a grid of event actions it read as a seventh event command. It now
 * lives on the app's home screen, where it belongs, and the grid is back to the
 * five things an event actually has. The orphan problem is solved by the LAYOUT
 * instead of by the tile count: the last tile declares itself `wide` and
 * spans both columns, so the row is always full at any count.
 *
 * Extracted from the screen so the layout can be tested without mounting a
 * data-bound route.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  CalendarCheck,
  ChatCircleDots,
  ClockCounterClockwise,
  Gear,
  ShareNetwork,
} from 'phosphor-react-native';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface QuickActionsGridProps {
  onOpenSlots: () => void;
  onShare: () => void;
  onOpenActivity: () => void;
  onOpenChat: () => void;
  onOpenManagement: () => void;
}

interface ActionSpec {
  /** Matched by the tests, and the DOM marker that proves the tile exists. */
  key: string;
  label: string;
  onPress: () => void;
  Icon: typeof Gear;
  /** Spans the row it is left on. Only the last tile may set it. */
  wide?: boolean;
}

export function QuickActionsGrid({
  onOpenSlots,
  onShare,
  onOpenActivity,
  onOpenChat,
  onOpenManagement,
}: QuickActionsGridProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  // ★ THE PER-EVENT ACTIONS ONLY.
  //
  // Settings was the sixth entry here. It is the app's, not this event's, and
  // its presence made the whole grid read as "every button in the product"
  // rather than "what you can do with this plan". It has its own door on `/`.
  const actions: ActionSpec[] = [
    { key: 'slots', label: t('slots.heading'), onPress: onOpenSlots, Icon: ClockCounterClockwise },
    { key: 'share', label: t('invite.share'), onPress: onShare, Icon: ShareNetwork },
    { key: 'activity', label: t('a11y.openActivity'), onPress: onOpenActivity, Icon: CalendarCheck },
    { key: 'chat', label: t('chat.open'), onPress: onOpenChat, Icon: ChatCircleDots },
    {
      key: 'management',
      label: t('events.management.title'),
      onPress: onOpenManagement,
      Icon: Gear,
      // ★ THE ODD TILE OUT WIDENS, IT DOES NOT STRETCH.
      //
      // Configuration is the event's most consequential door, so it earns the
      // full width rather than being left as a half-width tile beside a gap.
      wide: true,
    },
  ];

  return (
    <View style={styles.grid}>
      {actions.map(({ key, label, onPress, Icon, wide }) => (
        <Pressy
          key={key}
          onPress={onPress}
          testID={`event-home-${key}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[styles.tile, wide ? styles.tileWide : null]}
        >
          <View style={[styles.tileInner, { backgroundColor: theme.surface2 }]}>
            <Icon size={22} color={theme.text} weight="bold" />
            <Text variant="caption" color={theme.text} align="center">
              {label}
            </Text>
          </View>
        </Pressy>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    marginTop: space[4],
  },
  tile: {
    /**
     * ★ AN EXPLICIT MINIMUM IS WHAT MAKES THE ROW WRAP.
     *
     * `flexBasis: 0` alone was wrong: with nothing but `gap`, every tile
     * shrank to fit ONE row, which is the squeezed columns with overlapping
     * labels that shipped. A percentage basis also overflows once the row's
     * `gap` is added on top.
     *
     * `flex: 1` with a `minWidth` is the combination that behaves: each tile
     * asks for an equal share, and the minimum is what forces the row to break
     * rather than compress. Two per row at any realistic phone width.
     */
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: '45%',
    minWidth: 132,
  },
  /** The last tile fills its row, so no row is ever left half empty. */
  tileWide: {
    flexBasis: '100%',
  },
  tileInner: {
    borderRadius: radius.lg,
    paddingVertical: space[4],
    paddingHorizontal: space[3],
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 88,
  },
});
