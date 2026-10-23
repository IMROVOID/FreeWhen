/**
 * The in-room chat API (D23 — PRD-06 FR-6.7b).
 *
 * ★ THE TABLES, RLS AND REALTIME WERE ALREADY THERE. THIS PINS THE ALGORITHM
 * THE SCREENS CALL.
 *
 * The four facts a chat surface has to get right, and this file asserts each:
 *
 *  1. **A non-participant sees nothing** — not an empty thread with a 200.
 *  2. **The body bound is enforced server-side** — the column's constraint is a
 *     500, and a 422 belongs there instead.
 *  3. **A body never reaches a log** — user-generated text is the thing the
 *     redaction module exists for.
 *  4. **A report can be filed** — Apple §1.2, and the participant's only recourse.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { logSafe, REDACTED } from '@/src/lib/redact';
import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool, truncateAll } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
} from './server-support';

prepareServerEnv();

interface JoinBody {
  participant: { id: string; display_name: string };
}

async function joinAs(
  token: string,
  name: string,
): Promise<{ participantId: string; userId: string }> {
  const response = await call(`/api/invite/${token}/join`, {
    method: 'POST',
    body: { display_name: name },
  });

  const body = await bodyOf<JoinBody>(response);
  return {
    participantId: body.participant.id,
    userId: response.headers.get('x-user-id') ?? '',
  };
}

interface WireMessage {
  id: string;
  event_id: string;
  participant_id: string;
  sender_name: string;
  body: string;
  message_type: string;
  created_at: string;
}

describe('the chat API', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    resetRateLimits();
    await truncateAll();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('a participant posts and reads back what they wrote', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Bahar');

    const posted = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: 'ساعت هفت جلوی رستوران' },
    });

    assert.equal(posted.status, 201);

    const { message } = await bodyOf<{ message: WireMessage }>(posted);

    assert.equal(message.body, 'ساعت هفت جلوی رستوران');
    assert.equal(message.sender_name, 'Bahar');
    assert.equal(message.participant_id, member.participantId);
    assert.equal(message.message_type, 'chat');

    const listed = await call(`/api/events/${created.eventId}/messages`, {
      userId: member.userId,
    });

    assert.equal(listed.status, 200);

    const { messages } = await bodyOf<{ messages: WireMessage[] }>(listed);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.body, 'ساعت هفت جلوی رستوران');
  });

  test('★ a non-participant sees zero rows, and is told so', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Nima');

    await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: 'یک پیام خصوصی' },
    });

    // A stranger with their own valid identity.
    const outsider = await createEventViaApi();

    const response = await call(`/api/events/${created.eventId}/messages`, {
      userId: outsider.userId,
    });

    // NOT_PARTICIPANT rather than an empty 200: an empty thread would read as
    // "nobody has spoken", which is a different and false statement.
    assert.equal(response.status, 403);

    const body = await bodyOf<{ error: string }>(response);
    assert.equal(body.error, 'NOT_PARTICIPANT');
  });

  test('a non-participant cannot post', async () => {
    const created = await createEventViaApi();
    const outsider = await createEventViaApi();

    const response = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: outsider.userId,
      body: { body: 'سلام' },
    });

    assert.equal(response.status, 403);
  });

  test('an anonymous caller is refused', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      body: { body: 'سلام' },
    });

    assert.equal(response.status, 403);
  });

  test('★ a 500-character body is accepted, 501 is refused with 422', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Sara');

    const atLimit = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: 'ا'.repeat(500) },
    });

    assert.equal(atLimit.status, 201);

    // One character over. The column would reject this as a constraint
    // violation (a 500); the route must answer 422 first.
    const overLimit = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: 'ا'.repeat(501) },
    });

    assert.equal(overLimit.status, 422);
  });

  test('an empty or whitespace-only body is refused', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Ali');

    for (const body of ['', '   ', '\n\t ']) {
      const response = await call(`/api/events/${created.eventId}/messages`, {
        method: 'POST',
        userId: member.userId,
        body: { body },
      });

      assert.equal(response.status, 422, `body=${JSON.stringify(body)}`);
    }
  });

  test('a non-string body is refused rather than coerced', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Mina');

    for (const body of [42, null, { text: 'hi' }, ['a']]) {
      const response = await call(`/api/events/${created.eventId}/messages`, {
        method: 'POST',
        userId: member.userId,
        body: { body },
      });

      assert.equal(response.status, 422, `body=${JSON.stringify(body)}`);
    }
  });

  test('the body is trimmed, so padding cannot smuggle a longer message past', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Reza');

    const response = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: `   ${'ب'.repeat(500)}   ` },
    });

    assert.equal(response.status, 201);

    const { message } = await bodyOf<{ message: WireMessage }>(response);
    // Trimmed to exactly the bound, then accepted.
    assert.equal(message.body.length, 500);
  });

  test('the sender name is snapshotted, so a later rename does not rewrite history', async () => {
    const created = await createEventViaApi();
    const member = await joinAs(created.token, 'Original');

    const posted = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: member.userId,
      body: { body: 'قبل از تغییر نام' },
    });

    const { message } = await bodyOf<{ message: WireMessage }>(posted);

    await call('/api/participants/me', {
      method: 'PATCH',
      userId: member.userId,
      body: { event_id: created.eventId, display_name: 'Renamed' },
    });

    const listed = await call(`/api/events/${created.eventId}/messages`, {
      userId: member.userId,
    });

    const { messages } = await bodyOf<{ messages: WireMessage[] }>(listed);

    // The thread still says who spoke at the time.
    assert.equal(messages[0]?.sender_name, 'Original');
    assert.equal(messages[0]?.id, message.id);
  });

  test('two participants see each other’s messages, in order', async () => {
    const created = await createEventViaApi();
    const organizer = await joinAs(created.token, 'Organizer');
    const guest = await joinAs(created.token, 'Guest');

    await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: organizer.userId,
      body: { body: 'اول' },
    });

    await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: guest.userId,
      body: { body: 'دوم' },
    });

    const listed = await call(`/api/events/${created.eventId}/messages`, {
      userId: guest.userId,
    });

    const { messages } = await bodyOf<{ messages: WireMessage[] }>(listed);

    // Newest last: the order the thread renders in.
    assert.deepEqual(
      messages.map((entry) => entry.body),
      ['اول', 'دوم'],
    );
  });
});

describe('reporting a message', () => {
  test('a participant can file a report', async () => {
    const created = await createEventViaApi();
    const author = await joinAs(created.token, 'Author');
    const reporter = await joinAs(created.token, 'Reporter');

    const posted = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: author.userId,
      body: { body: 'پیام نامناسب' },
    });

    const { message } = await bodyOf<{ message: WireMessage }>(posted);

    const reported = await call(`/api/messages/${message.id}/report`, {
      method: 'POST',
      userId: reporter.userId,
      body: { reason: 'توهین' },
    });

    assert.equal(reported.status, 201);

    const stored = await asOwner<{ reason: string; reporter_id: string }>(
      `select reason, reporter_id from message_report where message_id = $1`,
      [message.id],
    );

    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0]?.reason, 'توهین');
    assert.equal(stored.rows[0]?.reporter_id, reporter.participantId);
  });

  test('the reason is optional — reporting never requires an explanation', async () => {
    const created = await createEventViaApi();
    const author = await joinAs(created.token, 'A');
    const reporter = await joinAs(created.token, 'B');

    const posted = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: author.userId,
      body: { body: 'متن' },
    });

    const { message } = await bodyOf<{ message: WireMessage }>(posted);

    const reported = await call(`/api/messages/${message.id}/report`, {
      method: 'POST',
      userId: reporter.userId,
      body: {},
    });

    assert.equal(reported.status, 201);
  });

  test('a non-participant cannot report a message', async () => {
    const created = await createEventViaApi();
    const author = await joinAs(created.token, 'Author');

    const posted = await call(`/api/events/${created.eventId}/messages`, {
      method: 'POST',
      userId: author.userId,
      body: { body: 'متن' },
    });

    const { message } = await bodyOf<{ message: WireMessage }>(posted);

    const outsider = await createEventViaApi();

    const reported = await call(`/api/messages/${message.id}/report`, {
      method: 'POST',
      userId: outsider.userId,
      body: { reason: 'x' },
    });

    assert.equal(reported.status, 403);
  });

  test('an unknown message id is indistinguishable from a forbidden one', async () => {
    const outsider = await createEventViaApi();

    const response = await call(
      `/api/messages/11111111-2222-3333-4444-555555555555/report`,
      { method: 'POST', userId: outsider.userId, body: { reason: 'x' } },
    );

    // Same answer either way: a report must not become an id-existence oracle.
    assert.equal(response.status, 403);
  });
});

describe('★ no message body reaches a log', () => {
  test('the redaction module strips a body in a logged payload', () => {
    // The mechanism the gate enforces, asserted at the value level: a payload
    // that accidentally carried the sentence cannot print it.
    const payload = { event_id: 'e-1', body: 'ساعت هفت جلوی رستوران' };
    const redacted = logSafeBody(payload);

    assert.equal(redacted.body, REDACTED);
    // The id is what a log may say about a message.
    assert.equal(redacted.event_id, 'e-1');
  });

  test('a coordinate pasted into a message is scrubbed as well', () => {
    // Two independent defences: the key rule above, and the value rule here for
    // a message that travels in a field not named `body`.
    const payload = logSafeBody({ excerpt: 'بیا اینجا 35.7000, 51.4000' });

    // The coordinate is removed and the prose around it survives — the point is
    // that the digits never reach the log, not that the line disappears.
    assert.equal(String(payload.excerpt).includes('35.7000'), false);
    assert.equal(String(payload.excerpt).includes('51.4000'), false);
    assert.ok(String(payload.excerpt).includes(REDACTED));
  });

  test('the messages module holds no direct console call', async () => {
    // A structural check, since the gate enforces it on the AST: this is the
    // cheaper statement of the same requirement, next to the behaviour.
    const source = await readModule('server/routes/messages.ts');

    assert.equal(/console\.(log|info|warn|error|debug)/.test(source), false);
  });
});

/** Applies `logSafe`'s redaction and returns the object, without printing. */
function logSafeBody(payload: Record<string, unknown>): Record<string, unknown> {
  // `logSafe` returns void by design; the redaction it performs is what this
  // asserts, so the payload is passed through the same module and read back.
  const captured: Record<string, unknown>[] = [];
  const original = console.log;

  console.log = (...args: unknown[]) => {
    if (args[1] && typeof args[1] === 'object') {
      captured.push(args[1] as Record<string, unknown>);
    }
  };

  try {
    logSafe('chat_test', payload);
  } finally {
    console.log = original;
  }

  return captured[0] ?? {};
}

async function readModule(relativePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const { PROJECT_ROOT } = await import('../../scripts/db/paths');
  return readFile(join(PROJECT_ROOT, relativePath), 'utf8');
}
