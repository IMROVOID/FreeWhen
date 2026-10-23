/**
 * `GET|POST /api/proposals/:id/comments`, `DELETE /api/comments/:id`
 * (Plan 14 Task 5, PRD-02 §4.3, PRD-06 E5).
 *
 * ★ THE PATH IS SCOPED TO A PROPOSAL, AND THERE IS NO EVENT-SCOPED SIBLING.
 *
 * `/api/events/:id/comments` does not exist and must not be added: a general
 * event chat triggers Apple §1.2's UGC obligations. The path shape is the
 * enforcement, so the route table has no way to express the wrong thing.
 *
 * ★ A WITHDRAWN PROPOSAL'S COMMENTS STAY VISIBLE AND READ-ONLY (E5).
 *
 * `POST` refuses with `COMMENT_KEYS.withdrawn`; `GET` keeps returning the rows.
 * History must not vanish when a proposal is struck through — the card states
 * `«پیشنهاد لغو شد»` and the comments remain as the record of what people said
 * while it was open.
 */

import { CommentCreateSchema } from '@/src/types/comment';

import { track } from '../lib/funnel';
import { COMMENT_KEYS, createComment, deleteComment, listComments } from '../lib/comment-service';
import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { limiters } from '../lib/rate-limit';
import { resolveCaller, type Caller } from '../lib/supabase';
import { participantIn, proposalGuard } from '../lib/vote-service';

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/** `GET /api/proposals/:id/comments` — oldest first, with `can_delete` per row. */
export async function listCommentsHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const proposalId = params.id ?? '';
  if (!isUuid(proposalId)) return wireError('NOT_PARTICIPANT');

  const comments = await listComments(caller, proposalId);

  // One answer for "no such proposal" and "not your event": whether a proposal
  // id exists is not something a non-participant should be able to probe.
  if (!comments) return wireError('NOT_PARTICIPANT');

  return json({ comments });
}

/** `POST /api/proposals/:id/comments` — Body: `{ body: string }`. */
export async function createCommentHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const proposalId = params.id ?? '';
  if (!isUuid(proposalId)) return wireError('NOT_PARTICIPANT');

  const guard = await proposalGuard(proposalId);
  if (!guard) return wireError('NOT_PARTICIPANT');

  const event = await participantIn(guard.eventId, caller);
  if (!event) return wireError('NOT_PARTICIPANT');

  const budget = limiters.mutationByParticipant.check(`comment:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const raw = await readJsonBody(request);
  if (!raw) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = CommentCreateSchema.safeParse(raw);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  // ★ A WITHDRAWN PROPOSAL TAKES NO NEW COMMENTS (E5).
  //
  // Commenting on something nobody can vote on produces a discussion with no
  // decision attached to it. The existing comments stay readable.
  if (guard.status === 'WITHDRAWN') {
    return validationFailed([{ path: ['body'], message: COMMENT_KEYS.withdrawn }]);
  }

  const outcome = await createComment(caller, proposalId, parsed.data.body);

  switch (outcome.status) {
    case 'CREATED':
      // ★ THE METRIC COUNTS THE EVENT, NEVER THE TEXT.
      track('comment_added', {
        event_id: guard.eventId,
        proposal_id: proposalId,
        length: parsed.data.body.length,
      });

      return json({ comment: outcome.comment }, 201);
    case 'EMPTY_BODY':
      return validationFailed([{ path: ['body'], message: COMMENT_KEYS.required }]);
    case 'BODY_TOO_LONG':
      return validationFailed([{ path: ['body'], message: COMMENT_KEYS.tooLong }]);
    case 'PROPOSAL_NOT_FOUND':
    case 'NOT_PARTICIPANT':
      return wireError('NOT_PARTICIPANT');
  }
}

/** `DELETE /api/comments/:id` — the author, or the organizer. */
export async function deleteCommentHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const commentId = params.id ?? '';
  if (!isUuid(commentId)) return wireError('NOT_PARTICIPANT');

  const outcome = await deleteComment(caller, commentId);

  switch (outcome.status) {
    case 'DELETED':
      return json({ deleted: true });
    case 'NOT_PARTICIPANT':
      return wireError('NOT_PARTICIPANT');
    case 'NOT_ALLOWED':
      // ★ 403, NOT 404. The caller is a participant and can see the comment in
      // the list; pretending it does not exist would contradict the screen they
      // are looking at.
      return wireError('NOT_ORGANIZER');
    case 'NOT_FOUND':
      return wireError('NOT_PARTICIPANT');
  }
}
