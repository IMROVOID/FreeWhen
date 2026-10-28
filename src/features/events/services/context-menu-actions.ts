/**
 * Which actions the event context menu offers, by role.
 *
 * ★ PURE, BECAUSE "WHO SEES DELETE" IS THE SECURITY-ADJACENT PART.
 *
 * A delete affordance shown to a member is a dead end at best and a permission probe
 * at worst. Keeping the list here means the assertion is on the SET rather than on
 * whether a rendered button happens to exist — and it can run without a renderer.
 *
 * ★ OWNER-ONLY ITEMS ARE ABSENT, NOT DISABLED.
 *
 * A greyed row in a menu invites the tap anyway, and it advertises a capability the
 * person does not have. The member's menu is exactly the two things they can do.
 */

export interface ContextMenuAction {
  key: 'leave' | 'location' | 'configure' | 'delete';
  /** A catalogue key, never prose. */
  labelKey: string;
  /** Painted in the danger colour — for the two irreversible items. */
  destructive?: boolean;
}

const SHARED: readonly ContextMenuAction[] = [
  { key: 'leave', labelKey: 'events.contextMenu.leave', destructive: true },
  { key: 'location', labelKey: 'events.contextMenu.changeLocation' },
];

const OWNER_ONLY: readonly ContextMenuAction[] = [
  { key: 'configure', labelKey: 'events.contextMenu.configure' },
  { key: 'delete', labelKey: 'events.contextMenu.delete', destructive: true },
];

/** The actions for this caller, in the order the menu presents them. */
export function contextMenuActions(isOwner: boolean): readonly ContextMenuAction[] {
  return isOwner ? [...SHARED, ...OWNER_ONLY] : SHARED;
}
