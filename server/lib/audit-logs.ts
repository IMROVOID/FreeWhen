/**
 * The activity log's no-coordinate rule (Plan 09 Task 8, FR-8.42 / FR-8.44).
 *
 * ★ THE LOG RECORDS ACTIONS, NOT LOCATIONS.
 *
 * `activity_log` is PARTICIPANT-VISIBLE. A coordinate written here is not a
 * private leak that an operator might miss — it is a disclosure to every member
 * of the event, permanently, with an audit trail attributing it to a person.
 * That is strictly worse than the same value appearing in a server log.
 *
 * The rule is already hidden in `src/lib/redact.ts` for log LINES. This module
 * closes the other door: the VALUES that reach the database. Redaction cannot
 * help there, because a `detail` payload is meant to be stored, not scrubbed.
 *
 * ★ WHY AN ASSERTION AND NOT ONLY A TEST.
 *
 * A test proves no call site leaks TODAY. The person who adds the twentieth
 * action tomorrow sits in the same file and gets no feedback from a test they
 * did not run. The assertion fires at the moment the row is built, which is the
 * only moment the author is looking at the payload.
 *
 * It throws in every environment rather than only in development. §19.10 asks
 * for a development assertion, but a coordinate that reaches an append-only,
 * participant-visible table cannot be taken back — refusing the write is the
 * only remedy that works, and failing loudly is how the call site learns.
 */

import { isSensitiveKey } from '../../src/lib/redact';

/**
 * Keys that may not appear in an activity_log `detail` payload.
 *
 * Kept as an explicit list, alongside `isSensitiveKey`, because these two
 * answer different questions. `isSensitiveKey` answers "would this leak a
 * secret"; this answers "would this store a location in a visible table".
 */
export const FORBIDDEN_DETAIL_KEYS = [
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'lat_rounded',
  'lng_rounded',
  'coordinate',
  'coords',
  'accuracy_m',
  'start_point',
  'startpoint',
] as const;

/** A value the log may not carry. */
export class ActivityLogViolation extends Error {
  constructor(readonly key: string) {
    super(
      `activity_log.detail may not carry \`${key}\` — the log records actions, not locations (FR-8.44)`,
    );
    this.name = 'ActivityLogViolation';
  }
}

/** Whether a key names a location, by either test. */
function isLocationKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if ((FORBIDDEN_DETAIL_KEYS as readonly string[]).includes(normalised)) return true;

  // `isSensitiveKey` also catches coordinates under a spelling this list does
  // not anticipate (`userLat`, `geoPoint`), so both run.
  return isSensitiveKey(key);
}

/**
 * Throws when a `detail` payload names a location, at any depth.
 *
 * Depth matters: `{ from: { lat: … } }` reaches the table just as surely as a
 * top-level `lat`, and a shallow check would report the payload clean.
 */
export function assertNoLocationInDetail(
  detail: Record<string, unknown> | null | undefined,
): void {
  if (!detail) return;

  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isLocationKey(key)) throw new ActivityLogViolation(key);
      visit(child, depth + 1);
    }
  };

  visit(detail, 0);
}

/** One row to append. Mirrors `activity_log`'s columns. */
export interface ActivityLogEntry {
  eventId: string;
  actorId: string | null;
  /** `proposal_created` | `vote_changed` | `confirmed` | `reopened` | … */
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  /** Values, not prose and not locations — `{ from: 'maybe', to: 'yes' }`. */
  detail: Record<string, unknown> | null;
}

/**
 * The SQL writer for one entry.
 *
 * ★ WHY THIS IS A QUERY AND NOT A SUPABASE `insert`.
 *
 * The table is append-only and the writer must not be able to update or delete,
 * so the statement is written once here rather than assembled per call site.
 * Returns the SQL and its parameters so a caller inside a transaction can run
 * it on the same client as the mutation it is recording.
 */
export function activityLogStatement(entry: ActivityLogEntry): {
  text: string;
  values: unknown[];
} {
  assertNoLocationInDetail(entry.detail);

  return {
    text: `insert into activity_log (event_id, actor_id, action, subject_type, subject_id, detail)
           values ($1, $2, $3, $4, $5, $6::jsonb)`,
    values: [
      entry.eventId,
      entry.actorId,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  };
}
