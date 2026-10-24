/**
 * The D23 in-room chat surface (PRD-06 FR-6.7b, PRD-02 §4.7).
 *
 * ★ THE DATABASE, RLS AND TRANSPORT ALREADY EXISTED. THIS IS THE MISSING HTTP LAYER.
 *
 * `event_message` and `message_report` are in migration 009, every policy in 011
 * §12 scopes rows to `is_event_participant`, and `event_message` is already on the
 * realtime publication with `chat` as its channel kind. Nothing here rebuilds
 * that; this file is the participant-scoped read and write the screens call.
 *
 * ★ MESSAGE BODIES ARE USER-GENERATED TEXT, SO NO BODY MAY REACH A LOG.
 *
 * The same rule that protects pasted parser text applies here. This module never
 * passes a body to `track()` or `logSafe()` — the funnel events name the event
 * and the message id, never the sentence. `gate:logs` enforces the mechanism; the
 * discipline is that there is nothing here worth logging in the first place.
 *
 * ★ LENGTH IS VALIDATED SERVER-SIDE, IN THE SAME BOUND AS THE COLUMN.
 *
 * `event_message.body` carries `check (char_length(body) between 1 and 500)`. A
 * client-only check would mean a crafted request reaches Postgres and returns a
 * constraint violation — a 500 where a 422 belongs — so the same 1–500 bound is
 * enforced here first, in characters rather than bytes.
 */

import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, scopedQueryable, type Caller } from '../lib/supabase';

/** The stored bound. Mirrors the column check in migration 009. */
export const MESSAGE_BODY_MIN = 1;
export const MESSAGE_BODY_MAX = 500;

/** How many messages a single read returns, newest last. */
export const MESSAGE_PAGE_SIZE = 100;

/** The report reason bound, mirroring `message_report.reason`. */
export const REPORT_REASON_MAX = 200;

/** One message, as the wire carries it. */
export interface ChatMessage {
  id: string;
  event_id: string;
  participant_id: string;
  sender_name: string;
  body: string;
  message_type: 'chat' | 'system';
  created_at: string;
}

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;
  return resolveCaller(userId);
}

/** The caller's participant row for the event, or `null` when they are not in it. */
async function participantIn(
  eventId: string,
  caller: Caller,
): Promise<{ id: string; display_name: string } | null> {
  const result = await scopedQueryable().query<{ id: string; display_name: string }>(
    `select id, display_name
       from participant
      where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

/** Applies the mutating budgets, per participant and per event. */
function withinMutationLimits(caller: Caller, eventId: string): boolean {
  const perParticipant = limiters.mutationByParticipant.check(`mutate:${caller.userId}`);
  const perEvent = limiters.mutationByEvent.check(`mutate:${eventId}`);

  return perParticipant.allowed && perEvent.allowed;
}

/**
 * Validates a message body.
 *
 * ★ `trim()` IS DELIBERATE, AND ONLY LEADING/TRAILING WHITESPACE GOES.
 *
 * A body of spaces satisfies `char_length >= 1` and renders as an empty bubble —
 * a message that says nothing, in a thread where the group is trying to
 * coordinate. Trimming makes "   " a validation failure rather than a message.
 * Interior whitespace and newlines are untouched: they are how people write.
 *
 * The length bound is applied AFTER trimming, so 500 characters of padding
 * cannot smuggle a shorter message past the limit.
 */
export function validateMessageBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false } {
  if (typeof raw !== 'string') return { ok: false };

  const body = raw.trim();
  if (body.length < MESSAGE_BODY_MIN) return { ok: false };
  if (body.length > MESSAGE_BODY_MAX) return { ok: false };

  return { ok: true, body };
}

/** Rows as `pg` returns them, before the wire shape. */
interface MessageRow {
  id: string;
  event_id: string;
  participant_id: string;
  sender_name: string;
  body: string;
  message_type: 'chat' | 'system';
  created_at: Date;
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    event_id: row.event_id,
    participant_id: row.participant_id,
    sender_name: row.sender_name,
    body: row.body,
    message_type: row.message_type,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * `GET /api/events/:id/messages`
 *
 * ★ A NON-PARTICIPANT SEES ZERO ROWS, NOT AN EMPTY THREAD WITH A 200.
 *
 * The distinction matters: `NOT_PARTICIPANT` is what lets the screen show the
 * honest refusal instead of an empty chat that looks like nobody has spoken.
 * RLS enforces the same rule at the row level, so this check is the wire
 * contract rather than the only defence.
 */
export async function listMessagesHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const member = await participantIn(eventId, caller);
  if (!member) return wireError('NOT_PARTICIPANT');

  // Newest last, so the thread reads top-to-bottom like every chat app and the
  // newest message sits beside the composer.
  const result = await scopedQueryable().query<MessageRow>(
    `select id, event_id, participant_id, sender_name, body, message_type, created_at
       from event_message
      where event_id = $1
      order by created_at desc, id desc
      limit $2`,
    [eventId, MESSAGE_PAGE_SIZE],
  );

  return json({
    messages: result.rows.reverse().map(toMessage),
    my_participant_id: member.id,
  });
}

/**
 * `POST /api/events/:id/messages`
 *
 * ★ THE SENDER NAME IS SNAPSHOTTED, AND THE PARTICIPANT ID IS THE CALLER'S OWN.
 *
 * `sender_name` is copied into the row rather than joined at read time. A person
 * who renames themselves should not silently rewrite what the thread says their
 * older messages were said by — the history is a record of who spoke, and the
 * display name at the time is part of that record.
 *
 * `participant_id` comes from the caller's own row, never from the body: a body
 * field here would let one participant post as another, which in a chat is
 * impersonation.
 */
export async function postMessageHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const member = await participantIn(eventId, caller);
  if (!member) return wireError('NOT_PARTICIPANT');

  if (!withinMutationLimits(caller, eventId)) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const validated = validateMessageBody(body.body);
  if (!validated.ok) {
    return validationFailed([{ path: ['body'], message: 'errors.validationFailed' }]);
  }

  const result = await scopedQueryable().query<MessageRow>(
    `insert into event_message (event_id, participant_id, sender_name, body, message_type)
     values ($1, $2, $3, $4, 'chat')
     returning id, event_id, participant_id, sender_name, body, message_type, created_at`,
    [eventId, member.id, member.display_name, validated.body],
  );

  const row = result.rows[0];
  if (!row) return wireError('VALIDATION_FAILED');

  return json({ message: toMessage(row) }, 201);
}

/**
 * `POST /api/messages/:id/report`
 *
 * ★ REPORTS EXIST BECAUSE THE APPLE GUIDELINE REQUIRES THEM (§1.2).
 *
 * A UGC surface without a report path is a review rejection, and more
 * importantly the only recourse a participant has. The reason is optional — the
 * coercion to report should never require an explanation — but bounded, because
 * it is free text that a moderator reads.
 *
 * The reporter is the caller's own participant row. `message_report.reporter_id`
 * references `participant`, and taking it from the body would let a client file
 * a report in someone else's name.
 */
export async function reportMessageHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const messageId = params.id ?? '';
  if (!isUuid(messageId)) return wireError('NOT_PARTICIPANT');

  // The message's event decides who is allowed to report it: a participant of
  // ANOTHER event has no business filing against this one.
  const found = await scopedQueryable().query<{ event_id: string }>(
    `select event_id from event_message where id = $1`,
    [messageId],
  );

  const eventId = found.rows[0]?.event_id;
  // An unknown message and one in an event the caller is not in answer
  // identically, so a report cannot be used to probe which ids exist.
  if (!eventId) return wireError('NOT_PARTICIPANT');

  const member = await participantIn(eventId, caller);
  if (!member) return wireError('NOT_PARTICIPANT');

  if (!withinMutationLimits(caller, eventId)) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  const rawReason = body?.reason;

  let reason: string | null = null;
  if (typeof rawReason === 'string' && rawReason.trim().length > 0) {
    reason = rawReason.trim().slice(0, REPORT_REASON_MAX);
  }

  const result = await scopedQueryable().query<{ id: string }>(
    `insert into message_report (message_id, reporter_id, reason)
     values ($1, $2, $3)
     returning id`,
    [messageId, member.id, reason],
  );

  return json({ report: { id: result.rows[0]?.id ?? null } }, 201);
}

/**
 * `PATCH /api/messages/:id`
 *
 * Edits the message body. Only the author can edit their own message.
 */
export async function editMessageHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const messageId = params.id ?? '';
  if (!isUuid(messageId)) return wireError('NOT_PARTICIPANT');

  const found = await scopedQueryable().query<{ event_id: string; participant_id: string }>(
    `select event_id, participant_id from event_message where id = $1`,
    [messageId],
  );

  const row = found.rows[0];
  if (!row) return wireError('NOT_PARTICIPANT');

  const member = await participantIn(row.event_id, caller);
  if (!member) return wireError('NOT_PARTICIPANT');

  if (member.id !== row.participant_id) {
    return wireError('NOT_PARTICIPANT');
  }

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const validated = validateMessageBody(body.body);
  if (!validated.ok) {
    return validationFailed([{ path: ['body'], message: 'errors.validationFailed' }]);
  }

  const result = await scopedQueryable().query<MessageRow>(
    `update event_message
        set body = $1
      where id = $2
      returning id, event_id, participant_id, sender_name, body, message_type, created_at`,
    [validated.body, messageId],
  );

  const updated = result.rows[0];
  if (!updated) return wireError('VALIDATION_FAILED');

  return json({ message: toMessage(updated) });
}

/**
 * `DELETE /api/messages/:id`
 *
 * Deletes the message. Author or event organizer may delete.
 */
export async function deleteMessageHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const messageId = params.id ?? '';
  if (!isUuid(messageId)) return wireError('NOT_PARTICIPANT');

  const found = await scopedQueryable().query<{ event_id: string; participant_id: string }>(
    `select event_id, participant_id from event_message where id = $1`,
    [messageId],
  );

  const row = found.rows[0];
  if (!row) return wireError('NOT_PARTICIPANT');

  const member = await participantIn(row.event_id, caller);
  if (!member) return wireError('NOT_PARTICIPANT');

  if (member.id !== row.participant_id) {
    const roleResult = await scopedQueryable().query<{ role: string }>(
      `select role from participant where id = $1`,
      [member.id],
    );
    if (roleResult.rows[0]?.role !== 'organizer') {
      return wireError('NOT_PARTICIPANT');
    }
  }

  await scopedQueryable().query(
    `delete from event_message where id = $1`,
    [messageId],
  );

  return json({ deleted: true, id: messageId });
}
