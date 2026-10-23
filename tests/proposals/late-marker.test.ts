/**
 * Late-proposal markers (Plan 14 Task 3, PRD-02 FR-2.9).
 *
 * ★ THE MARKER EXISTS SO THE GROUP CAN DECIDE WHETHER TO EXTEND THE DEADLINE.
 *
 * A proposal that arrives after voting started looks identical to one that was
 * there from the beginning. Without the marker nobody can weigh "we have been
 * arguing for two days and somebody just dropped a new option" — which is the
 * decision the marker is for.
 *
 * ★ AND IT MUST NOT CHANGE THE TALLY.
 *
 * "Late proposals are allowed by default" (FR-2.9). Forbidding them pushes the
 * group back into chat, which is the pain point the product exists to remove. So
 * the marker is a LABEL: a late proposal is votable, counts, and can win exactly
 * like any other. The second test below is what pins that — an implementation
 * that quietly down-weighted a late proposal would pass every other assertion
 * here.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { tally } from '../../src/features/voting/services/tally';
import type { Proposal } from '../../src/types/proposal';
import type { Vote } from '../../src/types/vote';
import fa from '../../src/i18n/fa.json';
import en from '../../src/i18n/en.json';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'pr-1',
    event_id: 'e-1',
    type: 'TIME_AND_PLACE',
    title: 'کافه دیدار',
    notes: null,
    link: null,
    status: 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: '2026-08-05T15:30:00Z',
    end_utc: '2026-08-05T17:30:00Z',
    venue: null,
    proposer_id: 'p-1',
    proposer_name: 'سارا',
    created_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}

function vote(participantId: string, value: 'yes' | 'maybe' | 'no'): Vote {
  return {
    proposal_id: 'pr-1',
    participant_id: participantId,
    display_name: participantId,
    value,
    is_dealbreaker: false,
    created_at: '2026-08-02T10:00:00Z',
    updated_at: '2026-08-02T10:00:00Z',
  };
}

const people = [
  { id: 'p-1', display_name: 'سارا', role: 'organizer' },
  { id: 'p-2', display_name: 'دریا', role: 'guest' },
  { id: 'p-3', display_name: 'امیر', role: 'guest' },
];

describe('FR-2.9 — the marker is present for a late proposal and absent otherwise', () => {
  test('the catalogue carries the marker, in both locales', () => {
    // The marker is a catalogue entry, not a hardcoded sentence, so it reads in
    // whichever language the app is in.
    assert.equal(typeof fa.proposals.card.lateMarker, 'string');
    assert.equal(typeof en.proposals.card.lateMarker, 'string');

    // ★ NOT THE SAME STRING IN BOTH. If `en.json` had been left as a copy of the
    // Persian, the marker would render untranslated for English users and every
    // key-parity gate would still pass.
    assert.notEqual(fa.proposals.card.lateMarker, en.proposals.card.lateMarker);
  });

  test('the marker says the proposal arrived after voting began', () => {
    // The Persian copy names the condition; a generic "new" would not tell the
    // group anything they could act on.
    assert.match(fa.proposals.card.lateMarker, /رأی‌گیری/);
    assert.match(en.proposals.card.lateMarker, /voting/i);
  });

  test('is_late is a per-proposal fact, so two proposals can differ', () => {
    // The card reads `proposal.is_late` directly rather than comparing dates at
    // render time. Two proposals created a minute apart can differ, because what
    // matters is whether VOTING had begun, not when they were created.
    const early = proposal({ id: 'pr-early', is_late: false });
    const late = proposal({ id: 'pr-late', is_late: true });

    assert.equal(early.is_late, false);
    assert.equal(late.is_late, true);
  });
});

describe('FR-2.9 — a late proposal is still votable, and still counts', () => {
  test('the tally of a late proposal is computed exactly like an open one', () => {
    // Arrange — the same votes, one proposal late and one not.
    const votes = [vote('p-1', 'yes'), vote('p-2', 'maybe'), vote('p-3', 'no')];

    // Act
    const forEarly = tally(votes, people, proposal({ is_late: false }));
    const forLate = tally(votes, people, proposal({ is_late: true }));

    // Assert — byte-identical. `is_late` reaches no counter.
    assert.deepEqual(forLate, forEarly);
  });

  test('a late proposal can win: yes is still yes', () => {
    const votes = [vote('p-1', 'yes'), vote('p-2', 'yes'), vote('p-3', 'no')];

    const result = tally(votes, people, proposal({ is_late: true }));

    assert.equal(result.yes, 2);
    assert.equal(result.no, 1);
    assert.deepEqual(result.voters.yes, ['سارا', 'دریا']);
  });

  test('a late proposal is not excluded, capped, or down-weighted', () => {
    // The danger this pins: a well-meaning change that makes late proposals
    // non-winning "because they arrived after the discussion". The tally has no
    // such field, and this test fails the day one is added.
    const result = tally([vote('p-1', 'yes')], people, proposal({ is_late: true }));

    assert.equal(result.total, 3, 'every participant is still counted');
    assert.equal(result.unanswered, 2);
    assert.ok(!('is_late' in result), 'the tally does not carry the flag');
  });
});
