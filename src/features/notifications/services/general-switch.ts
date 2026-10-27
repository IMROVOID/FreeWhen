/**
 * The general notifications switch (Plan 49 T18).
 *
 * ★ RE-ENABLING MUST RESTORE, NOT ENABLE EVERYTHING.
 *
 * The request is explicit: "enabling back should return the original state of all
 * Events not forcefully enabling all". A one-bit flag cannot do that, because the
 * events a person muted individually before turning notifications off would come
 * back on — silently reversing a choice they made on purpose.
 *
 * So switching OFF records BOTH facts:
 *
 *   - which events were already muted individually (the set to restore), and
 *   - that the general switch is off (which greys out the rest).
 *
 * Switching back on replays that set and nothing else. A plain boolean would be
 * indistinguishable from "unmute everything", which is the bug this shape prevents.
 */

/**
 * The stored state of the general switch.
 *
 * `previousMuted` is the per-event mute set AS IT WAS when the switch went off.
 * It is only meaningful while `enabled` is false, and it is what makes the restore
 * exact rather than approximate.
 */
export interface NotificationSwitchState {
  enabled: boolean;
  /** The events muted individually at the moment the switch was turned off. */
  previousMuted: readonly string[];
}

/** The switch, before anything has been touched. */
export const INITIAL_SWITCH: NotificationSwitchState = { enabled: true, previousMuted: [] };

/**
 * The state after turning the switch off.
 *
 * `mutedEventIds` is snapshotted so a later re-enable can put every event back
 * exactly as it was. The order is preserved: the two lists are compared by
 * identity in tests and by membership in the UI, and sorting would hide a
 * reordering bug.
 */
export function disableAll(mutedEventIds: readonly string[]): NotificationSwitchState {
  return { enabled: false, previousMuted: [...mutedEventIds] };
}

/**
 * The result of turning the switch back on.
 *
 * ★ THE RESTORE IS RETURNED, NOT READ FROM THE NEW STATE.
 *
 * Clearing the snapshot and reading it afterwards is a trap: whichever order a
 * caller picks, one of the two is wrong — read first and the cleared state still
 * holds a set it should not, read second and the restore is always empty. Returning
 * the set with the new state makes the order impossible to get wrong.
 */
export interface EnableResult {
  state: NotificationSwitchState;
  /** The per-event mutes to put back. Exactly what was in force before. */
  restoredMuted: readonly string[];
}

/**
 * The state after turning the switch back on, and the set to restore.
 *
 * The restored set is exactly what was muted when the switch went off — not an
 * empty set, and not "everything muted". The snapshot is then consumed: holding it
 * would let a second off/on cycle restore a set from two cycles ago.
 */
export function enableAll(state: NotificationSwitchState): EnableResult {
  return {
    state: { enabled: true, previousMuted: [] },
    restoredMuted: [...state.previousMuted],
  };
}

/**
 * Whether a per-event switch is interactive.
 *
 * ★ GREYED OUT, NOT FORCED TO OFF.
 *
 * With the general switch off, every per-event row is disabled and shown muted —
 * but its underlying value is untouched, which is what makes the restore exact.
 * Rendering them as "off" would be a lie that the restore would then have to
 * contradict.
 */
export function isEventRowInteractive(state: NotificationSwitchState): boolean {
  return state.enabled;
}

/** What a per-event row *displays* — greyed while the general switch is off. */
export function displayedEventMute(state: NotificationSwitchState, eventMuted: boolean): boolean {
  if (!state.enabled) return true;
  return eventMuted;
}
