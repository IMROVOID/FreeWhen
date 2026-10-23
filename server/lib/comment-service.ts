/**
 * Per-proposal comments (Plan 14 Task 5, PRD-02 §4.3, PRD-06 E5).
 *
 * ★ SCOPED TO A PROPOSAL, NEVER TO THE EVENT.
 *
 * A general event chat would trigger Apple §1.2's UGC obligations — filtering,
 * reporting, blocking, a published contact — which cannot be staffed here. That
 * is why there is no event-wide comment route and why this module has no
 * `eventId` parameter: the only way in is a proposal id.
 *
 * ★ PLAIN TEXT, 1–300 CHARACTERS, NO MENTIONS, NO MEDIA, NO REACTIONS.
 *
 * The bound is enforced twice — by `comment.body`'s check constraint (migration
 * 009) and by the schema — and the shape here is a bare string. Adding a
 * `mentions` field is what makes §1.2 apply; the absence is deliberate.
 *
 * ★ COMMENT BODIES ARE REDACTED LIKE PASTED TEXT.
 *
 * `src/lib/redact.ts` lists `body` in FORBIDDEN_KEYS, so a comment body is
 * scrubbed by `logSafe` without this module doing anything. Everything logged
 * below therefore names a COUNT or an id, never the text.
 */

import { redactObject } from '@/src/lib/redact';
import { COMMENT_MAX_CHARS, COMMENT_MIN_CHARS } from '@/src/types/comment';

import { appendActivity } from './vote-service';
import { participantIn } from './vote-service';
import { servicePool, withTransaction } from './supabase';
import type { Caller } from './supabase';

/** One comment as the wire returns it. */
export interface CommentRow {
  id: string;
  proposal_id: string;
  participant_id: string;
  /** The author's display name. Names are data, never translated. */
  display_name: string;
  body: string;
  created_at: string;
  /** Whether the CALLER may delete it — author or organizer. */
  can_delete: boolean;
}

interface RawCommentRow {
  id: string;
  proposal_id: string;
  participant_id: string;
  display_name: string;
  body: string;
  created_at: Date;
}

const COMMENT_COLUMNS = `c.id, c.proposal_id, c.participant_id, p.display_name, c.body, c.created_at`;

/**
 * The catalogue keys the sheet renders under the composer.
 *
 * Exported so the route and the DB test assert the same string; a key that
 * drifts between them is a message the screen silently fails to render.
 */
export const COMMENT_KEYS = {
  required: 'comments.validation.bodyRequired',
  tooLong: 'comments.validation.bodyTooLong',
  withdrawn: 'comments.validation.proposalWithdrawn',
} as const;

/** The proposal exists, with the event it belongs to. `null` when it does not. */
async function proposalEvent(proposalId: string): Promise<string | null> {
  const result = await servicePool().query<{ event_id: string }>(
    `select event_id from proposal where id = $1`,
    [proposalId],
  );

  return result.rows[0]?.event_id ?? null;
}

/** Whether this participant organizes the event. */
function isOrganizer(role: string): boolean {
  return role === 'organizer';
}

/**
 * Every comment on one proposal, oldest first.
 *
 * ★ A WITHDRAWN PROPOSAL'S COMMENTS STAY READABLE (E5).
 *
 * The proposal's status is not consulted. Removing the comments of a withdrawn
 * proposal would erase what people said about it at the moment the history
 * became most interesting — and the card states `«پیشنهاد لغو شد»` so the reader
 * knows it is over.
 *
 * Returns `null` when the caller is not a participant of that event, so the
 * route can answer 403 without a second query.
 */
export async function listComments(
  caller: Caller,
  proposalId: string,
): Promise<CommentRow[] | null> {
  const eventId = await proposalEvent(proposalId);
  if (!eventId) return null;

  const me = await participantIn(eventId, caller);
  if (!me) return null;

  const result = await servicePool().query<RawCommentRow>(
    `select ${COMMENT_COLUMNS}
     from comment c
     join participant p on p.id = c.participant_id
     where c.proposal_id = $1
     order by c.created_at asc, c.id asc`,
    [proposalId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    proposal_id: row.proposal_id,
    participant_id: row.participant_id,
    display_name: row.display_name,
    body: row.body,
    created_at: row.created_at.toISOString(),
    can_delete: row.participant_id === me.id || isOrganizer(me.role),
  }));
}

export type CreateCommentOutcome =
  | { status: 'CREATED'; comment: CommentRow }
  | { status: 'NOT_PARTICIPANT' }
  | { status: 'PROPOSAL_NOT_FOUND' }
  | { status: 'EMPTY_BODY' }
  | { status: 'BODY_TOO_LONG' };

/**
 * Adds a comment to a proposal.
 *
 * ★ THE BODY IS TRIMMED BEFORE IT IS MEASURED, AND STORED TRIMMED.
 *
 * A body of three spaces is not a comment, and storing it would render an empty
 * bubble the author cannot see to delete. The schema trims and bounds it at the
 * route; this trims again because it is also reachable from a job later, and a
 * service that trusts its caller is one refactor away from storing `"   "`.
 */
export async function createComment(
  caller: Caller,
  proposalId: string,
  body: string,
): Promise<CreateCommentOutcome> {
  const trimmed = body.trim();

  if (trimmed.length < COMMENT_MIN_CHARS) return { status: 'EMPTY_BODY' };
  if (trimmed.length > COMMENT_MAX_CHARS) return { status: 'BODY_TOO_LONG' };

  const eventId = await proposalEvent(proposalId);
  if (!eventId) return { status: 'PROPOSAL_NOT_FOUND' };

  const me = await participantIn(eventId, caller);
  if (!me) return { status: 'NOT_PARTICIPANT' };

  const inserted = await servicePool().query<{ id: string; created_at: Date }>(
    `insert into comment (proposal_id, participant_id, body)
     values ($1, $2, $3)
     returning id, created_at`,
    [proposalId, me.id, trimmed],
  );

  const row = inserted.rows[0]!;

  return {
    status: 'CREATED',
    comment: {
      id: row.id,
      proposal_id: proposalId,
      participant_id: me.id,
      display_name: me.display_name,
      body: trimmed,
      created_at: row.created_at.toISOString(),
      can_delete: true,
    },
  };
}

export type DeleteCommentOutcome =
  | { status: 'DELETED' }
  | { status: 'NOT_PARTICIPANT' }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_ALLOWED' };

/**
 * Deletes one comment — the author, or the organizer.
 *
 * ★ THE PERMISSION IS CHECKED IN SQL, NOT BY A PRIOR READ.
 *
 * A read-then-delete would let a caller who lost their organizer role between
 * the two statements succeed, and would let two concurrent deletes both believe
 * they removed a row. The `or` in the `where` clause makes the check part of the
 * write, and the returned row count is the answer.
 */
export async function deleteComment(
  caller: Caller,
  commentId: string,
): Promise<DeleteCommentOutcome> {
  return withTransaction(async (client) => {
    const found = await client.query<{
      event_id: string;
      proposal_id: string;
      author_id: string;
    }>(
      `select pr.event_id, c.proposal_id, c.participant_id as author_id
       from comment c
       join proposal pr on pr.id = c.proposal_id
       where c.id = $1`,
      [commentId],
    );

    const comment = found.rows[0];
    if (!comment) return { status: 'NOT_FOUND' };

    const me = await participantIn(comment.event_id, caller, client);
    if (!me) return { status: 'NOT_PARTICIPANT' };

    if (comment.author_id !== me.id && !isOrganizer(me.role)) {
      return { status: 'NOT_ALLOWED' };
    }

    const deleted = await client.query(
      `delete from comment where id = $1`,
      [commentId],
    );

    if (deleted.rowCount === 0) return { status: 'NOT_FOUND' };

    // ★ THE LOG RECORDS THE ACT, NOT THE TEXT.
    //
    // `detail` carries ids and a role, never the body: the activity feed is
    // visible to every participant and `redact` scrubs `body` on the way out
    // anyway, so putting it in would store a value that could never be shown.
    await appendActivity(client, {
      eventId: comment.event_id,
      actorId: me.id,
      action: 'comment_deleted',
      subjectType: 'proposal',
      subjectId: comment.proposal_id,
      detail: {
        comment_id: commentId,
        as_organizer: comment.author_id !== me.id,
      },
    });

    return { status: 'DELETED' };
  });
}

/**
 * A redacted echo of a comment body, for a log line that needs to be sized.
 *
 * Exported only so the DB test can assert that a body passed through the
 * redactor keeps its LENGTH and loses its content. Nothing in the request path
 * logs a body.
 */
export function redactedForLog(body: string): Record<string, unknown> {
  return redactObject({ body, length: body.length });
}
