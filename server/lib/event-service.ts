/**
 * Event creation and listing (Plan 05 Task 3, Task 6).
 *
 * ★ CREATION AND LINK ISSUANCE ARE TWO STEPS, ON PURPOSE.
 *
 * `DRAFT` means "created, no invite link generated yet" (PRD-01 §3). AC-1.1.1
 * asserts the event exists in `DRAFT` with the creator as `organizer`, and the
 * state machine moves it to `OPEN` when the link is generated. Folding both
 * into one statement would satisfy the product but break the stated criterion,
 * so creation stops at `DRAFT` and `issueInvite` performs the transition.
 */

import { EventCreateSchema, type EventSummary, type ParticipantSummary } from '@/src/types/event';
import type { EventCreateInput } from '@/src/types/event';

import { servicePool, withTransaction, type Caller } from './supabase';

interface EventRow {
  id: string;
  title: string;
  status: EventSummary['status'];
  activity_type: EventSummary['activity_type'];
  date_window_start: Date;
  date_window_end: Date;
  voting_deadline: Date | null;
  created_at: Date;
  participant_count: string | number;
  has_pending_vote: boolean;
  notifications_muted: boolean;
}

interface ParticipantRow {
  id: string;
  event_id: string;
  display_name: string;
  role: ParticipantSummary['role'];
  visibility: ParticipantSummary['visibility'];
  max_travel_minutes: number;
  modes: string[] | null;
  has_start_point: boolean;
  notifications_muted: boolean;
}

/** A timestamp the client can parse. `pg` hands back a `Date`. */
const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toParticipant(row: ParticipantRow): ParticipantSummary {
  return {
    id: row.id,
    event_id: row.event_id,
    display_name: row.display_name,
    role: row.role,
    has_start_point: row.has_start_point,
    max_travel_minutes: row.max_travel_minutes,
    modes: (row.modes ?? []) as ParticipantSummary['modes'],
    visibility: row.visibility,
    notifications_muted: row.notifications_muted,
  };
}

function toEvent(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    activity_type: row.activity_type,
    date_window_start: iso(row.date_window_start) ?? '',
    date_window_end: iso(row.date_window_end) ?? '',
    voting_deadline: iso(row.voting_deadline),
    participant_count: Number(row.participant_count),
    has_pending_vote: row.has_pending_vote,
    notifications_muted: row.notifications_muted,
    created_at: iso(row.created_at) ?? '',
  };
}

/**
 * The select every event read shares, so S1's row shape cannot differ from what
 * creation returns.
 *
 * `has_pending_vote` is computed in SQL rather than in a second round trip: the
 * attention badge is S1's substitute for push (PRD-11 S1), and it has to be
 * correct when notifications are denied — which they usually are.
 */
const EVENT_SELECT = `
  select
    e.id,
    e.title,
    e.status,
    e.activity_type,
    e.date_window_start,
    e.date_window_end,
    e.voting_deadline,
    e.created_at,
    (select count(*) from participant p where p.event_id = e.id) as participant_count,
    exists (
      select 1
      from proposal pr
      where pr.event_id = e.id
        and pr.status = 'OPEN'
        and not exists (
          select 1 from vote v
          where v.proposal_id = pr.id
            and v.participant_id = me.id
        )
    ) as has_pending_vote,
    -- The caller's own mute preference (migration 018). Read here so the
    -- settings screen can render one switch per event without a request each:
    -- the flag belongs to the (caller, event) pair this row already identifies.
    me.notifications_muted
  from event e
  join participant me
    on me.event_id = e.id
   and me.auth_user_id = $1
`;

/**
 * Creates the event in `DRAFT` and the creator's own `organizer` participant row
 * (AC-1.1.1, FR-1.2).
 *
 * The two inserts are one transaction: an event whose creator is not a
 * participant is invisible to its own organizer, because every read policy is
 * `is_event_participant()`.
 */
export async function createEvent(
  caller: Caller,
  input: EventCreateInput,
): Promise<{ event: EventSummary; participant: ParticipantSummary }> {
  const parsed = EventCreateSchema.parse(input);

  return withTransaction(async (client) => {
    const eventInsert = await client.query<{ id: string }>(
      `insert into event (
         title, description, activity_type, date_window_start, date_window_end,
         voting_deadline, home_tz, status, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8)
       returning id`,
      [
        parsed.title,
        parsed.description ?? null,
        parsed.activity_type ?? null,
        parsed.date_window_start,
        parsed.date_window_end,
        parsed.voting_deadline ?? null,
        parsed.home_tz ?? 'Asia/Tehran',
        caller.userId,
      ],
    );

    const eventId = eventInsert.rows[0]?.id;
    if (!eventId) throw new Error('event insert returned no id');

    const participantInsert = await client.query<ParticipantRow>(
      `insert into participant (
         event_id, auth_user_id, display_name, role, is_anonymous
       ) values ($1, $2, $3, 'organizer', $4)
       returning id, event_id, display_name, role, visibility,
                 max_travel_minutes, modes, notifications_muted,
                 false as has_start_point`,
      [eventId, caller.userId, parsed.title.slice(0, 30), caller.isAnonymous],
    );

    const participant = participantInsert.rows[0];
    if (!participant) throw new Error('organizer participant insert returned no row');

    const eventRow = await client.query<EventRow>(
      `${EVENT_SELECT} where e.id = $2`,
      [caller.userId, eventId],
    );

    const event = eventRow.rows[0];
    if (!event) throw new Error('created event could not be read back');

    return { event: toEvent(event), participant: toParticipant(participant) };
  });
}

/** The event the caller can see, or `null`. Used after a status transition. */
export async function getEventFor(caller: Caller, eventId: string): Promise<EventSummary | null> {
  const result = await servicePool().query<EventRow>(`${EVENT_SELECT} where e.id = $2`, [
    caller.userId,
    eventId,
  ]);

  const row = result.rows[0];
  return row ? toEvent(row) : null;
}

/**
 * S1 — the events the caller created or joined, most recently active first.
 *
 * ★ "Most recent activity" is COMPUTED, not `event.updated_at`.
 *
 * The schema has no `updated_at` trigger, so the column only ever holds the
 * creation time. Ordering on it would put a brand-new empty event above one
 * three people voted on ten seconds ago — the opposite of what the list is for.
 * The greatest of the event's own creation and its latest proposal or vote is
 * the signal the screen actually wants, and it needs no schema change.
 */
export async function listMyEvents(caller: Caller): Promise<EventSummary[]> {
  const result = await servicePool().query<EventRow>(
    `${EVENT_SELECT}
     order by greatest(
       e.created_at,
       coalesce((select max(pr.created_at) from proposal pr where pr.event_id = e.id), e.created_at),
       coalesce((
         select max(v.created_at)
         from vote v
         join proposal pr on pr.id = v.proposal_id
         where pr.event_id = e.id
       ), e.created_at)
     ) desc, e.id desc
     limit 200`,
    [caller.userId],
  );

  return result.rows.map(toEvent);
}

/** Whether the caller organizes this event. Rotation and revocation are theirs. */
export async function isOrganizer(caller: Caller, eventId: string): Promise<boolean> {
  const result = await servicePool().query<{ ok: boolean }>(
    `select exists (
       select 1 from event where id = $1 and created_by = $2
     ) as ok`,
    [eventId, caller.userId],
  );

  return result.rows[0]?.ok === true;
}
