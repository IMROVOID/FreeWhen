/**
 * Per-proposal comment schemas (Plan 14 Task 5, PRD-02 §4.3).
 *
 * ★ A BODY IS A PLAIN STRING, AND THAT IS A DELIBERATE SHAPE.
 *
 * No `mentions`, no `attachments`, no `reactions`. Adding any of them is what
 * makes Apple §1.2's UGC obligations apply — filtering, reporting, blocking and a
 * published contact — which cannot be staffed in this project. The type is the
 * boundary, so the boundary is stated in the type.
 *
 * ★ THE BOUNDS MATCH `comment.body`'s CHECK CONSTRAINT (migration 009).
 *
 * `char_length(body) between 1 and 300`. A schema looser than the database turns
 * a user's over-long comment into a 500 raised by Postgres — a message they
 * cannot act on. `src/types/proposal.ts` states the same rule for the same
 * reason.
 *
 * ★ MENTION SYNTAX IS NOT PARSED, SO IT IS NOT SPECIAL.
 *
 * An `@name` in a body is stored and rendered as the literal characters it is.
 * There is no mention pipeline to disable, because there is no mention pipeline.
 */

import { z } from 'zod';

/** The stored bounds, mirroring `009_comment_rsvp_activity.sql`. */
export const COMMENT_MIN_CHARS = 1;
export const COMMENT_MAX_CHARS = 300;

/** The validation keys, so a caller cannot misspell one. */
export const COMMENT_VALIDATION = {
  bodyRequired: 'comments.validation.bodyRequired',
  bodyTooLong: 'comments.validation.bodyTooLong',
} as const;

/**
 * `POST /api/proposals/:id/comments`.
 *
 * The body is trimmed before it is measured, because three spaces is not a
 * comment and storing one would render an empty bubble.
 */
export const CommentCreateSchema = z.object({
  body: z
    .string({ message: COMMENT_VALIDATION.bodyRequired })
    .trim()
    .min(COMMENT_MIN_CHARS, { message: COMMENT_VALIDATION.bodyRequired })
    .max(COMMENT_MAX_CHARS, { message: COMMENT_VALIDATION.bodyTooLong }),
});

export type CommentCreateInput = z.infer<typeof CommentCreateSchema>;
