/**
 * The chat client service (D23 — PRD-06 FR-6.7b).
 *
 * ★ THE THREAD IS FED BY TWO PATHS, AND THEY MUST CONVERGE.
 *
 * A sender's own message arrives twice: once as the POST response and once as the
 * realtime `chat` change. Without deduplication the sender sees their sentence in
 * two bubbles — the most visible possible bug in a chat, and one that only shows
 * on a live connection.
 *
 * The composer's rules are asserted here too, because `canSend` is what decides
 * whether the send control is enabled: an off-by-one there means the 500th
 * character is unreachable, or the 501st is sent and rejected by the server.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MESSAGE_BODY_MAX,
  appendMessage,
  canSend,
  remaining,
  type ChatMessage,
} from '../../src/features/events/services/chat-rules';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    event_id: 'e-1',
    participant_id: 'p-1',
    sender_name: 'Bahar',
    body: 'سلام',
    message_type: 'chat',
    created_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('the composer rules', () => {
  test('an empty or whitespace-only draft cannot be sent', () => {
    for (const draft of ['', ' ', '   ', '\n', '\t\t']) {
      assert.equal(canSend(draft), false, JSON.stringify(draft));
    }
  });

  test(`★ exactly ${MESSAGE_BODY_MAX} characters is sendable, ${MESSAGE_BODY_MAX + 1} is not`, () => {
    // The server accepts at the bound and rejects one over. An off-by-one here
    // would disable the control one character early, or let a doomed send
    // through.
    assert.equal(canSend('ا'.repeat(MESSAGE_BODY_MAX)), true);
    assert.equal(canSend('ا'.repeat(MESSAGE_BODY_MAX + 1)), false);
  });

  test('the bound counts characters, not bytes', () => {
    // Persian letters are 2 bytes in UTF-8; counting bytes would cap a
    // Persian-only message at half the intended length.
    assert.equal(canSend('ا'.repeat(MESSAGE_BODY_MAX)), true);
  });

  test('surrounding whitespace does not count toward the bound', () => {
    // The server trims before measuring, so the composer must agree — otherwise
    // it disables a send the server would have accepted.
    assert.equal(canSend(`  ${'ا'.repeat(MESSAGE_BODY_MAX)}  `), true);
  });

  test('the counter floors at zero rather than going negative', () => {
    assert.equal(remaining(''), MESSAGE_BODY_MAX);
    assert.equal(remaining('ا'.repeat(MESSAGE_BODY_MAX + 20)), 0);
  });
});

describe('appending to the live thread', () => {
  test('★ a message already present is not added twice', () => {
    // The POST echo and the realtime change carry the same id.
    const existing = message({ id: 'm-1', created_at: '2026-08-01T10:00:00.000Z' });
    const echo = message({ id: 'm-1', created_at: '2026-08-01T10:00:00.000Z' });

    const after = appendMessage([existing], echo);

    assert.equal(after.length, 1);
  });

  test('a change to an existing id does not duplicate either', () => {
    // Same id, different body: still one bubble. An edit arriving over the
    // socket must not fork the message.
    const existing = message({ id: 'm-1', body: 'قدیمی' });
    const updated = message({ id: 'm-1', body: 'جدید' });

    assert.equal(appendMessage([existing], updated).length, 1);
  });

  test('a new message is appended in timestamp order', () => {
    const first = message({ id: 'm-1', created_at: '2026-08-01T10:00:00.000Z' });
    const second = message({ id: 'm-2', created_at: '2026-08-01T10:00:05.000Z' });

    // Delivered out of order, as a socket can.
    const after = appendMessage([second], first);

    assert.deepEqual(
      after.map((entry) => entry.id),
      ['m-1', 'm-2'],
    );
  });

  test('a timestamp tie breaks by id, so two devices agree', () => {
    const at = '2026-08-01T10:00:00.000Z';
    const a = message({ id: 'm-b', created_at: at });
    const b = message({ id: 'm-a', created_at: at });

    const forward = appendMessage([a], b).map((entry) => entry.id);
    const backward = appendMessage([b], a).map((entry) => entry.id);

    assert.deepEqual(forward, backward);
  });

  test('appending does not mutate the input array', () => {
    const original = [message({ id: 'm-1' })];
    appendMessage(original, message({ id: 'm-2', created_at: '2026-08-01T11:00:00.000Z' }));

    assert.equal(original.length, 1);
  });
});
