/**
 * The reopen client (Plan 14 Task 2, PRD-02 AC-2.6.1).
 *
 * ★ THE REASON IS REQUIRED BY THE CALLER, NOT BY THE SERVER ALONE.
 *
 * The server refuses an empty reason, so this module cannot create an invalid
 * request — but the sheet validates first so the message appears under the field
 * the user is looking at, rather than after a round trip.
 */

import { apiRequest } from '@/src/lib/api';
import type { Proposal } from '@/src/types/proposal';

export interface ReopenResult {
  eventStatus: string;
  reopenedProposals: Proposal[];
  /** True when there was nothing live to reopen — a state, not a failure. */
  alreadyReopened: boolean;
}

export async function reopenDecision(
  eventId: string,
  reason: string,
  userId: string | null,
): Promise<ReopenResult> {
  const { data } = await apiRequest<{
    event_status: string;
    reopened_proposals: Proposal[];
    already_reopened: boolean;
  }>(`/api/events/${eventId}/reopen`, {
    method: 'POST',
    body: { reason },
    userId,
  });

  return {
    eventStatus: data.event_status,
    reopenedProposals: data.reopened_proposals,
    alreadyReopened: data.already_reopened,
  };
}
