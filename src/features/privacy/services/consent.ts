/**
 * Consent moments (Plan 09 Task 1, PRD-08 §3).
 *
 * ★ CONSENT IS PER EVENT AND REVOCABLE, NEVER A ONE-TIME GRANT (§3.1).
 *
 * A single "I agree" at first launch does not satisfy B1. The person is
 * agreeing to a specific disclosure — "the 4 people in this dinner can see my
 * rough area until Friday" — and that agreement is only meaningful for that
 * event and that audience. Storing a boolean at install would let the app
 * honour a consent that was never given for the event it is now disclosing to.
 *
 * ★ THE LOCATION PROMPT FIRES FROM AN ACTION THAT NEEDS LOCATION (FR-8.1).
 *
 * Never at launch. A permission dialog that appears before the user has asked
 * for anything is misinterpreted — the person cannot tell what it is for, and
 * the safe answer is deny. `requestLocationConsent` is therefore only
 * reachable from the "use my current location" tap.
 *
 * The record is append-only: `revokedAt` marks a revocation rather than
 * deleting the row, because the history of what was agreed to is itself part
 * of the accountability trail.
 */

/**
 * The consent moments in PRD-08 §3.2.
 *
 * Each is a distinct question with a distinct audience, so each is a distinct
 * record — a grant for one is not a grant for another.
 */
export const CONSENT_MOMENTS = [
  /** Before the first location prompt: "we need your area to suggest a fair venue". */
  'location_first_need',
  /** Each time a start point is added, with its audience and expiry. */
  'start_point_added',
  /** Creating an invite link: the link is the credential for the event. */
  'invite_created',
] as const;

export type ConsentMoment = (typeof CONSENT_MOMENTS)[number];

/** One recorded agreement. */
export interface ConsentRecord {
  readonly moment: ConsentMoment;
  readonly eventId: string;
  /** Who was told the disclosure applies to. */
  readonly audienceCount: number;
  /** ISO instant the disclosure stops applying — the event's end. */
  readonly expiresAt: string;
  /** ISO instant the person agreed. */
  readonly grantedAt: string;
  /** ISO instant the person withdrew, or `null` while it stands. */
  readonly revokedAt: string | null;
}

/** Whether a record still represents a live agreement. */
export function isConsentActive(record: ConsentRecord, now: Date = new Date()): boolean {
  if (record.revokedAt !== null) return false;

  // An expired disclosure is not a standing one. The event has ended, so the
  // audience the person agreed to has dissolved.
  return new Date(record.expiresAt).getTime() > now.getTime();
}

/**
 * Records one agreement.
 *
 * Pure: it returns the new list rather than mutating the one it was given, so a
 * caller cannot accidentally publish a half-updated view to the UI.
 */
export function grantConsent(
  records: readonly ConsentRecord[],
  grant: Omit<ConsentRecord, 'grantedAt' | 'revokedAt'>,
  now: Date = new Date(),
): readonly ConsentRecord[] {
  return [
    ...records,
    { ...grant, grantedAt: now.toISOString(), revokedAt: null },
  ];
}

/**
 * Withdraws the standing agreement for one moment in one event.
 *
 * ★ Every active record for that moment is revoked, not just the newest.
 *
 * A person may have added, deleted and re-added a start point; each add was a
 * separate grant. Revoking "my location consent for this event" has to cover
 * all of them, or the oldest record keeps the disclosure alive and the revoke
 * button is a promise the state machine does not keep.
 */
export function revokeConsent(
  records: readonly ConsentRecord[],
  eventId: string,
  moment: ConsentMoment,
  now: Date = new Date(),
): readonly ConsentRecord[] {
  const stamp = now.toISOString();

  return records.map((record) =>
    record.eventId === eventId && record.moment === moment && record.revokedAt === null
      ? { ...record, revokedAt: stamp }
      : record,
  );
}

/** Whether a live agreement exists for this moment in this event. */
export function hasActiveConsent(
  records: readonly ConsentRecord[],
  eventId: string,
  moment: ConsentMoment,
  now: Date = new Date(),
): boolean {
  return records.some(
    (record) =>
      record.eventId === eventId && record.moment === moment && isConsentActive(record, now),
  );
}

/**
 * What the person must be told before a coordinate leaves their device
 * (FR-8.8, FR-8.9).
 *
 * ★ THIS IS A CONSENT REQUIREMENT, NOT A COPY NICETY.
 *
 * Sharing to an unnamed audience is not informed consent: "your location is
 * shared" without "with whom" and "until when" cannot be evaluated by the
 * person being asked. The three facts are returned together so no call site can
 * show one without the others.
 */
export interface ConsentDisclosure {
  /** How many people can see it. */
  readonly audienceCount: number;
  /** ISO instant the disclosure ends — the event's end. */
  readonly expiresAt: string;
  /** Whether the person chose to hide the coordinate from peers. */
  readonly visibility: 'private' | 'event';
}

/**
 * Builds the disclosure for a start point being added.
 *
 * A `private` start point still needs the disclosure: the person is told the
 * coordinate is used for distance only, which is a different — and smaller —
 * disclosure than the event-wide one.
 */
export function disclosureFor(
  audience: { participant_count: number; expires_at: string },
  visibility: 'private' | 'event',
): ConsentDisclosure {
  return {
    audienceCount: audience.participant_count,
    expiresAt: audience.expires_at,
    visibility,
  };
}

/**
 * Whether the start-point write should be preceded by the location prompt.
 *
 * ★ The prompt follows an ACTION, never a launch (FR-8.1).
 *
 * This function exists so the rule is testable: it takes the intent that
 * triggered the read, and only a location-needing action returns `true`. There
 * is deliberately no `app_opened` member — a launch can never ask.
 */
export type LocationIntent = 'use_my_current_location' | 'add_start_point';

export function shouldPromptForLocation(intent: LocationIntent): boolean {
  return intent === 'use_my_current_location' || intent === 'add_start_point';
}
