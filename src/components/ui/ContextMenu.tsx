/**
 * A context menu: a title line and a list of actions, at a point on screen.
 *
 * ★ TWO SURFACES NEEDED THE SAME MENU AND ONLY ONE HAD IT.
 *
 * The home screen's event rows open a menu on a hold — a positioned popover with
 * a title line, icon rows and the row's own actions. The messages screen opens a
 * BOTTOM SHEET on a hold instead, which slides up from the foot of the display
 * and severs the actions from the message they belong to. The request is explicit:
 * use a menu like the event one.
 *
 * So the body lives here: the geometry is `Popover`'s, the placement is
 * `menu-placement.ts`, and the ONE thing a caller supplies is the action list.
 * A menu is a menu whichever surface opened it, so a future third caller does not
 * get a third look.
 *
 * ★ THE ANCHOR SURVIVES THE CLOSE.
 *
 * `anchor` going null is what closes the menu, and the placement is computed from
 * a remembered copy of the last non-null anchor. Otherwise the panel would jump to
 * its fallback position for the exit animation — the reported "it moves to the top
 * right before disappearing".
 */

import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Popover } from '@/src/components/ui/Popover';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { placeMenu, type MenuAnchor } from '@/src/features/events/services/menu-placement';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/**
 * The size the menu reserves for placement, before it has measured itself.
 *
 * Derived from the token grid rather than typed as pixels: the menu is four rows at
 * `space[8]` plus the card's own padding, and a literal would drift the first time the
 * grid changes — which would silently move it to the wrong side of the finger.
 */
export const MENU_ESTIMATED = {
  width: space[16] * 3 + space[10],
  height: space[8] * 5 + space[10],
};

export interface ContextMenuAction {
  /** Matched by the tests, and the DOM marker that proves the row exists. */
  key: string;
  label: string;
  /** Drawn at the leading edge of the row. */
  icon: (props: { size: number; color: string }) => React.ReactNode;
  onPress: () => void;
  /** A destructive action is drawn in the danger colour. */
  destructive?: boolean;
}

export interface ContextMenuProps {
  /** The point the user pressed, in window coordinates. `null` closes the menu. */
  anchor: MenuAnchor | null;
  /** The viewport the menu has to fit in. */
  viewport: { width: number; height: number };
  /** The line of context above the actions — a title or a message preview. */
  title: string;
  actions: readonly ContextMenuAction[];
  onDismiss: () => void;
  testID?: string;
}

export function ContextMenu({
  anchor,
  viewport,
  title,
  actions,
  onDismiss,
  testID = 'context-menu',
}: ContextMenuProps) {
  const { t: theme } = useTheme();
  const rtl = useLayoutDirection();

  const lastAnchor = useRef<MenuAnchor | null>(null);
  if (anchor !== null) lastAnchor.current = anchor;

  const placed = lastAnchor.current;

  const placement =
    placed === null
      ? null
      : placeMenu({
          anchor: placed,
          windowHeight: viewport.height,
          windowWidth: viewport.width,
          menuHeight: MENU_ESTIMATED.height,
          menuWidth: MENU_ESTIMATED.width,
          rtl,
        });

  return (
    <Popover
      visible={anchor !== null}
      onDismiss={onDismiss}
      // top/left here are PHYSICAL window coordinates from the placement module,
      // which works in the same space measureInWindow reports.
      // rtl-ok: physical window coordinates
      position={placement === null ? null : { top: placement.top, left: placement.left }}
      accessibilityLabel={title}
      testID={testID}
    >
      <Text variant="caption" color={theme.textMuted} numberOfLines={1} style={styles.title}>
        {title}
      </Text>

      {actions.map((action) => {
        const tint = action.destructive ? theme.danger : theme.text;

        return (
          <Pressy
            key={action.key}
            onPress={() => {
              // ★ THE MENU CLOSES FIRST, THEN THE ACTION RUNS.
              //
              // A confirm sheet opened while this overlay is still mounted would sit
              // under it on native. Dismissing first is also what the gesture means:
              // the tap chose an item, so the menu is done.
              onDismiss();
              action.onPress();
            }}
            accessibilityRole="menuitem"
            accessibilityLabel={action.label}
            testID={`${testID}-${action.key}`}
            style={styles.item}
          >
            <View style={styles.itemInner}>
              {action.icon({ size: 18, color: tint })}
              <Text variant="body" color={tint} align="start" style={styles.itemLabel}>
                {action.label}
              </Text>
            </View>
          </Pressy>
        );
      })}
    </Popover>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingHorizontal: space[2],
    paddingBottom: space[1],
  },
  item: {
    borderRadius: radius.md,
    minWidth: MENU_ESTIMATED.width - space[2] * 2,
  },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
  },
  itemLabel: {
    flexShrink: 1,
  },
});
