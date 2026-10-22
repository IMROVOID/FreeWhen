/**
 * The Decision Card's purity (Plan 07 Task 14, PRD-02 §13.5).
 *
 * ★ THIS SUITE HAS NO DATABASE, AND THAT IS THE POINT.
 *
 * "What did we decide?" must have exactly one answer, and the mechanism is that
 * the card is a PURE FUNCTION of the decision row plus its proposal. Anything
 * that needs a server to prove that property would be testing the server, not
 * the promise. The dual-session assertion over two real sessions lives in
 * `tests/db/decision-card.test.ts`; this one proves the property underneath it.
 *
 * ★ THE FAILURE MODE THESE TESTS CATCH.
 *
 * A per-user derived-state bug: a card assembled from "the ranking as this
 * viewer sees it", "the proposals ordered by my votes", or "the current time".
 * Every one of those passes a single-session test and breaks the promise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDecisionCard, sharedCardContent } from '@/src/features/voting/services/decision-card';
import type { WireDecision, WireParticipant } from '@/src/features/voting/services/voting-api';
import type { Proposal } from '@/src/types/proposal';

const PARTICIPANTS: WireParticipant[] = [
  { id: 'p1', display_name: 'Organizer', role: 'organizer' },
  { id: 'p2', display_name: 'Bahar', role: 'member' },
  { id: 'p3', display_name: 'Syrus', role: 'member' },
];

const DECISION: WireDecision = {
  id: 'd1',
  event_id: 'e1',
  axis: 'time',
  proposal_id: 'pr1',
  lens: 'balanced',
  reason_template: 'balanced_floor',
  reason_params: { floorMinutes: 18 },
  confirmed_by: 'p1',
  confirmed_at: '2026-08-01T10:00:00.000Z',
};

const PROPOSAL: Proposal = {
  id: 'pr1',
  event_id: 'e1',
  type: 'TIME_AND_PLACE',
  title: 'Friday at Cafe Didar',
  notes: null,
  link: null,
  status: 'CHOSEN',
  origin: 'manual',
  is_late: false,
  start_utc: '2026-08-02T15:30:00.000Z',
  end_utc: '2026-08-02T17:30:00.000Z',
  venue: {
    id: 'v1',
    name: 'Cafe Didar',
    lat: 35.7,
    lng: 51.4,
    address: 'Valiasr',
    provider_place_id: null,
    opening_hours: null,
  },
  proposer_id: 'p1',
  proposer_name: 'Organizer',
  created_at: '2026-07-30T10:00:00.000Z',
};

function cardFor(overrides: Partial<WireDecision> = {}) {
  return buildDecisionCard({
    decision: { ...DECISION, ...overrides },
    proposal: PROPOSAL,
    participants: PARTICIPANTS,
    homeTz: 'Asia/Tehran',
    locale: 'fa',
  });
}

test('byte-identical: the same row produces the same card every time', () => {
  // Arrange
  const first = cardFor();

  // Act
  const second = cardFor();

  // Assert
  assert.equal(sharedCardContent(first), sharedCardContent(second));
});

test('byte-identical: the attendees are the group, never the viewer', () => {
  // Arrange — the card is built with no notion of who is looking at it.
  const card = cardFor();

  // Act
  const content = sharedCardContent(card);

  // Assert
  for (const participant of PARTICIPANTS) {
    assert.ok(
      content.includes(participant.display_name),
      `${participant.display_name} is missing from the card everyone sees`,
    );
  }
});

test('byte-identical: the card never reads a clock', () => {
  // Arrange
  const before = cardFor();

  // Act — real time passes; nothing on the card may move.
  const after = cardFor();

  // Assert
  assert.equal(sharedCardContent(before), sharedCardContent(after));
  assert.equal(before.timeRange, after.timeRange);
});

test('the venue and instant come from the proposal, not from a ranking', () => {
  // Arrange — a different proposal with the same decision row.
  const other: Proposal = {
    ...PROPOSAL,
    id: 'pr2',
    title: 'Saturday somewhere else',
    start_utc: '2026-08-03T15:30:00.000Z',
    venue: PROPOSAL.venue ? { ...PROPOSAL.venue, name: 'Baghe Ketab' } : null,
  };

  // Act
  const card = buildDecisionCard({
    decision: DECISION,
    proposal: other,
    participants: PARTICIPANTS,
    homeTz: 'Asia/Tehran',
    locale: 'fa',
  });

  // Assert — the card describes the SUBJECT of the decision, which is the row's
  // proposal, and nothing else in the world.
  assert.equal(card.venueName, 'Baghe Ketab');
  assert.equal(card.startUtc, other.start_utc);
  assert.equal(card.decisionId, DECISION.id);
});

test('the reason stays a template, so it can be rendered in either language', () => {
  // Arrange
  const fa = cardFor();
  const en = buildDecisionCard({
    decision: DECISION,
    proposal: PROPOSAL,
    participants: PARTICIPANTS,
    homeTz: 'Asia/Tehran',
    locale: 'en',
  });

  // Act
  const faContent = sharedCardContent(fa);
  const enContent = sharedCardContent(en);

  // Assert — the template and params are identical; only the rendering differs.
  assert.deepEqual(fa.reason, en.reason);
  assert.deepEqual(fa.reason.params, { floorMinutes: 18 });

  // The digits are rendered, not stored: Persian in `fa`, Latin in `en`.
  assert.match(fa.datePrimary, /[۰-۹]/u);
  assert.doesNotMatch(en.datePrimary, /[۰-۹]/u);

  // The facts do not move with the language.
  assert.equal(fa.venueName, en.venueName);
  assert.equal(fa.startUtc, en.startUtc);
  assert.deepEqual(fa.attendees, en.attendees);
  assert.notEqual(faContent, enContent, 'the two locales rendered identically');
});

test('the time range is rendered in the event zone, not the device zone', () => {
  // Arrange — 15:30 UTC is 19:00 in Tehran (UTC+03:30).
  const card = cardFor();

  // Act
  const range = card.timeRange;

  // Assert
  assert.ok(range, 'no time range was rendered');
  assert.ok(range.includes('۱۹:۰۰'), `expected 19:00 in the range, got "${range}"`);
});

test('a decision whose proposal is gone still renders', () => {
  // Arrange — proposal_id is SET NULL when the proposer leaves (migration 008).
  const card = buildDecisionCard({
    decision: { ...DECISION, proposal_id: null },
    proposal: null,
    participants: PARTICIPANTS,
    homeTz: 'Asia/Tehran',
    locale: 'fa',
  });

  // Act
  const content = sharedCardContent(card);

  // Assert — the card is still a card; it simply has no subject to describe.
  assert.equal(card.venueName, '');
  assert.equal(card.startUtc, null);
  assert.equal(card.decisionId, DECISION.id);
  assert.ok(content.includes('Organizer'));
});

test('the viewer trip is additive and never part of the shared content', () => {
  // Arrange
  const card = cardFor();

  // Act — the shared content is what everyone sees; a trip is not in it.
  const shared = sharedCardContent(card);

  // Assert
  assert.ok(!shared.includes('trip'), 'the viewer trip leaked into the shared card');
  assert.ok(!shared.includes('"minutes":22'), 'a per-viewer number is in the shared card');
});
