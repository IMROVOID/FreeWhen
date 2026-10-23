/**
 * Per-proposal comments (Plan 14 Task 5, PRD-02 §4.3, PRD-06 E5).
 *
 * ★ THE BAR FROM THE PLAN, ONE TEST PER CLAUSE.
 *
 * | Clause | Test |
 * |---|---|
 * | Auth | a non-participant cannot read or write; an anonymous caller cannot either |
 * | Length | empty is refused; 300 is accepted; 301 is refused |
 * | Redaction | the body never appears in an activity or funnel payload |
 * | Organizer delete | the organizer removes someone else's; a peer cannot |
 *
 * ★ E5 — A WITHDRAWN PROPOSAL'S COMMENTS STAY READABLE.
 *
 * The read keeps returning them and the write refuses. "History must not
 * vanish" is the requirement, and a deleted-on-withdraw implementation would
 * satisfy every other clause here.
 *
 * ★ THE BOUND IS 300, NOT 500.
 *
 * `comment.body` has `char_length(body) between 1 and 300` since migration 009.
 * The plan's own Testing Strategy says 300 in one place and the task list says
 * 500 in another; the DATABASE and the schema both say 300, and a looser API
 * would turn a long comment into a 500 from Postgres.
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import { COMMENT_MAX_CHARS } from '../../src/types/comment';
import { redactedForLog } from '../../server/lib/comment-service';
import {
  addMember,
  asOwner,
  closePool,
  createUser,
  seedEvent,
  seedVenue,
  truncateAll,
} from './support';
import { bodyOf, call, prepareServerEnv, prepareServerSql } from './server-support';

interface CommentBody {
  id: string;
  proposal_id: string;
  participant_id: string;
  display_name: string;
  body: string;
  created_at: string;
  can_delete: boolean;
}

async function seedProposal(
  eventId: string,
  proposerId: string,
  status = 'OPEN',
): Promise<string> {
  const venueId = await seedVenue(eventId, { name: 'کافه دیدار' });

  const row = await asOwner<{ id: string }>(
    `insert into proposal (event_id, created_by, type, title, venue_id, start_utc, end_utc, status)
     values ($1, $2, 'TIME_AND_PLACE', 'شام جمعه', $3, now() + interval '2 days',
             now() + interval '2 days 2 hours', $4)
     returning id`,
    [eventId, proposerId, venueId, status],
  );

  return row.rows[0]!.id;
}

function postComment(proposalId: string, userId: string | null, body: unknown) {
  return call(`/api/proposals/${proposalId}/comments`, {
    method: 'POST',
    userId,
    body: { body },
  });
}

function listComments(proposalId: string, userId: string | null) {
  return call(`/api/proposals/${proposalId}/comments`, { userId });
}

describe('per-proposal comments', { concurrency: false }, () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  before(truncateAll);
  after(closePool);

  // ───────────────────────────────────────────────────────────
  // The write path
  // ───────────────────────────────────────────────────────────

  test('a participant can comment, and it comes back in the list', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const created = await postComment(proposalId, organizerId, 'ساعت ۸ برای من خوبه');
    assert.equal(created.status, 201);

    const body = await bodyOf<{ comment: CommentBody }>(created);
    assert.equal(body.comment.body, 'ساعت ۸ برای من خوبه');
    assert.equal(body.comment.can_delete, true, 'the author may delete their own');

    const listed = await listComments(proposalId, organizerId);
    assert.equal(listed.status, 200);

    const rows = await bodyOf<{ comments: CommentBody[] }>(listed);
    assert.equal(rows.comments.length, 1);
    assert.equal(rows.comments[0]!.id, body.comment.id);
  });

  test('the body is trimmed before it is stored', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const created = await postComment(proposalId, organizerId, '  پارکینگ داره؟  ');
    assert.equal(created.status, 201);

    const body = await bodyOf<{ comment: CommentBody }>(created);
    assert.equal(body.comment.body, 'پارکینگ داره؟');
  });

  test('an empty or whitespace-only body is refused', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    for (const value of ['', '   ', '\n\t ']) {
      const response = await postComment(proposalId, organizerId, value);
      assert.equal(response.status, 422, `"${value}" should be refused`);
      assert.equal((await bodyOf<{ fields: Record<string, string> }>(response)).fields.body,
        'comments.validation.bodyRequired');
    }

    const listed = await listComments(proposalId, organizerId);
    assert.equal((await bodyOf<{ comments: CommentBody[] }>(listed)).comments.length, 0);
  });

  test('300 characters is accepted and 301 is refused', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    // The boundary, exactly.
    const atLimit = 'ا'.repeat(COMMENT_MAX_CHARS);
    const accepted = await postComment(proposalId, organizerId, atLimit);
    assert.equal(accepted.status, 201, `accepted at ${COMMENT_MAX_CHARS}`);

    const overLimit = 'ا'.repeat(COMMENT_MAX_CHARS + 1);
    const refused = await postComment(proposalId, organizerId, overLimit);
    assert.equal(refused.status, 422);

    const fields = await bodyOf<{ fields: Record<string, string> }>(refused);
    assert.equal(fields.fields.body, 'comments.validation.bodyTooLong');
  });

  test('a non-string body is refused rather than coerced', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    for (const value of [null, 42, {}, ['a'], true]) {
      const response = await postComment(proposalId, organizerId, value);
      assert.equal(response.status, 422, `${JSON.stringify(value)} should be refused`);
    }
  });

  // ───────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────

  test('an anonymous caller cannot read or write', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    assert.equal((await postComment(proposalId, null, 'سلام')).status, 403);
    assert.equal((await listComments(proposalId, null)).status, 403);
  });

  test('a non-participant cannot read or write', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const outsider = await createUser();

    assert.equal((await postComment(proposalId, outsider, 'سلام')).status, 403);
    assert.equal((await listComments(proposalId, outsider)).status, 403);

    const stored = await asOwner<{ count: string }>(
      `select count(*)::text as count from comment where proposal_id = $1`,
      [proposalId],
    );
    assert.equal(stored.rows[0]?.count, '0', 'nothing was written');
  });

  test('a malformed proposal id answers 403, not a 500', async () => {
    const { organizerId } = await seedEvent();
    const response = await postComment('not-a-uuid', organizerId, 'سلام');

    assert.equal(response.status, 403);
  });

  // ───────────────────────────────────────────────────────────
  // E5 — a withdrawn proposal is read-only, not erased
  // ───────────────────────────────────────────────────────────

  test('a withdrawn proposal refuses new comments but keeps the old ones', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    // Arrange — a comment while it was open.
    await postComment(proposalId, organizerId, 'من موافقم');

    await asOwner(`update proposal set status = 'WITHDRAWN' where id = $1`, [proposalId]);

    // Act — a new comment on the withdrawn proposal.
    const refused = await postComment(proposalId, organizerId, 'حیف شد');
    assert.equal(refused.status, 422);

    // Assert — the old one is still there.
    const listed = await listComments(proposalId, organizerId);
    assert.equal(listed.status, 200);

    const rows = await bodyOf<{ comments: CommentBody[] }>(listed);
    assert.equal(rows.comments.length, 1, 'history does not vanish');
    assert.equal(rows.comments[0]!.body, 'من موافقم');
  });

  // ───────────────────────────────────────────────────────────
  // Delete — author, organizer, and neither
  // ───────────────────────────────────────────────────────────

  test('the author can delete their own comment', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const created = await postComment(proposalId, organizerId, 'اینو پاک می‌کنم');
    const commentId = (await bodyOf<{ comment: CommentBody }>(created)).comment.id;

    const deleted = await call(`/api/comments/${commentId}`, {
      method: 'DELETE',
      userId: organizerId,
    });

    assert.equal(deleted.status, 200);

    const listed = await listComments(proposalId, organizerId);
    assert.equal((await bodyOf<{ comments: CommentBody[] }>(listed)).comments.length, 0);
  });

  test('the organizer can delete someone else’s comment', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const guest = await addMember(eventId, { displayName: 'سارا' });
    const created = await postComment(proposalId, guest.userId, 'یک نظر');
    const commentId = (await bodyOf<{ comment: CommentBody }>(created)).comment.id;

    // Act — the organizer moderates.
    const deleted = await call(`/api/comments/${commentId}`, {
      method: 'DELETE',
      userId: organizerId,
    });

    assert.equal(deleted.status, 200);

    const stored = await asOwner<{ count: string }>(
      `select count(*)::text as count from comment where id = $1`,
      [commentId],
    );
    assert.equal(stored.rows[0]?.count, '0');
  });

  test('a peer cannot delete someone else’s comment', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const sara = await addMember(eventId, { displayName: 'سارا' });
    const darya = await addMember(eventId, { displayName: 'دریا' });

    const created = await postComment(proposalId, sara.userId, 'نظر سارا');
    const commentId = (await bodyOf<{ comment: CommentBody }>(created)).comment.id;

    // Act — a fellow guest, not the organizer.
    const refused = await call(`/api/comments/${commentId}`, {
      method: 'DELETE',
      userId: darya.userId,
    });

    assert.equal(refused.status, 403);

    // The organizer's own attempt is what proves the refusal was about identity,
    // not a broken route.
    const allowed = await call(`/api/comments/${commentId}`, {
      method: 'DELETE',
      userId: organizerId,
    });
    assert.equal(allowed.status, 200);
  });

  test('a non-participant cannot delete anything', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const created = await postComment(proposalId, organizerId, 'یک نظر');
    const commentId = (await bodyOf<{ comment: CommentBody }>(created)).comment.id;

    const outsider = await createUser();
    const refused = await call(`/api/comments/${commentId}`, {
      method: 'DELETE',
      userId: outsider,
    });

    assert.equal(refused.status, 403);
  });

  test('can_delete reflects the caller, not the row', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const sara = await addMember(eventId, { displayName: 'سارا' });
    const darya = await addMember(eventId, { displayName: 'دریا' });

    await postComment(proposalId, sara.userId, 'نظر سارا');

    // Sara may delete her own ...
    const own = await bodyOf<{ comments: CommentBody[] }>(
      await listComments(proposalId, sara.userId),
    );
    assert.equal(own.comments[0]!.can_delete, true);

    // ... Darya may not, and the FLAG says so rather than the client guessing.
    const peer = await bodyOf<{ comments: CommentBody[] }>(
      await listComments(proposalId, darya.userId),
    );
    assert.equal(peer.comments[0]!.can_delete, false);

    // ... and the organizer may.
    const organizer = await bodyOf<{ comments: CommentBody[] }>(
      await listComments(proposalId, organizerId),
    );
    assert.equal(organizer.comments[0]!.can_delete, true);
  });

  // ───────────────────────────────────────────────────────────
  // Redaction
  // ───────────────────────────────────────────────────────────

  test('a comment body is redacted by the logger', () => {
    const body = 'کافه دیدار، همون نبش خیابون';

    // ★ THE ONLY LOGGING PATH (src/lib/redact.ts). `body` is in FORBIDDEN_KEYS,
    // so the text cannot reach a log line even when someone hands it over.
    const redacted = redactedForLog(body);

    assert.notEqual(redacted.body, body, 'the text is not passed through');
    assert.equal(redacted.length, body.length, 'but its size still is');
    assert.ok(!JSON.stringify(redacted).includes('نبش خیابون'), 'no fragment survives');
  });

  test('the activity log records a deletion without the text', async () => {
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId);

    const created = await postComment(proposalId, organizerId, 'متن محرمانه نظر');
    const commentId = (await bodyOf<{ comment: CommentBody }>(created)).comment.id;

    await call(`/api/comments/${commentId}`, { method: 'DELETE', userId: organizerId });

    const rows = await asOwner<{ action: string; detail: Record<string, unknown> }>(
      `select action, detail from activity_log where event_id = $1 and action = 'comment_deleted'`,
      [eventId],
    );

    assert.equal(rows.rows.length, 1, 'the deletion is recorded');
    const detail = rows.rows[0]!.detail;
    assert.equal(detail.comment_id, commentId);
    assert.equal(detail.as_organizer, false, 'the author deleted their own');

    // ★ THE TEXT IS NOT IN THE TRAIL.
    assert.ok(
      !JSON.stringify(detail).includes('محرمانه'),
      'a comment body must never reach the activity log',
    );
  });
});
