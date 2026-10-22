/**
 * The confirmation flow, client side (Plan 07 Task 8).
 *
 * ★ THE WARNING NAMES PEOPLE. IT DOES NOT BLOCK.
 *
 * `ConfirmSheet` calls `confirmBodyKey` to get the sentence, then `confirm` on
 * the organizer's second tap. Neither of them can refuse the confirmation — one
 * absent participant must never hold the group hostage (FR-2.20, AC-2.3.1).
 *
 * Kept out of the component so the choice of what to confirm — and the decision
 * that a warning is not a gate — is testable without rendering anything.
 */

import type { Reason } from '@/src/engine/types';
import type { DecisionAxis } from '@/src/types/vote';

import { leadingProposal } from './tally';
import { postConfirm, type ConfirmResponse, type WireDecision } from './voting-api';
import type { Proposal } from '@/src/types/proposal';

/** What the sheet confirms, decided before anything is sent. */
export interface ConfirmPlan {
  axis: DecisionAxis;
  proposalId: string | null;
  proposalTitle: string;
  /** The participants with no answer on the chosen proposal. */
  outstanding: string[];
}

/**
 * Chooses what the confirmation will record.
 *
 * When the organizer has picked a proposal explicitly, that wins. Otherwise it
 * is the engine's leader, by the same `leadingProposal` the server uses — so an
 * organizer who taps confirm blind records the winner everyone else already
 * sees on the leader card (AC-2.4.1).
 */
export function planConfirmation(input: {
  axis: DecisionAxis;
  proposals: Proposal[];
  ranking: ReadonlyArray<{ venueId: string }> | null;
  preferredProposalId?: string | null;
  /** The outstanding names, by proposal id. */
  outstandingByProposal: Record<string, string[]>;
}): ConfirmPlan {
  const open = input.proposals.filter(
    (proposal) => proposal.status === 'OPEN' || proposal.status === 'REOPENED',
  );

  const preferred = input.preferredProposalId
    ? (open.find((proposal) => proposal.id === input.preferredProposalId) ?? null)
    : null;

  const chosen =
    preferred ??
    leadingProposal(open, input.ranking, (proposal) => proposal.venue?.id ?? null);

  return {
    axis: input.axis,
    proposalId: chosen?.id ?? null,
    proposalTitle: chosen?.title ?? '',
    outstanding: chosen ? (input.outstandingByProposal[chosen.id] ?? []) : [],
  };
}

/**
 * The catalogue key and count for the sheet's warning, or `null` when there is
 * nothing to warn about.
 *
 * Returning a key rather than a sentence keeps the wording in the catalogue,
 * which is the only way it reads correctly in both languages.
 */
export function confirmWarning(
  outstanding: string[],
): { key: string; count: number; names: string[] } | null {
  if (outstanding.length === 0) return null;

  return {
    key: 'decision.confirmWarning',
    count: outstanding.length,
    names: outstanding,
  };
}

export async function confirm(input: {
  eventId: string;
  plan: ConfirmPlan;
  userId: string | null;
  lens?: string;
  reason?: Reason | null;
  /** The organizer saw the warning. Recorded in the activity log. */
  warnedOutstanding: boolean;
  openedAtIso?: string;
}): Promise<{ response: ConfirmResponse; decision: WireDecision | null }> {
  const response = await postConfirm(
    input.eventId,
    {
      axis: input.plan.axis,
      preferredProposalId: input.plan.proposalId,
      lens: input.lens,
      reason: input.reason ?? null,
      warnedOutstanding: input.warnedOutstanding,
      openedAtIso: input.openedAtIso,
    },
    input.userId,
  );

  return { response, decision: response.decision };
}
