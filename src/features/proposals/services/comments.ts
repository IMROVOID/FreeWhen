/**
 * The per-proposal comment client service (Plan 14 Task 5).
 *
 * ★ EVERY FAILURE CARRIES A CATALOGUE KEY, NOT A SENTENCE.
 *
 * Same contract as the rest of the app: the server answers with
 * `{ error, messageKey, fields }`, `apiRequest` turns that into an `ApiFailure`,
 * and the sheet renders it through `t()`.
 *
 * ★ THE BODY IS NEVER LOGGED OR ECHOED.
 *
 * Nothing here sends a comment body anywhere but the API. A failed post
 * surfaces the server's key; it does not repeat what the user typed into an
 * error channel. `src/lib/redact.ts` lists `body` for the same reason.
 */

import { apiRequest } from '@/src/lib/api';

/** One comment as the wire carries it, with the caller's own delete permission. */
export interface WireComment {
  id: string;
  proposal_id: string;
  participant_id: string;
  display_name: string;
  body: string;
  created_at: string;
  /** Author or organizer — computed server-side, not guessed here. */
  can_delete: boolean;
}

export async function fetchComments(
  proposalId: string,
  userId: string | null,
): Promise<WireComment[]> {
  const { data } = await apiRequest<{ comments: WireComment[] }>(
    `/api/proposals/${proposalId}/comments`,
    { userId },
  );

  return data.comments;
}

export async function postComment(
  proposalId: string,
  body: string,
  userId: string | null,
): Promise<WireComment> {
  const { data } = await apiRequest<{ comment: WireComment }>(
    `/api/proposals/${proposalId}/comments`,
    { method: 'POST', userId, body: { body } },
  );

  return data.comment;
}

export async function deleteComment(
  commentId: string,
  userId: string | null,
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/comments/${commentId}`, {
    method: 'DELETE',
    userId,
  });
}
