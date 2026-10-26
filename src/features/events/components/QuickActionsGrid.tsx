/**
 * The event home's quick actions, as one component.
 *
 * ★ SIX TILES, AND THE COUNT IS LOAD-BEARING.
 *
 * The grid lays out two per row. With five tiles the last one wrapped alone and
 * `flex: 1` stretched it into a full-width bar that read as a separate control
 * pinned under the page. An even count is not cosmetic — it is what stops any
 * tile from being orphaned.
 *
 * ★ SETTINGS BELONGS HERE.
 *
 * `/settings` was a real route that nothing linked to. The tile is the app's
 * only door to it, so it is part of this grid rather than a footer link.
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
  SlidersHorizontal,
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
  onOpenSettings: () => void;
}

interface ActionSpec {
  /** Matched by the tests, and the DOM marker that proves the tile exists. */
  key: string;
  label: string;
  onPress: () => void;
  Icon: typeof Gear;
}

export function QuickActionsGrid({
  onOpenSlots,
  onShare,
  onOpenActivity,
  onOpenChat,
  onOpenManagement,
  onOpenSettings,
}: QuickActionsGridProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  // Declared as data so the COUNT is visible in one place. A seventh entry here
  // would need the layout to accept a third row; a sixth keeps the grid even.
  const actions: ActionSpec[] = [
    { key: 'slots', label: t('slots.heading'), onPress: onOpenSlots, Icon: ClockCounterClockwise },
    { key: 'share', label: t('invite.share'), onPress: onShare, Icon: ShareNetwork },
    { key: 'activity', label: t('a11y.openActivity'), onPress: onOpenActivity, Icon: CalendarCheck },
    { key: 'chat', label: t('chat.open'), onPress: onOpenChat, Icon: ChatCircleDots },
    { key: 'management', label: t('events.management.title'), onPress: onOpenManagement, Icon: Gear },
    { key: 'settings', label: t('settings.heading'), onPress: onOpenSettings, Icon: SlidersHorizontal },
  ];

  return (
    <View style={styles.grid}>
      {actions.map(({ key, label, onPress, Icon }) => (
        <Pressy
          key={key}
          onPress={onPress}
          testID={`event-home-${key}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={styles.tile}
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
     * ★ TWO PER ROW, EXACTLY — WITHOUT LETTING A GAP CAUSE A WRAP.
     *
     * `48%` + `flexGrow` looks like it fits, but the row's `gap` is added on
     * TOP of the basis: 48% + 48% + gap > 100%, so one tile is pushed to the
     * next line and the row it left behind shows a hole. `flexBasis: 0` gives
     * the two tiles an equal share of whatever is left after the gap, so the
     * arithmetic can never overflow and an even count can never orphan a tile.
     */
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
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
