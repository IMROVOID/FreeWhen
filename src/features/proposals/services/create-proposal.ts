/**
 * Proposal services (Plan 06 Tasks 5, 6).
 *
 * The client sends a Jalali picker's output already converted to UTC by
 * `slot-time.ts`, and the server re-validates against its own clock. Neither
 * side trusts the other's clock, which is the only arrangement that survives a
 * device set to the wrong day.
 */

import { apiRequest } from '@/src/lib/api';
import type { DuplicateHint, Proposal, ProposalCreateInput } from '@/src/types/proposal';

export interface CreateProposalResult {
  proposal: Proposal;
  /** A hint, never a refusal — creation has already happened. */
  duplicate: DuplicateHint | null;
  isLate: boolean;
}

export async function createProposal(
  eventId: string,
  input: ProposalCreateInput,
  userId: string | null,
): Promise<CreateProposalResult> {
  const { data } = await apiRequest<{
    proposal: Proposal;
    duplicate: DuplicateHint | null;
    is_late: boolean;
  }>(`/api/events/${eventId}/proposals`, {
    method: 'POST',
    body: input,
    userId,
    platform: 'app',
  });

  return { proposal: data.proposal, duplicate: data.duplicate, isLate: data.is_late };
}

export async function listProposals(
  eventId: string,
  userId: string | null,
): Promise<Proposal[]> {
  const { data } = await apiRequest<{ proposals: Proposal[] }>(
    `/api/events/${eventId}/proposals`,
    { userId },
  );

  return data.proposals;
}

export async function patchProposal(
  proposalId: string,
  patch: Partial<Pick<Proposal, 'title' | 'notes' | 'link' | 'start_utc' | 'end_utc'>>,
  userId: string | null,
): Promise<Proposal> {
  const { data } = await apiRequest<{ proposal: Proposal }>(`/api/proposals/${proposalId}`, {
    method: 'PATCH',
    body: patch,
    userId,
    platform: 'app',
  });

  return data.proposal;
}

/**
 * Withdraws a proposal.
 *
 * `DELETE` is the verb, but the row survives with `status = 'WITHDRAWN'` — the
 * response carries it back so the card can render struck through rather than
 * disappearing from the list mid-render.
 */
export async function withdrawProposal(
  proposalId: string,
  userId: string | null,
): Promise<Proposal> {
  const { data } = await apiRequest<{ proposal: Proposal }>(`/api/proposals/${proposalId}`, {
    method: 'DELETE',
    userId,
    platform: 'app',
  });

  return data.proposal;
}
