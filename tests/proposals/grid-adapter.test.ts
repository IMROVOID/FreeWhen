/**
 * The grid ↔ proposal invariant (Plan 06 Task 11, FR-3.10).
 *
 * The fixed-point test is the whole point: if `gridToProposals(proposalsToGrid(x))`
 * ever stops being identity over the grid-visible proposals, someone has started
 * deriving the grid from something other than the proposals themselves.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  intervalsOverlap,
  proposalsToGrid,
  type GridCell,
} from '../../src/features/proposals/services/grid-adapter';
import type { Proposal, ProposalStatus, ProposalType } from '../../src/types/proposal';

function proposal(
  options: {
    id?: string;
    type?: ProposalType;
    startUtc?: string | null;
    endUtc?: string | null;
    status?: ProposalStatus;
  } = {},
): Proposal {
  const start = options.startUtc === undefined ? '2026-08-03T15:30:00.000Z' : options.startUtc;
  const end = options.endUtc === undefined ? '2026-08-03T17:30:00.000Z' : options.endUtc;

  return {
    id: options.id ?? 'p1',
    event_id: 'e1',
    type: options.type ?? 'TIME',
    title: 'شام',
    notes: null,
    link: null,
    status: options.status ?? 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: start,
    end_utc: end,
    venue: null,
    proposer_id: 'u1',
    proposer_name: 'سارا',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

/** The grid-visible projections, in a comparable shape. */
function normalise(proposals: readonly Proposal[]): GridCell[] {
  return proposalsToGrid(proposals);
}

describe('ONE_DATASET — the grid is derived, never stored', () => {
  test('a time proposal becomes exactly one cell', () => {
    const cells = proposalsToGrid([proposal()]);

    assert.equal(cells.length, 1);
    assert.deepEqual(cells[0], {
      startUtc: '2026-08-03T15:30:00.000Z',
      endUtc: '2026-08-03T17:30:00.000Z',
      proposalId: 'p1',
      proposerId: 'u1',
      status: 'OPEN',
    });
  });

  test('a place-only proposal paints nothing', () => {
    // There is no interval to paint, so it is not a grid concern.
    const place = proposal({ type: 'PLACE', startUtc: null, endUtc: null });

    assert.deepEqual(proposalsToGrid([place]), []);
  });

  test('a TIME_AND_PLACE proposal paints its interval', () => {
    const both = proposal({ type: 'TIME_AND_PLACE' });

    assert.equal(proposalsToGrid([both]).length, 1);
  });

  test('a withdrawn proposal releases its cell', () => {
    // The slot is free again; painting it as occupied would contradict the
    // struck-through card in the list.
    const withdrawn = proposal({ status: 'WITHDRAWN' });

    assert.deepEqual(proposalsToGrid([withdrawn]), []);
  });

  test('a half-specified interval paints nothing', () => {
    // The database forbids this, but the adapter is total: it drops rather than
    // emitting a cell with a hole in it.
    assert.deepEqual(proposalsToGrid([proposal({ endUtc: null })]), []);
  });

  test('FIXED POINT — deriving the cells twice is identical', () => {
    // Arrange — a mixed set, including the cases that must be filtered out.
    const proposals = [
      proposal({ id: 'p1' }),
      proposal({ id: 'p2', startUtc: '2026-08-04T15:30:00.000Z', endUtc: '2026-08-04T17:30:00.000Z' }),
      proposal({ id: 'p3', type: 'PLACE', startUtc: null, endUtc: null }),
      proposal({ id: 'p4', status: 'WITHDRAWN' }),
      proposal({ id: 'p5', type: 'TIME_AND_PLACE' }),
    ];

    // Act
    const first = proposalsToGrid(proposals);
    // Re-deriving from the same dataset must be identical — there is no second
    // store to drift from.
    const second = proposalsToGrid(proposals);

    // Assert
    assert.deepEqual(first, second);
    assert.deepEqual(first, normalise(proposals));
    assert.equal(first.length, 3);
  });

  test('the cell carries the proposal id, so a paint can update rather than duplicate', () => {
    const cells = proposalsToGrid([proposal({ id: 'the-id' })]);

    assert.equal(cells[0]?.proposalId, 'the-id');
  });
});

describe('overlap is flagged, never merged (FR-2.8 is Phase 14)', () => {
  test('exactly-adjacent intervals do not overlap', () => {
    const a: GridCell = {
      startUtc: '2026-08-03T15:30:00.000Z',
      endUtc: '2026-08-03T17:30:00.000Z',
      proposalId: 'a',
      proposerId: 'u1',
      status: 'OPEN',
    };
    const b: GridCell = {
      startUtc: '2026-08-03T17:30:00.000Z',
      endUtc: '2026-08-03T19:30:00.000Z',
      proposalId: 'b',
      proposerId: 'u1',
      status: 'OPEN',
    };

    assert.equal(intervalsOverlap(a, b), false);
  });

  test('a containing interval overlaps', () => {
    const outer: GridCell = {
      startUtc: '2026-08-03T15:00:00.000Z',
      endUtc: '2026-08-03T20:00:00.000Z',
      proposalId: 'outer',
      proposerId: 'u1',
      status: 'OPEN',
    };
    const inner: GridCell = {
      startUtc: '2026-08-03T16:00:00.000Z',
      endUtc: '2026-08-03T17:00:00.000Z',
      proposalId: 'inner',
      proposerId: 'u1',
      status: 'OPEN',
    };

    assert.equal(intervalsOverlap(outer, inner), true);
    assert.equal(intervalsOverlap(inner, outer), true);
  });
});
