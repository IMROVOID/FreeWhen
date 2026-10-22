/**
 * RSVP — the shared contract and the client service (Plan 10 Task 1).
 *
 * ★ RSVP EXISTS ONLY ONCE THE EVENT IS `CONFIRMED` (FR-6.1, AC-6.1.1).
 *
 * Before the decision there is one honest signal — the vote — and rendering a
 * second one beside it invites the group to read the wrong one. That rule is
 * enforced in three places on purpose: the screen does not mount the control
 * (`app/event/[id]/decision.tsx`), this module's `canRsvp` is what the component
 * asks, and `server/routes/rsvp.ts` refuses the write. A rule this load-bearing
 * should not depend on one of them being remembered.
 *
 * ★ RSVP IS NOT GATED ON HAVING VOTED (FR-6.6, OQ-6.2).
 *
 * Requiring a vote would punish the busy person the product exists for, and it
 * breaks the "nothing blocks participation" principle. `canRsvp` takes the
 * event status and deliberately does NOT take the caller's vote state — there is
 * no parameter here that a future change could wire a vote check into.
 */

import { apiRequest } from '@/src/lib/api';
import { RSVP_VALUES, RUNNING_LATE_VISIBLE_MS, type RsvpValue } from './contract';

export {
  NUDGE_COOLDOWN_MS,
  RSVP_VALIDATION,
  RSVP_VALUES,
  RUNNING_LATE_OPTIONS,
  RUNNING_LATE_VISIBLE_MS,
  type RunningLateMinutes,
  type RsvpValue,
} from './contract';

/** One participant's RSVP, as the wire carries it. */
export interface Rsvp {
  participant_id: string;
  event_id: string;
  value: RsvpValue;
  updated_at: string;
}

/**
 * Attendance counts and names.
 *
 * ★ `maybe` IS REPORTED SEPARATELY AND IS NEVER FOLDED INTO `going` (FR-6.5).
 *
 * It is the number that decides whether a reservation is needed, so a total
 * that merged the two would destroy the one actionable figure on the card.
 */
export interface Attendance {
  going: number;
  maybe: number;
  cannot: number;
  /** Nobody has answered yet — distinct from "nobody is coming". */
  noResponse: number;
  /** Display names, in join order, so every device agrees. */
  names: {
    going: string[];
    maybe: string[];
    cannot: string[];
  };
}

/** The state an RSVP control needs. */
export interface RsvpState {
  attendance: Attendance;
  /** The caller's own answer, or `null` when they have not answered. */
  mine: RsvpValue | null;
}

/**
 * Whether RSVP is available at all.
 *
 * The ONLY input is the event status. See the note at the top of this file:
 * there is deliberately no "has voted" argument.
 */
export function canRsvp(eventStatus: string | null | undefined): boolean {
  return eventStatus === 'CONFIRMED';
}

/** Type guard for a wire value. */
export function isRsvpValue(value: unknown): value is RsvpValue {
  return typeof value === 'string' && (RSVP_VALUES as readonly string[]).includes(value);
}

/**
 * Counts attendance from a flat RSVP list plus the full participant list.
 *
 * Participants with no RSVP are counted as `noResponse` rather than assumed
 * absent — "has not answered" and "is not coming" are different facts and the
 * organizer acts on them differently.
 */
export function attendanceFrom(
  participantIds: readonly string[],
  namesById: Readonly<Record<string, string>>,
  rsvps: Readonly<Record<string, RsvpValue>>,
): Attendance {
  const names: Attendance['names'] = { going: [], maybe: [], cannot: [] };
  let noResponse = 0;

  // Iterating the participant list (join order) rather than the RSVP map is
  // what keeps the name order identical on every device.
  for (const id of participantIds) {
    const value = rsvps[id];

    if (value === undefined) {
      noResponse += 1;
      continue;
    }

    names[value].push(namesById[id] ?? '');
  }

  return {
    going: names.going.length,
    maybe: names.maybe.length,
    cannot: names.cannot.length,
    noResponse,
    names,
  };
}

export interface PutRsvpResponse {
  rsvp: Rsvp;
  attendance: Attendance;
}

/**
 * Records or changes the caller's RSVP.
 *
 * `PUT` because the operation is idempotent: the schema keys `rsvp` on
 * `participant_id`, so sending `going` twice is one RSVP. A `POST` would suggest
 * a second call creates a second answer.
 */
export async function putRsvp(
  eventId: string,
  value: RsvpValue,
  userId: string | null,
): Promise<PutRsvpResponse> {
  const { data } = await apiRequest<PutRsvpResponse>(`/api/events/${eventId}/rsvp`, {
    method: 'PUT',
    userId,
    body: { value },
  });

  return data;
}

export interface RsvpListResponse {
  rsvps: Record<string, RsvpValue>;
  attendance: Attendance;
  mine: RsvpValue | null;
}

/** Reads the event's RSVPs and attendance counts. */
export async function fetchRsvps(
  eventId: string,
  userId: string | null,
): Promise<RsvpListResponse> {
  const { data } = await apiRequest<RsvpListResponse>(`/api/events/${eventId}/rsvp`, {
    userId,
  });

  return data;
}

/**
 * Applies the caller's own change locally while the request is in flight.
 *
 * Pure, so the optimistic result is testable and the component does not have to
 * reimplement the counting rule. The caller is identified by their own display
 * name, which is how the tally already carries voters — no id is needed, and
 * taking one would invite a caller to patch somebody else's row.
 */
export function optimisticRsvp(
  state: RsvpState,
  name: string,
  value: RsvpValue,
): RsvpState {
  const previous = state.mine;
  if (previous === value) return state;

  const names: Attendance['names'] = {
    going: [...state.attendance.names.going],
    maybe: [...state.attendance.names.maybe],
    cannot: [...state.attendance.names.cannot],
  };

  if (previous === null) {
    state.attendance.noResponse -= 1;
  } else {
    names[previous] = names[previous].filter((entry) => entry !== name);
  }

  names[value] = [...names[value], name];

  return {
    mine: value,
    attendance: {
      going: names.going.length,
      maybe: names.maybe.length,
      cannot: names.cannot.length,
      noResponse: Math.max(0, state.attendance.noResponse),
      names,
    },
  };
}

/**
 * Whether a running-late status is still worth showing.
 *
 * Measured from the reported instant, so a status set the day before does not
 * resurface at the event.
 */
export function isRunningLateVisible(reportedAt: string, now: Date = new Date()): boolean {
  const reported = Date.parse(reportedAt);
  if (!Number.isFinite(reported)) return false;

  return now.getTime() - reported < RUNNING_LATE_VISIBLE_MS;
}
