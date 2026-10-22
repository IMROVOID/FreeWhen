/**
 * The voting client services (Plan 07 Tasks 3, 8, 11).
 *
 * ★ EVERY FAILURE CARRIES A CATALOGUE KEY, NOT A SENTENCE.
 *
 * Same contract as the rest of the app: the server answers with
 * `{ error, messageKey, fields }`, `apiRequest` turns that into an `ApiFailure`,
 * and the screen renders it through `t()`. A Persian string here would be
 * untranslatable and would fail the phase's completion checklist.
 *
 * ★ THE CLIENT SENDS `opened_at`, NEVER A DURATION.
 *
 * The server subtracts it, so a device clock set forward cannot produce a
 * negative "time to decision" that averages into the funnel unnoticed.
 */

import { apiRequest } from '@/src/lib/api';
import type { Reason } from '@/src/engine/types';
import type { Proposal } from '@/src/types/proposal';
import type {
  ActivityEntry,
  DecisionAxis,
  Vote,
  VoteValue,
} from '@/src/types/vote';

/** The tally as the wire carries it, mirroring `Tally`. */
export interface WireTally {
  yes: number;
  maybe: number;
  no: number;
  unanswered: number;
  total: number;
  voters: { yes: string[]; maybe: string[]; no: string[] };
  outstanding: string[];
}

export interface WireParticipant {
  id: string;
  display_name: string;
  role: string;
}

/** The live decision row, as the wire carries it. */
export interface WireDecision {
  id: string;
  event_id: string;
  axis: DecisionAxis;
  proposal_id: string | null;
  lens: string;
  reason_template: string;
  reason_params: Record<string, unknown>;
  confirmed_by: string | null;
  confirmed_at: string;
}

/** `GET /api/events/:id/decision-status` */
export interface DecisionStatusResponse {
  proposals: Array<{ proposal: Proposal; tally: WireTally }>;
  participants: WireParticipant[];
  myVotes: Record<string, VoteValue>;
  me: WireParticipant;
  decisions: Partial<Record<DecisionAxis, WireDecision>>;
  event: {
    id: string;
    status: string;
    home_tz: string;
    voting_deadline: string | null;
  };
}

export async function fetchDecisionStatus(
  eventId: string,
  userId: string | null,
  openedAtIso?: string,
): Promise<DecisionStatusResponse> {
  const query = openedAtIso ? `?opened_at=${encodeURIComponent(openedAtIso)}` : '';

  const { data } = await apiRequest<DecisionStatusResponse>(
    `/api/events/${eventId}/decision-status${query}`,
    { userId },
  );

  return data;
}

export interface CastVoteResponse {
  vote: Vote;
  previous: VoteValue | null;
  is_change: boolean;
}

/**
 * Records or changes a vote.
 *
 * `PUT` because the operation is idempotent: sending "yes" twice is one vote,
 * which is exactly what the server's upsert does. A `POST` would suggest a
 * second call creates a second vote, and a client that retried on a timeout
 * would be relying on the constraint rather than on the verb.
 */
export async function putVote(
  proposalId: string,
  value: VoteValue,
  userId: string | null,
  options: { openedAtIso?: string } = {},
): Promise<CastVoteResponse> {
  const { data } = await apiRequest<CastVoteResponse>(`/api/proposals/${proposalId}/vote`, {
    method: 'PUT',
    userId,
    platform: 'app',
    body: {
      value,
      ...(options.openedAtIso ? { opened_at: options.openedAtIso } : {}),
    },
  });

  return data;
}

export interface ConfirmResponse {
  decision: WireDecision | null;
  outstanding: string[];
  already_confirmed: boolean;
}

/**
 * Records the final decision.
 *
 * ★ `warned_outstanding` RECORDS THAT THE ORGANIZER SAW THE WARNING.
 *
 * It does not gate anything — confirmation proceeds with outstanding voters by
 * design (FR-2.20). It exists so the activity log can distinguish "confirmed
 * over three non-voters" from "confirmed without knowing there were three".
 */
export async function postConfirm(
  eventId: string,
  body: {
    axis: DecisionAxis;
    preferredProposalId?: string | null;
    lens?: string;
    reason?: Reason | null;
    warnedOutstanding?: boolean;
    openedAtIso?: string;
  },
  userId: string | null,
): Promise<ConfirmResponse> {
  const { data } = await apiRequest<ConfirmResponse>(`/api/events/${eventId}/confirm`, {
    method: 'POST',
    userId,
    platform: 'app',
    body: {
      axis: body.axis,
      preferred_proposal_id: body.preferredProposalId ?? null,
      lens: body.lens,
      reason: body.reason ?? null,
      warned_outstanding: body.warnedOutstanding ?? false,
      opened_at: body.openedAtIso,
    },
  });

  return data;
}

export async function fetchActivity(
  eventId: string,
  userId: string | null,
  limit = 100,
): Promise<ActivityEntry[]> {
  const { data } = await apiRequest<{ activity: ActivityEntry[] }>(
    `/api/events/${eventId}/activity?limit=${limit}`,
    { userId },
  );

  return data.activity;
}
