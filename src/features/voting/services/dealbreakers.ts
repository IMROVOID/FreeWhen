/**
 * Dealbreakers: a participant's hard `no` (Plan 14 Task 4, PRD-02 FR-2.17,
 * OQ-2.2, §4.3).
 *
 * ★ ONLY AN EXPLICIT DEALBREAKER FILTERS A VENUE (OQ-2.2).
 *
 * A casual `no` is a preference. Conflating the two lets one person veto
 * silently — they press "no" because they would rather go somewhere else, and
 * the venue vanishes for everyone with no explanation. So the veto is a second,
 * deliberate act on top of the `no` vote, and this module is the only thing that
 * turns a vote row into a filter input.
 *
 * ★ AN EXCLUDED VENUE STAYS VISIBLE AND MUTED, NAMING THE PERSON (P08 rule).
 *
 * The engine drops a dealbroken venue from `kept` and reports it in `excluded`
 * with `reason: 'dealbreaker'` and the `participantId`. A UI that simply omitted
 * it would be the silent disappearance this rule exists to forbid: the group
 * would wonder where the restaurant went, and nobody would know somebody had
 * vetoed it.
 *
 * This module therefore produces the MUTED LIST as a first-class result — not a
 * filter over the rendered cards. `resolveDealbreakers` returns both halves and
 * the screen renders both.
 */

import type { ExclusionReason } from '@/src/engine/types';
import type { Proposal } from '@/src/types/proposal';
import type { VoteValue } from '@/src/types/vote';

/** One participant's stored veto, as the decision-status payload carries it. */
export interface DealbreakerRecord {
  /** The proposal the participant vetoed. */
  proposalId: string;
  /** The participant who vetoed it. */
  participantId: string;
  /** Their display name, for the reason line. Names are data, never translated. */
  displayName: string;
}

/** A venue that is kept, or one that is muted with a reason. */
export interface ResolvedProposal {
  proposal: Proposal;
  /** `true` when a dealbreaker removed it from the viable set. */
  excluded: boolean;
  /**
   * Why, when excluded. `null` for a kept proposal.
   *
   * Carries the reason AND the name, so the card can say
   * `«حذف شد: وتوی سارا»` instead of a bare "excluded".
   */
  exclusion: {
    reason: ExclusionReason;
    participantId: string;
    participantName: string;
  } | null;
}

/**
 * The engine's `dealbreakers` input, derived from stored votes.
 *
 * `Record<participantId, proposalId[]>` is the shape `applyHardFilters` reads
 * (`src/engine/filters.ts:153`). Building it here rather than at the call site
 * keeps one conversion in one place — a second copy is a second chance to key it
 * by proposal instead of by participant.
 *
 * ★ A VETO ONLY COUNTS ON A `no` VOTE.
 *
 * The database stores `value` and `is_dealbreaker` as two columns, so they can
 * disagree — a client that flipped a vetoed `no` to `yes` while sending a stale
 * flag leaves both set. Reading the pair here means a `yes` with a lingering
 * flag cannot exclude anything: the vote is what the participant means, and the
 * flag alone is not a veto.
 */
export function dealbreakersByParticipant(
  votes: ReadonlyArray<{
    proposal_id: string;
    participant_id: string;
    value: VoteValue;
    is_dealbreaker: boolean;
  }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  for (const vote of votes) {
    if (!vote.is_dealbreaker || vote.value !== 'no') continue;

    (out[vote.participant_id] ??= []).push(vote.proposal_id);
  }

  for (const ids of Object.values(out)) ids.sort();

  return out;
}

/**
 * Splits proposals into kept and muted, without ever dropping one.
 *
 * ★ EVERY PROPOSAL COMES BACK. THE COUNT IS INVARIANT.
 *
 * `resolved.length === proposals.length` always holds. That is the assertion the
 * test pins, because it is the whole point: an excluded venue is muted, not
 * removed, and a caller that concatenates the two halves gets the original list
 * back in its original order.
 *
 * Order is preserved within each half so the screen's creation order survives.
 */
export function resolveDealbreakers(
  proposals: ReadonlyArray<Proposal>,
  records: ReadonlyArray<DealbreakerRecord>,
): ResolvedProposal[] {
  // First veto wins per proposal. Two people can veto the same place; naming
  // the first keeps the line readable, and the group is going to ask anyway.
  const vetoByProposal = new Map<string, DealbreakerRecord>();
  for (const record of records) {
    if (!vetoByProposal.has(record.proposalId)) {
      vetoByProposal.set(record.proposalId, record);
    }
  }

  return proposals.map((proposal) => {
    const veto = vetoByProposal.get(proposal.id);

    // A withdrawn proposal is not a candidate, so a veto on it changes nothing
    // visible — but it is still reported, because the record exists.
    if (!veto) {
      return { proposal, excluded: false, exclusion: null };
    }

    return {
      proposal,
      excluded: true,
      exclusion: {
        reason: 'dealbreaker',
        participantId: veto.participantId,
        participantName: veto.displayName,
      },
    };
  });
}

/** The kept proposals, in their original order. */
export function keptFrom(resolved: ReadonlyArray<ResolvedProposal>): Proposal[] {
  return resolved.filter((entry) => !entry.excluded).map((entry) => entry.proposal);
}

/** The muted proposals, in their original order — never hidden. */
export function mutedFrom(resolved: ReadonlyArray<ResolvedProposal>): ResolvedProposal[] {
  return resolved.filter((entry) => entry.excluded);
}

/**
 * Whether the caller's own veto is currently set on a proposal.
 *
 * The card asks this to decide whether "وتوی من" is pressed. It reads the list
 * the decision-status payload carries rather than the vote map, because the vote
 * map has no room for the flag.
 */
export function hasVetoed(myDealbreakers: ReadonlyArray<string>, proposalId: string): boolean {
  return myDealbreakers.includes(proposalId);
}

/**
 * The value a veto tap writes.
 *
 * ★ A VETO IS A `no`. THERE IS NO "VETO WITHOUT A NO".
 *
 * Tapping `«وتوی من»` records `no` + `is_dealbreaker`: the vote row must say
 * both, or the tally and the filter disagree about what the participant said.
 * Tapping it again clears the flag but KEEPS the `no` — the participant still
 * does not want that venue, they just no longer want to force the group's hand.
 */
export function vetoVoteValue(): VoteValue {
  return 'no';
}
