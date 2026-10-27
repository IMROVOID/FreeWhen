/**
 * Ranking proposals by votes, and the shared vote bar (Plan 49 T13).
 *
 * ★ THIS IS A RANKED VIEW, AND FR-2.4 REQUIRES SAYING SO.
 *
 * The spec reads: "Proposals are listed in a stable order (creation time
 * ascending). Re-ordering by score happens only in the ranked view, and the list
 * must state that it is ranked — otherwise users misread creation order as
 * ranking." So re-ordering is provided for; the obligation it places on the caller
 * is the label. `RANKED_VIEW` is that obligation, exported here so the screen and
 * its test cannot treat it as optional prose.
 *
 * ★ ONE 100% SHARED BETWEEN ALL PROPOSALS.
 *
 * The requested bar answers "how much of the group's attention did this proposal
 * get?", so the denominators are SUM(tallies of every proposal), not the
 * per-proposal participant count. Filling each bar against its own total would
 * make three proposals each look ~100% full and communicate nothing.
 *
 * ★ THE TOTAL VOTES PILL IS A DIFFERENT NUMBER AND STAYS.
 *
 * `TallyBar` shows how many of the group's participants answered THIS proposal
 * (x of y people). The share bar shows what fraction of all recorded answers
 * belong to this proposal. Both are useful, they are not substitutes, and
 * replacing the pill with the bar would have hidden "3 of 8 have answered".
 */

import type { Tally } from '@/src/types/vote';

/** The label FR-2.4 requires on a re-ordered list. */
export const RANKED_VIEW = true;

export interface RankableProposal {
  id: string;
  created_at: string;
  tally?: Tally | null;
  status?: string;
}

/** How many answers a proposal has received: yes + maybe + no, never unanswered. */
export function answersFor(tally: Tally | null | undefined): number {
  if (!tally) return 0;
  return tally.yes + tally.maybe + tally.no;
}

/**
 * The fraction of all answers that this proposal's answers represent.
 *
 * Returns `0` when nothing has been answered anywhere, which renders as an empty
 * bar rather than a full one — an un-answered list is not "100% proposal A".
 */
export function shareOfAllAnswers(proposal: RankableProposal, all: ReadonlyArray<RankableProposal>): number {
  const total = all.reduce((sum, entry) => sum + answersFor(entry.tally), 0);
  if (total === 0) return 0;

  return answersFor(proposal.tally) / total;
}

/**
 * Proposals, highest-voted first.
 *
 * Ties fall back to creation order — the order every participant already knows
 * (FR-2.4) — rather than to whatever order the database returned, so two equally
 * voted options do not swap places on every poll. The id is the final tiebreak,
 * which makes the result deterministic even for identical timestamps.
 *
 * A withdrawn proposal sinks below every live one regardless of its vote history:
 * the votes stay in the record (they are never deleted) but a withdrawn option is
 * not a candidate.
 */
export function rankProposals<T extends RankableProposal>(proposals: ReadonlyArray<T>): T[] {
  return [...proposals].sort((a, b) => {
    const withdrawnA = a.status === 'WITHDRAWN' ? 1 : 0;
    const withdrawnB = b.status === 'WITHDRAWN' ? 1 : 0;
    if (withdrawnA !== withdrawnB) return withdrawnA - withdrawnB;

    const answersA = answersFor(a.tally);
    const answersB = answersFor(b.tally);
    if (answersA !== answersB) return answersB - answersA;

    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
