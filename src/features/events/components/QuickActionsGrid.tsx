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
     * ★ AN EXPLICIT MINIMUM IS WHAT MAKES THE ROW WRAP.
     *
     * `flexBasis: 0` alone was wrong: with nothing but `gap`, six tiles all
     * shrank to fit ONE row, which is the squeezed columns with overlapping
     * labels that shipped. A percentage basis also overflows once the row's
     * `gap` is added on top.
     *
     * `flex: 1` with a `minWidth` is the combination that behaves: each tile
     * asks for an equal share, and the minimum is what forces the row to break
     * rather than compress. Two per row at any realistic phone width, and the
     * odd-count orphan the old code had cannot occur with six.
     */
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: '45%',
    minWidth: 132,
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
