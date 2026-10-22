/**
 * The tally and the derived proposal status (Plan 07 Tasks 1, 12).
 *
 * ★ UNANSWERED IS NOT A "NO" (PRD-02 §13.2).
 *
 * This is the single most likely logic bug in the app, and it is destructive
 * quietly: counting unanswered as "no" makes three votes from five people read
 * as unanimous rejection, so the group abandons an option nobody actually
 * opposed. `unanswered` is therefore its own field with its own name, and no
 * function here ever adds it to `no`.
 *
 * ★ `LEADING` AND `ELIMINATED` ARE DERIVED PER RENDER, NEVER STORED (§3.1).
 *
 * Storing them makes the label and the tally two sources of truth for the same
 * question. They diverge the first time a vote changes, and the label is on
 * screen while the tally is the truth.
 *
 * ★ THIS MODULE IS PURE.
 *
 * No clock, no fetch, no React. That is what lets the identical function run on
 * the server (for the confirmation's chosen proposal) and in the tests.
 */

import type { Exclusion, RankedVenue } from '@/src/engine/types';
import type {
  DerivedProposalStatus,
  Tally,
  Vote,
} from '@/src/types/vote';
import { TALLY_STATUSES } from '@/src/types/vote';

/** The minimum needed from a participant to count them. */
export interface TallyParticipant {
  id: string;
  display_name: string;
}

/** The minimum needed from a proposal to decide whether it is tallied. */
export interface TallyProposal {
  id: string;
  status: string;
}

/**
 * Counts the votes on one proposal against the participants eligible to vote.
 *
 * ★ A WITHDRAWN PROPOSAL IS NOT TALLIED, BUT ITS VOTES STAY IN HISTORY.
 *
 * The votes are not deleted — a withdrawn proposal that comes back must not
 * have lost what people said about it — so this function filters them out
 * rather than the caller omitting them, and the filter is stated once.
 *
 * A vote from somebody who has since left is ignored: they are not in
 * `participants`, so they are not in any count. The row survives the cascade
 * only for audit, never for arithmetic.
 */
export function tally(
  votes: ReadonlyArray<Pick<Vote, 'participant_id' | 'value' | 'display_name'>>,
  participants: ReadonlyArray<TallyParticipant>,
  proposal?: TallyProposal,
): Tally {
  // A withdrawn proposal contributes nothing to a live tally.
  if (proposal && !(TALLY_STATUSES as readonly string[]).includes(proposal.status)) {
    return {
      yes: 0,
      maybe: 0,
      no: 0,
      unanswered: 0,
      total: participants.length,
      voters: { yes: [], maybe: [], no: [] },
      outstanding: [],
    };
  }

  const eligible = new Map(participants.map((p) => [p.id, p.display_name]));

  const voters: Tally['voters'] = { yes: [], maybe: [], no: [] };
  let yes = 0;
  let maybe = 0;
  let no = 0;

  // ★ PARTICIPANT ORDER, NOT VOTE ORDER.
  //
  // The names are rendered in a stable order under a live tally, and vote
  // rows arrive in whatever order the database returned them. Sorting by the
  // participant list keeps the name row from reshuffling on every refresh.
  for (const participant of participants) {
    const vote = votes.find((v) => v.participant_id === participant.id);
    if (!vote) continue;

    const displayName = eligible.get(participant.id) ?? vote.display_name;

    if (vote.value === 'yes') {
      yes += 1;
      voters.yes.push(displayName);
    } else if (vote.value === 'maybe') {
      maybe += 1;
      voters.maybe.push(displayName);
    } else {
      no += 1;
      voters.no.push(displayName);
    }
  }

  // Everyone eligible with no vote row. NOT dissent — silence.
  const outstanding = participants
    .filter((p) => !votes.some((v) => v.participant_id === p.id))
    .map((p) => p.display_name);

  return {
    yes,
    maybe,
    no,
    unanswered: outstanding.length,
    total: participants.length,
    voters,
    outstanding,
  };
}

/**
 * Whether every eligible participant has answered.
 *
 * Used to decide whether the confirmation's warning has anything to say, and
 * nothing else: a fully-answered event does NOT auto-confirm (PRD-02 §6).
 */
export function isFullyAnswered(t: Tally): boolean {
  return t.total > 0 && t.unanswered === 0;
}

/**
 * Whether every answer is "no" — the state that needs a way forward.
 *
 * ★ E3 IS A FIRST-CLASS STATE, NOT AN EMPTY LIST (PRD-02 §7 E3).
 *
 * When the group has rejected everything on the table, the honest answer is a
 * prompt to add an option or relax a constraint. An empty panel reads as a bug
 * and gives nobody anything to do.
 */
export function isRejectedByEveryone(t: Tally): boolean {
  return t.no > 0 && t.yes === 0 && t.maybe === 0;
}

/** The input `deriveStatus` needs from the engine, kept minimal on purpose. */
export interface DeriveStatusInput {
  proposal: TallyProposal & { venueId: string | null };
  /** The engine's ranked venues, best first. `null` when unranked. */
  ranking: ReadonlyArray<Pick<RankedVenue, 'venueId'>> | null;
  /** The engine's exclusions. Empty when nothing was excluded. */
  excluded: ReadonlyArray<Pick<Exclusion, 'venueId'>>;
}

/**
 * The proposal's place in the decision — DERIVED, per render (§3.1).
 *
 * Order matters and is deliberate:
 *
 *  1. A closed lifecycle state wins. `CHOSEN` and `WITHDRAWN` are facts.
 *  2. An exclusion wins over leadership. A venue the engine removed cannot be
 *     leading, even if it is first in a stale ranking.
 *  3. Leadership is the engine's first-ranked venue, not the most "yes" votes:
 *     the ranking is what accounts for travel and constraints, and a vote
 *     count alone would hand the decision to whichever option was proposed
 *     first.
 *
 * The function returns `OPEN` rather than "not leading" because being on the
 * list and being the leader are different, and the UI says so.
 */
export function deriveStatus({
  proposal,
  ranking,
  excluded,
}: DeriveStatusInput): DerivedProposalStatus {
  if (proposal.status !== 'OPEN') return 'CLOSED';

  if (proposal.venueId !== null && excluded.some((e) => e.venueId === proposal.venueId)) {
    return 'ELIMINATED';
  }

  const leader = ranking?.[0]?.venueId;
  if (leader !== undefined && leader === proposal.venueId) return 'LEADING';

  return 'OPEN';
}

/**
 * The leader among a set of proposals, by the engine's ranking.
 *
 * ★ TIES RESOLVE TO THE EARLIER PROPOSAL, STABLY (AC-2.4.1).
 *
 * The ranking is the engine's; this only settles a tie the engine may present
 * in either order. Creation order is the tiebreak because it is the one order
 * every participant already knows — the list is shown in it (FR-2.4) — so the
 * winner is explicable rather than arbitrary.
 */
export function leadingProposal<T extends { id: string; created_at: string }>(
  proposals: ReadonlyArray<T>,
  ranking: ReadonlyArray<Pick<RankedVenue, 'venueId'>> | null,
  proposalVenue: (proposal: T) => string | null,
): T | null {
  const open = proposals.filter((p) => (p as { status?: string }).status !== 'WITHDRAWN');
  if (open.length === 0) return null;

  const byCreation = [...open].sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;
    // A deterministic final tiebreak, so the answer cannot depend on the
    // order the database happened to return.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  if (!ranking || ranking.length === 0) return byCreation[0] ?? null;

  for (const ranked of ranking) {
    const match = byCreation.find((p) => proposalVenue(p) === ranked.venueId);
    if (match) return match;
  }

  // The ranking named only venues that are no longer proposed — the group's
  // list changed after the engine ran. The earliest open proposal is the
  // honest fallback rather than no answer at all.
  return byCreation[0] ?? null;
}
