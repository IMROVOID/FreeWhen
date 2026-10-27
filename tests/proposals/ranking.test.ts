/**
 * Proposal ranking and the shared vote bar (Plan 49 T13).
 *
 * ★ THE SPEC POINT THAT MATTERS.
 *
 * FR-2.4: "Proposals are listed in a stable order (creation time ascending).
 * Re-ordering by score happens only in the ranked view, AND THE LIST MUST STATE
 * THAT IT IS RANKED — otherwise users misread creation order as ranking."
 *
 * Re-ordering is explicitly provided for, so ranking is not a spec violation. The
 * mandatory part is the label, which is why this file pins both: the order AND the
 * presence of the declaration.
 *
 * ★ ONE 100% SHARED BETWEEN ALL PROPOSALS.
 *
 * The bar answers "how much of the group's attention did this proposal get?", so
 * the denominator is the SUM of every proposal's answers. Filling each bar against
 * its own participant count would make three options each look ~100% full.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  answersFor,
  rankProposals,
  shareOfAllAnswers,
  type RankableProposal,
} from '@/src/features/proposals/services/ranking';
import type { Tally } from '@/src/types/vote';

/** A tally with the given answers; `total` is the eligible-participant count. */
function tallyFor(yes: number, maybe = 0, no = 0, total = 10): Tally {
  return {
    yes,
    maybe,
    no,
    unanswered: Math.max(0, total - yes - maybe - no),
    total,
    voters: { yes: [], maybe: [], no: [] },
    outstanding: [],
  };
}

function proposal(id: string, createdAt: string, tally?: Tally, status?: string): RankableProposal {
  return { id, created_at: createdAt, tally, status };
}

test('the most-answered proposal comes first', () => {
  // Arrange
  const list = [
    proposal('a', '2026-01-01T00:00:00Z', tallyFor(1)),
    proposal('b', '2026-01-02T00:00:00Z', tallyFor(5)),
    proposal('c', '2026-01-03T00:00:00Z', tallyFor(3)),
  ];

  // Act
  const ranked = rankProposals(list);

  // Assert
  assert.deepEqual(ranked.map((entry) => entry.id), ['b', 'c', 'a']);
});

test('unanswered is never counted as an answer', () => {
  // ★ Counting `unanswered` as an answer would put a proposal nobody answered at
  // the top of the list, which is the opposite of what the bar communicates.
  assert.equal(answersFor(tallyFor(0, 0, 0, 8)), 0);
  assert.equal(answersFor(tallyFor(2, 1, 1)), 4);
  assert.equal(answersFor(null), 0);
});

test('a tie falls back to creation order, not to database order', () => {
  // Arrange — same answer count, supplied out of creation order.
  const list = [
    proposal('c', '2026-01-03T00:00:00Z', tallyFor(2)),
    proposal('a', '2026-01-01T00:00:00Z', tallyFor(2)),
    proposal('b', '2026-01-02T00:00:00Z', tallyFor(2)),
  ];

  // Act
  const ranked = rankProposals(list);

  // Assert — creation order is the order every participant already knows.
  assert.deepEqual(ranked.map((entry) => entry.id), ['a', 'b', 'c']);
});

test('ranking is deterministic for identical timestamps', () => {
  // Arrange
  const at = '2026-01-01T00:00:00Z';
  const list = [proposal('z', at, tallyFor(1)), proposal('a', at, tallyFor(1))];

  // Act
  const first = rankProposals(list).map((entry) => entry.id);
  const second = rankProposals([...list].reverse()).map((entry) => entry.id);

  // Assert — the input order must not decide the output.
  assert.deepEqual(first, second);
});

test('a withdrawn proposal sinks below every live one', () => {
  // Arrange — the withdrawn one has the most votes.
  const list = [
    proposal('gone', '2026-01-01T00:00:00Z', tallyFor(9), 'WITHDRAWN'),
    proposal('live', '2026-01-02T00:00:00Z', tallyFor(1)),
  ];

  // Act
  const ranked = rankProposals(list);

  // Assert — a withdrawn option is not a candidate, however people voted.
  assert.deepEqual(ranked.map((entry) => entry.id), ['live', 'gone']);
});

test('the shares of all proposals sum to one, not to one per proposal', () => {
  // ★ THE BUG THIS LOCKS OUT.
  //
  // Filling each bar against its own participant count makes three options each
  // look nearly full. The denominations here are the same for every bar, so the
  // shares are comparable and sum to 100%.
  const list = [
    proposal('a', '2026-01-01T00:00:00Z', tallyFor(4)),
    proposal('b', '2026-01-02T00:00:00Z', tallyFor(2)),
    proposal('c', '2026-01-03T00:00:00Z', tallyFor(2)),
  ];

  // Act
  const shares = list.map((entry) => shareOfAllAnswers(entry, list));

  // Assert — 8 answers in total: 4/8, 2/8, 2/8.
  assert.deepEqual(shares, [0.5, 0.25, 0.25]);
  assert.equal(shares.reduce((sum, value) => sum + value, 0), 1);
});

test('a share is zero when nothing has been answered anywhere', () => {
  // Arrange
  const list = [proposal('a', '2026-01-01T00:00:00Z', tallyFor(0)), proposal('b', '2026-01-02T00:00:00Z', tallyFor(0))];

  // Act / Assert — an empty bar, not a full one.
  assert.equal(shareOfAllAnswers(list[0]!, list), 0);
});

test('the list declares that it is ranked (FR-2.4)', () => {
  // Arrange
  const screen = readFileSync('app/event/[id]/index.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act / Assert — the spec's obligation on a re-ordered list.
  assert.ok(
    /rankedLabel|ranked\.label|proposals\.ranked/.test(screen),
    'the proposal list is re-ordered but does not state that it is ranked',
  );
});

test('the total-votes pill is not replaced by the share bar', () => {
  // Arrange
  const screen = readFileSync('app/event/[id]/index.tsx', 'utf8');

  // Act / Assert — ★ BOTH ARE KEPT.
  //
  // `TallyBar` answers "how many of the group answered THIS proposal"; the share
  // bar answers "what fraction of all answers are this proposal's". Removing the
  // pill to make room for the bar would have hidden "3 of 8 have answered".
  assert.ok(/TallyBar/.test(screen), 'the total-votes pill was removed');
});
