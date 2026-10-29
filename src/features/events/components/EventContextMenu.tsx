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
 * ★ THE BODY IS SHARED WITH THE MESSAGES SCREEN.
 *
 * `ContextMenu` owns the surface, the title line and the action rows. This file only
 * names the event actions, so the menu a hold opens on this screen and the one a
 * hold opens on a message are the same menu with different rows.
 *
 * A sheet slides up from the foot of the screen, which severs a menu from the row it
 * belongs to; a bare platform `Modal` has no exit animation and, on web, is the layer
 * that renders invisible while its scrim swallows clicks — see `BottomSheet.web.tsx`.
 */

import { useTranslation } from 'react-i18next';
import { Gear, MapPin, SignOut, Trash } from 'phosphor-react-native';

import { ContextMenu, type ContextMenuAction } from '@/src/components/ui/ContextMenu';
import { contextMenuActions } from '@/src/features/events/services/context-menu-actions';
import type { MenuAnchor } from '@/src/features/events/services/menu-placement';

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
  const { t } = useTranslation();

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

  // An action with no handler is not offered at all: a row that does nothing is
  // worse than a shorter menu.
  const actions: ContextMenuAction[] = contextMenuActions(isOwner)
    .filter((action) => handlers[action.key] !== undefined)
    .map((action) => ({
      key: action.key,
      label: t(action.labelKey),
      icon: icons[action.key] ?? (() => null),
      onPress: handlers[action.key]!,
      destructive: action.destructive,
    }));

  return (
    <ContextMenu
      anchor={anchor}
      viewport={viewport}
      title={eventTitle}
      actions={actions}
      onDismiss={onDismiss}
      testID={testID}
    />
  );
}
