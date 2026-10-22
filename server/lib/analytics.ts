/**
 * The self-hosted analytics emitter (PRD-09 §7A, PRD-12 §8).
 *
 * ★ THE REDACTION CONTRACT IS ENFORCED HERE, NOT AT THE CALL SITES.
 *
 * PRD-08 §15 forbids coordinates, invite tokens, pasted text and display names
 * in an analytics payload. A rule that every route must remember is a rule that
 * the next route forgets — so `track()` runs every payload through
 * `redactObject()` before the INSERT, and migration 017 refuses a sensitive KEY
 * at the table. Two layers, because the first one only knows the keys someone
 * remembered to forbid and the second one only sees what reaches the INSERT.
 *
 * ★ A FAILED WRITE NEVER FAILS THE REQUEST.
 *
 * This is the whole reason the table is self-hosted: observability must not be
 * a dependency the demo can fail on. The insert is fire-and-forget, and the
 * catch is deliberate rather than defensive — an analytics outage that turns a
 * successful vote into a 500 is a worse product than one with no metrics.
 *
 * ★ THE EVENT NAMES ARE A CLOSED SET.
 *
 * `FUNNEL_EVENTS` is the PRD-12 §8.1 table transcribed. A typo at a call site
 * is a TypeScript error rather than a new, unqueried row in the funnel — and a
 * funnel with a misspelled step reports a catastrophic drop-off that never
 * happened.
 */

import { redactObject } from '@/src/lib/redact';

import { servicePool } from './supabase';

/**
 * The seven funnel steps (PRD-12 §8.1).
 *
 * Ordered the way the reviewer walks them, which is the order the funnel is
 * read in. `rsvp_changed` is step 7: it happens after the decision, and it is
 * what measures follow-through rather than acquisition.
 */
export const FUNNEL_EVENTS = [
  'invite_link_opened',
  'guest_joined',
  'start_point_set',
  'proposal_created',
  'vote_cast',
  'decision_confirmed',
  'rsvp_changed',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/**
 * The properties a funnel step may carry.
 *
 * Scalar only. A nested object is where a request body ends up when a caller
 * wants "everything about this event" and gets a coordinate by accident, so the
 * type refuses the shape rather than trusting the caller to keep it flat.
 */
export type FunnelProps = Record<string, string | number | boolean | null>;

/** How the funnel is grouped: per event, or unattributed. */
export interface TrackOptions {
  /** The event the step belongs to. Absent for a dead or unresolved token. */
  eventId?: string | null;
}

/**
 * Emits one funnel event.
 *
 * Returns `true` when the row was written. A caller may log the `false` — no
 * caller may branch on it, because a metric is never a precondition for doing
 * the thing being measured.
 */
export async function track(
  name: FunnelEvent,
  props: FunnelProps = {},
  options: TrackOptions = {},
): Promise<boolean> {
  const safe = redactObject(props);

  try {
    await servicePool().query(
      `insert into analytics_event (event_id, name, props) values ($1, $2, $3::jsonb)`,
      [options.eventId ?? null, name, JSON.stringify(safe)],
    );
    return true;
  } catch {
    // The reason is intentionally not reported: the connection string and the
    // driver's message both name the host, and an analytics table is exactly
    // where a "could not connect to db-pooler.…" line gets copied into a
    // ticket. The deployment's own `/health` is the place to look.
    return false;
  }
}

/**
 * The elapsed seconds from an ISO timestamp to now, clamped at zero.
 *
 * The funnel's headline numbers (`seconds_from_open`, `elapsed_since_open_s`)
 * are all differences against a client-supplied moment. A device clock ahead of
 * the server would otherwise produce a negative duration, and "confirmed −4
 * seconds after opening" averages into "time to decision" without anyone
 * noticing. A missing or unparseable timestamp yields `null` rather than 0 —
 * the difference between "instant" and "unmeasured" matters for an average.
 */
export function elapsedSeconds(
  sinceIso: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!sinceIso) return null;

  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;

  return Math.max(0, Math.round((now - since) / 1000));
}

/** The funnel step an invitation open records, with its platform. */
export function inviteOpenedProps(platform: 'web' | 'app'): FunnelProps {
  return { platform };
}
