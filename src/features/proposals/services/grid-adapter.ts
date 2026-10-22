/**
 * The grid ↔ proposal adapter (Plan 06 Task 11, FR-3.10).
 *
 * ★ THE AVAILABILITY GRID AND THE PROPOSAL LIST ARE TWO VIEWS OF ONE DATASET.
 *
 * There is no `availability` table and there must not be one. Painting
 * availability creates or updates a proposal; the grid renders proposals. If a
 * separate store ever appears, the two views answer "when can people meet?"
 * differently, and the user has no way to tell which one is lying.
 *
 * ★ THIS FILE EXISTS BEFORE THE GRID DOES, ON PURPOSE.
 *
 * Phase 14 builds the grid component. Writing the only legal conversion now
 * means the grid cannot be built against a second store by accident: the path
 * that already exists is the path of least resistance.
 *
 * Both functions are pure and total, and their round trip is a fixed point —
 * see `tests/proposals/grid-adapter.test.ts`.
 */

import type { Proposal } from '@/src/types/proposal';

/** One painted cell: an interval, and the proposal it came from. */
export interface GridCell {
  startUtc: string;
  endUtc: string;
  proposalId: string;
  /** Carried through so a re-derivation keeps the author. */
  proposerId: string;
  status: Proposal['status'];
}

/**
 * The cells a proposal set paints.
 *
 * Place-only proposals are excluded: they carry no interval, so there is nothing
 * to paint. Withdrawn proposals are excluded too — a withdrawn time released the
 * slot, and showing it as occupied would make the grid disagree with the list
 * that renders it struck through.
 */
export function proposalsToGrid(proposals: readonly Proposal[]): GridCell[] {
  return proposals
    .filter((proposal) => proposal.type !== 'PLACE')
    .filter((proposal) => proposal.status !== 'WITHDRAWN')
    .filter(
      (proposal): proposal is Proposal & { start_utc: string; end_utc: string } =>
        proposal.start_utc !== null && proposal.end_utc !== null,
    )
    .map((proposal) => ({
      startUtc: proposal.start_utc,
      endUtc: proposal.end_utc,
      proposalId: proposal.id,
      proposerId: proposal.proposer_id,
      status: proposal.status,
    }));
}

/**
 * The interval a grid cell stands for, as a proposal-shaped patch.
 *
 * This is what a painter writes back: it produces the `start_utc`/`end_utc`
 * pair an existing proposal is updated with, or the slot a new one is created
 * from. It never invents a row and never writes independently of the proposal
 * table.
 */
export function gridCellToSlot(cell: GridCell): { start_utc: string; end_utc: string } {
  return { start_utc: cell.startUtc, end_utc: cell.endUtc };
}

/**
 * Whether two proposals claim the same interval.
 *
 * FR-2.8's overlap *merging* is Phase 14 and is explicitly out of scope here.
 * This predicate exists only so a flag can be raised — the cell is kept, not
 * collapsed.
 */
export function intervalsOverlap(a: GridCell, b: GridCell): boolean {
  return new Date(a.startUtc) < new Date(b.endUtc) && new Date(b.startUtc) < new Date(a.endUtc);
}
