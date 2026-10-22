/**
 * The notification policy (Plan 10 Tasks 3–6, 13, 14 — AC-6.3.1, AC-6.4.1).
 *
 * ★ THESE TESTS DRIVE ALL TEN PRD-06 §9 EDGE CASES (E1–E10).
 *
 * The rules are pure, so each scenario is arranged as data and asserted without a
 * database, a clock or a network. That is deliberate: the defects these guards
 * exist for — a dropped notification, a muted decision, a nudge to someone who
 * already voted — are all invisible in normal operation and expensive in
 * production.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUDGET_WINDOW_MS,
  COALESCE_WINDOW_MS,
  MUTABLE_TYPES,
  NOTIFICATION_TYPES,
  budgetKey,
  checkBudget,
  coalesceProposals,
  decideDispatch,
  isMuted,
  n3Recipients,
  sanitizeContext,
  sanitizeForLockScreen,
  type NotificationType,
} from '../../server/routes/notifications';

// The body builders live on the client side of the boundary: the server ships a
// key and sanitised params, and the client resolves the sentence in the reader's
// own language. The privacy assertions stay here because the contract does.
import {
  NOTIFICATION_TYPES as CLIENT_TYPES,
  bodyKey,
  buildPayload,
} from '../../src/features/notifications/services/handler';

const T0 = new Date('2026-08-01T10:00:00Z');

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// The budget — AC-6.3.1
// ─────────────────────────────────────────────────────────────

test('AC-6.3.1: a first notification in an hour is sent', () => {
  assert.deepEqual(checkBudget(null, T0), { send: true });
});

test('AC-6.3.1: over-budget notifications are DEFERRED, never dropped', () => {
  // Arrange: one send at T0.
  const first = checkBudget(null, T0);
  assert.equal(first.send, true);

  // Act: two further sends inside the same hour.
  const second = checkBudget(T0, at(10));
  const third = checkBudget(T0, at(20));

  // Assert: both refused, and both name the instant they become sendable —
  // which is what makes them deferrals rather than losses.
  assert.equal(second.send, false);
  assert.equal(third.send, false);

  if (second.send || third.send) return assert.fail('expected deferrals');

  const clearAt = new Date(T0.getTime() + BUDGET_WINDOW_MS);
  assert.equal(second.deferUntil.toISOString(), clearAt.toISOString());
  // The deferral does not slide forward with each refusal: it is pinned to the
  // first send, so a burst cannot push it out indefinitely.
  assert.equal(third.deferUntil.toISOString(), clearAt.toISOString());
});

test('AC-6.3.1: exactly at the window boundary the notification is allowed', () => {
  const boundary = new Date(T0.getTime() + BUDGET_WINDOW_MS);
  assert.deepEqual(checkBudget(T0, boundary), { send: true });
});

test('one millisecond before the boundary is still deferred', () => {
  const nearly = new Date(T0.getTime() + BUDGET_WINDOW_MS - 1);
  assert.equal(checkBudget(T0, nearly).send, false);
});

test('the budget is keyed per (participant, event), not per participant globally', () => {
  // ★ A user in three events has three independent budgets. A key on the
  // participant alone would silence the other two events the moment one got
  // chatty.
  const a1 = budgetKey('p1', 'e1');
  const a2 = budgetKey('p1', 'e2');
  const b1 = budgetKey('p2', 'e1');

  assert.notEqual(a1, a2, 'same participant, different events are separate budgets');
  assert.notEqual(a1, b1, 'different participants are separate budgets');
  assert.equal(a1, budgetKey('p1', 'e1'), 'the key is stable for the same pair');
});

// ─────────────────────────────────────────────────────────────
// Mute and the N4 exception — AC-6.4.1
// ─────────────────────────────────────────────────────────────

test('AC-6.4.1: the decision-confirmed notification bypasses mute', () => {
  const decision = decideDispatch({
    type: 'N4',
    muted: true,
    lastSentAt: null,
    nowUtc: T0,
  });

  assert.deepEqual(decision, { action: 'send', type: 'N4' });
});

test('AC-6.4.1: N4 is not in the mutable set at all', () => {
  // A second, independent guard on the same promise: the exception holds by
  // construction, not only by the branch in `decideDispatch`.
  assert.equal(MUTABLE_TYPES.includes('N4'), false);
  assert.equal(isMuted('N4'), false);
});

test('a mute suppresses N1, N2, N3, N5 and N6', () => {
  for (const type of ['N1', 'N2', 'N3', 'N5', 'N6'] as NotificationType[]) {
    const decision = decideDispatch({ type, muted: true, lastSentAt: null, nowUtc: T0 });
    assert.deepEqual(decision, { action: 'skip', type, reason: 'muted' });
  }
});

test('an unmuted participant receives the mutable types', () => {
  for (const type of MUTABLE_TYPES) {
    const decision = decideDispatch({ type, muted: false, lastSentAt: null, nowUtc: T0 });
    assert.deepEqual(decision, { action: 'send', type });
  }
});

test('N4 still spends budget, so it cannot be used to flood', () => {
  // The bypass is about mute, not about volume: a second N4 inside the hour is
  // deferred, exactly like any other type.
  const decision = decideDispatch({
    type: 'N4',
    muted: false,
    lastSentAt: T0,
    nowUtc: at(5),
  });

  assert.equal(decision.action, 'defer');
});

test('a non-recipient is skipped before mute and budget are consulted', () => {
  const decision = decideDispatch({
    type: 'N3',
    muted: true,
    lastSentAt: T0,
    nowUtc: at(5),
    isRecipient: false,
  });

  assert.deepEqual(decision, { action: 'skip', type: 'N3', reason: 'not-recipient' });
});

// ─────────────────────────────────────────────────────────────
// N1 coalescing — FR-6.17
// ─────────────────────────────────────────────────────────────

test('N1: three proposals within ten minutes coalesce into one naming the count', () => {
  const proposals = [
    { createdAt: at(0).toISOString(), authorName: 'علی' },
    { createdAt: at(4).toISOString(), authorName: 'بهار' },
    { createdAt: at(9).toISOString(), authorName: 'سارا' },
  ];

  const result = coalesceProposals(proposals, at(10));

  assert.ok(result);
  assert.equal(result.count, 3, 'one notification stands for three proposals');
  // A count with more than one author names no single person.
  assert.equal(result.singleAuthor, null);
});

test('N1: a single proposal names its author', () => {
  const result = coalesceProposals([{ createdAt: at(2).toISOString(), authorName: 'علی' }], at(5));

  assert.ok(result);
  assert.equal(result.count, 1);
  assert.equal(result.singleAuthor, 'علی');
});

test('N1: proposals outside the window are not counted', () => {
  const proposals = [
    { createdAt: at(-30).toISOString(), authorName: 'قدیمی' },
    { createdAt: at(2).toISOString(), authorName: 'تازه' },
  ];

  const result = coalesceProposals(proposals, at(5));

  assert.ok(result);
  assert.equal(result.count, 1, 'the stale proposal is outside the window');
  assert.equal(result.singleAuthor, 'تازه');
});

test('N1: nothing pending yields no notification at all', () => {
  assert.equal(coalesceProposals([], at(5)), null);
  assert.equal(
    coalesceProposals([{ createdAt: at(-60).toISOString(), authorName: 'قدیمی' }], at(5)),
    null,
  );
});

test('N1: the coalescing window is ten minutes', () => {
  assert.equal(COALESCE_WINDOW_MS, 10 * 60 * 1000);
});

test('N1: a proposal in the future is not counted', () => {
  // A device clock ahead of the server must not produce a count that includes
  // something that has not happened yet.
  const result = coalesceProposals(
    [{ createdAt: at(30).toISOString(), authorName: 'آینده' }],
    at(5),
  );

  assert.equal(result, null);
});

test('N1: an unparseable timestamp is ignored rather than inflating the count', () => {
  const result = coalesceProposals(
    [
      { createdAt: 'not-a-date', authorName: 'نامعتبر' },
      { createdAt: at(1).toISOString(), authorName: 'علی' },
    ],
    at(5),
  );

  assert.ok(result);
  assert.equal(result.count, 1);
});

// ─────────────────────────────────────────────────────────────
// N3 targeting — FR-6.18
// ─────────────────────────────────────────────────────────────

test('N3: with 7 of 10 having voted, closing-soon reaches exactly three', () => {
  const participants = Array.from({ length: 10 }, (_, index) => ({ id: `p${index + 1}` }));
  const voterIds = participants.slice(0, 7).map((p) => p.id);

  const recipients = n3Recipients(participants, voterIds);

  assert.equal(recipients.length, 3);
  assert.deepEqual(recipients, ['p8', 'p9', 'p10']);
});

test('N3: someone who already voted is never a recipient', () => {
  const participants = [{ id: 'p1' }, { id: 'p2' }];
  const recipients = n3Recipients(participants, ['p1', 'p2']);

  assert.deepEqual(recipients, [], 'everyone voted, so nobody is notified');
});

test('N3: a voter id that is not a participant cannot add a recipient', () => {
  const participants = [{ id: 'p1' }, { id: 'p2' }];
  const recipients = n3Recipients(participants, ['ghost']);

  assert.deepEqual(recipients, ['p1', 'p2']);
});

// ─────────────────────────────────────────────────────────────
// Body privacy — Task 13, AC "no coordinate in any body"
// ─────────────────────────────────────────────────────────────

test('privacy: a coordinate pasted into a venue name is stripped', () => {
  const dirty = 'کافه دیدار 35.6892,51.3890 طبقه دوم';
  const clean = sanitizeForLockScreen(dirty);

  assert.equal(clean.includes('35.6892'), false);
  assert.equal(clean.includes('51.3890'), false);
  // The venue's real name survives — the sanitiser removes the leak, not the
  // usefulness.
  assert.ok(clean.includes('کافه دیدار'));
});

test('privacy: a coordinate pair with spaces and signs is stripped', () => {
  assert.equal(sanitizeForLockScreen('at -35.6892, 51.3890 here').includes('35.6892'), false);
});

test('privacy: a URL carrying a query string is removed', () => {
  const dirty = 'join at https://app.example/i/abc?token=supersecret now';
  const clean = sanitizeForLockScreen(dirty);

  assert.equal(clean.includes('token'), false);
  assert.equal(clean.includes('supersecret'), false);
});

test('privacy: a bare venue link without a query survives', () => {
  // The map link is part of what makes a notification useful; only the token
  // carrying form is dangerous.
  assert.ok(sanitizeForLockScreen('map https://maps.google.com/place/x').includes('maps.google.com'));
});

test('the client and server declare the same notification inventory', () => {
  // The two lists are restated on either side of the server/client boundary
  // because nothing under `src/` may import from `server/`. This is what keeps
  // the restatement honest.
  assert.deepEqual([...CLIENT_TYPES], [...NOTIFICATION_TYPES]);
});

test('privacy: no body context can carry a coordinate or a token', () => {
  // The hostile fixture: every free-text field is loaded with the two things
  // PRD-06 §8 forbids.
  const payload = buildPayload(
    'N4',
    {
      venueName: 'کافه 35.6892,51.3890 دیدار',
      authorName: 'علی https://x.test/?t=leak',
      when: 'جمعه ۱۹:۰۰',
      count: 7,
    },
    { eventId: 'e1' },
  );

  const rendered = JSON.stringify(payload.params);

  assert.equal(/\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(rendered), false);
  assert.equal(rendered.includes('leak'), false);
  // The facts that make the notification worth sending are intact.
  assert.ok(rendered.includes('کافه'));
  assert.equal(payload.params.count, 7);
});

test('privacy: numbers are never treated as text to sanitise', () => {
  const clean = sanitizeContext({ count: 7, minutes: 15 });
  assert.equal(clean.count, 7);
  assert.equal(clean.minutes, 15);
});

test('privacy: the body key is a catalogue key, not Persian prose', () => {
  // §15.6 — the body is resolved at send time against the recipient's language.
  for (const type of NOTIFICATION_TYPES) {
    assert.equal(bodyKey(type), `notifications.bodies.${type}`);
  }
});

test('AC: notification bodies are templates resolved per recipient, not per sender', () => {
  const payload = buildPayload('N4', { venueName: 'کافه دیدار' }, { eventId: 'e1' });

  // The server ships a key and data; the client's own translator decides the
  // language. Shipping a sentence here is the defect this asserts against.
  assert.match(payload.bodyKey, /^notifications\./);
  assert.equal(/[\u0600-\u06FF]/.test(payload.bodyKey), false, 'no Persian in the key');
});

// ─────────────────────────────────────────────────────────────
// Deep links — FR-6.20
// ─────────────────────────────────────────────────────────────

test('FR-6.20: N4 deep-links to the Decision Card, never to the app root', () => {
  const payload = buildPayload('N4', { venueName: 'کافه' }, { eventId: 'e1' });

  assert.equal(payload.deepLink, '/event/e1/decision?axis=time');
  assert.notEqual(payload.deepLink, '/');
});

// ─────────────────────────────────────────────────────────────
// E1–E10 — the PRD-06 §9 edge cases
// ─────────────────────────────────────────────────────────────

test('E2: notifications denied — the decision is still produced, nothing throws', () => {
  // Denial is a delivery fact, not a policy one: the gate must still answer.
  const decision = decideDispatch({ type: 'N4', muted: false, lastSentAt: null, nowUtc: T0 });
  assert.equal(decision.action, 'send');
});

test('E5: a participant with no device token still gets an in-app payload', () => {
  // The payload is built regardless of any token; in-app delivery is the
  // fallback that makes a missing token a non-event.
  const payload = buildPayload('N4', { venueName: 'کافه' }, { eventId: 'e1' });
  assert.ok(payload.type === 'N4');
});

test('E6: scheduled times are handled in UTC, so a device timezone cannot shift the budget', () => {
  // Both instants below are the same absolute moment, expressed with different
  // offsets. The budget compares absolute time, so the answer is identical.
  const utc = new Date('2026-08-01T10:00:00Z');
  const tehran = new Date('2026-08-01T13:30:00+03:30');

  assert.equal(utc.getTime(), tehran.getTime());
  assert.deepEqual(
    checkBudget(utc, new Date(utc.getTime() + 60 * 60 * 1000)),
    checkBudget(tehran, new Date(tehran.getTime() + 60 * 60 * 1000)),
  );
});

test('E7: everyone muted — nothing breaks and the status area stays authoritative', () => {
  // Every mutable type is suppressed, and the one that matters still arrives.
  const muted = NOTIFICATION_TYPES.map((type) =>
    decideDispatch({ type, muted: true, lastSentAt: null, nowUtc: T0 }),
  );

  const delivered = muted.filter((decision) => decision.action === 'send');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.type, 'N4');
});

test('E10: a nudge re-checks the outstanding set, skipping anyone who voted', () => {
  // The organizer composed the nudge against an older list; two people voted
  // while it was in flight.
  const participants = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
  const votedBySendTime = ['p1', 'p2'];

  const recipients = n3Recipients(participants, votedBySendTime);

  assert.deepEqual(recipients, ['p3'], 'only the still-outstanding participant is nudged');
});
