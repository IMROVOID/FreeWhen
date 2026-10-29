/**
 * The long-press menu on an event row.
 *
 * ★ THE ROW HAD ONE GESTURE AND IT LED SOMEWHERE ELSE.
 *
 * An event row on the home screen did exactly one thing: open the event. Everything a
 * person actually wants to do TO an event — leave it, change where they are coming
 * from, and for the owner rename it or delete it — was reachable only from inside the
 * event, in a sheet behind an action grid. So the row you are looking at was the one
 * place you could not act on it.
 *
 * ★ IT OPENS WHERE THE FINGER WAS.
 *
 * The placement logic is in `services/menu-placement.ts` and is pure, because "does the
 * last event in a list have a usable menu" is a question with a wrong answer that no
 * screenshot review reliably catches. The anchor is the PRESS POINT — a rect-based
 * anchor pinned the menu to the list's edge, which the report describes as "always at
 * the bottom right, not where I held".
 *
 * ★ THE SURFACE IS `Popover`, NOT A SHEET AND NOT A BARE `Modal`.
 *
 * A sheet slides up from the foot of the screen, which severs a menu from the row it
 * belongs to. A bare platform `Modal` has no exit animation and, on web, is the layer
 * that renders invisible while its scrim swallows clicks — see `BottomSheet.web.tsx`.
 * `Popover` is the positioned overlay that keeps the dismiss behaviour of both.
 *
 * ★ THE ANCHOR SURVIVES THE CLOSE.
 *
 * `anchor` going null is what closes the menu, and the placement is computed from a
 * remembered copy of the last non-null anchor. Otherwise the panel would jump to its
 * fallback position for the exit animation — the reported "it moves to the top right
 * before disappearing".
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Gear, MapPin, SignOut, Trash } from 'phosphor-react-native';

import { Popover } from '@/src/components/ui/Popover';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { contextMenuActions } from '@/src/features/events/services/context-menu-actions';
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
const MENU_ESTIMATED = { width: space[16] * 3 + space[10], height: space[8] * 5 + space[10] };

export interface EventContextMenuProps {
  /** The point the user pressed, in window coordinates. `null` closes the menu. */
  anchor: MenuAnchor | null;
  /** The viewport the menu has to fit in. */
  viewport: { width: number; height: number };
  eventTitle: string;
  /** Whether the caller organises this event. */
  isOwner: boolean;
  onChangeLocation: () => void;
  onLeave: () => void;
  onOpenConfiguration?: () => void;
  onDelete?: () => void;
  onDismiss: () => void;
  testID?: string;
}

export function EventContextMenu({
  anchor,
  viewport,
  eventTitle,
  isOwner,
  onChangeLocation,
  onLeave,
  onOpenConfiguration,
  onDelete,
  onDismiss,
  testID = 'event-context-menu',
}: EventContextMenuProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();
  const rtl = useLayoutDirection();

  const actions = contextMenuActions(isOwner);

  const handlers: Record<string, (() => void) | undefined> = {
    leave: onLeave,
    location: onChangeLocation,
    configure: onOpenConfiguration,
    delete: onDelete,
  };

  const icons: Record<string, (props: { size: number; color: string }) => React.ReactNode> = {
    leave: (props) => <SignOut {...props} weight="bold" />,
    location: (props) => <MapPin {...props} weight="bold" />,
    configure: (props) => <Gear {...props} weight="bold" />,
    delete: (props) => <Trash {...props} weight="bold" />,
  };

  /**
   * The last anchor the menu was open at.
   *
   * Held across the close so the exit animation runs where the entrance did — see
   * the note at the top of this file.
   */
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
      accessibilityLabel={eventTitle}
      testID={testID}
    >
      <Text variant="caption" color={theme.textMuted} numberOfLines={1} style={styles.title}>
        {eventTitle}
      </Text>

      {actions.map((action) => {
        const handler = handlers[action.key];
        if (!handler) return null;

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
              handler();
            }}
            accessibilityRole="menuitem"
            accessibilityLabel={t(action.labelKey)}
            testID={`${testID}-${action.key}`}
            style={styles.item}
          >
            <View style={styles.itemInner}>
              {icons[action.key]?.({ size: 18, color: tint })}
              <Text variant="body" color={tint} align="start" style={styles.itemLabel}>
                {t(action.labelKey)}
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
