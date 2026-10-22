/**
 * The RSVP contract shared by the client and the server (Plan 10 Task 1).
 *
 * ★ THIS MODULE MUST STAY IMPORT-FREE.
 *
 * `server/routes/rsvp.ts`, `nudge.ts` and `status-update.ts` import these
 * constants. The DB tests load the route table through `server/app.ts`, so
 * anything reachable from here runs under the plain Node test runner. The
 * client service (`services/rsvp.ts`) imports `@/src/lib/api`, which pulls
 * `expo-constants` and therefore React Native — a transform the server and DB
 * suites cannot run. Keeping the wire contract in its own module is what lets
 * both sides share one definition of the answers without dragging Expo into
 * the server process.
 */

/** The three attendance answers. */
export const RSVP_VALUES = ['going', 'maybe', 'cannot'] as const;

export type RsvpValue = (typeof RSVP_VALUES)[number];

/** The late-arrival increments the UI offers, in minutes (E7). */
export const RUNNING_LATE_OPTIONS = [10, 20, 30] as const;

export type RunningLateMinutes = (typeof RUNNING_LATE_OPTIONS)[number];

/**
 * How long a "running late" status stays on the card.
 *
 * E7: a permanent badge outlives its meaning — the event it referred to is over
 * and the status stops saying anything true. The server reads this too, to
 * exclude stale reports from the card it serves.
 */
export const RUNNING_LATE_VISIBLE_MS = 2 * 60 * 60 * 1000;

/**
 * The nudge cooldown per organizer, per event (AC-6.5.1).
 *
 * A nudge is social pressure applied deliberately; left unbounded it becomes
 * spam and the group mutes the one notification that mattered.
 */
export const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** The catalogue keys a 422 carries, mirrored for the client's own guards. */
export const RSVP_VALIDATION = {
  eventNotConfirmed: 'rsvp.errors.notConfirmed',
  unknownValue: 'rsvp.errors.unknownValue',
  lateWindowClosed: 'rsvp.errors.lateWindowClosed',
  nudgeCooldown: 'rsvp.errors.nudgeCooldown',
  nobodyOutstanding: 'rsvp.errors.nobodyOutstanding',
} as const;
