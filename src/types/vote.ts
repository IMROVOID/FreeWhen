/**
 * Vote and decision schemas (PRD-02 §3.2, §4.2–§4.6, PRD-09 §3.2).
 *
 * ★ UNANSWERED IS A STATE, NOT A MISSING VOTE.
 *
 * There is no `unanswered` value in `VOTE_VALUES` and there must not be: a vote
 * row exists only once somebody votes. "Has not answered" is derived from the
 * ABSENCE of a row against the participant list — which is why it lives in the
 * tally rather than in the enum (PRD-02 §13.2).
 *
 * ★ `LEADING` AND `ELIMINATED` ARE NOT IN `PROPOSAL_STATUSES`, HERE OR ANYWHERE.
 *
 * They are derived per render from the tally and the engine's ranking. Storing
 * them makes the label and the tally two sources of truth for one question, and
 * they drift the first time a vote changes (PRD-02 §3.1).
 *
 * ★ VALIDATION MESSAGES ARE CATALOGUE KEYS, NEVER PROSE.
 *
 * Same rule as `src/types/proposal.ts`: the string in `VOTE_VALIDATION` is the
 * key, and the screen runs it through `t()`. The server ships no Persian and no
 * English of its own.
 */

import { z } from 'zod';

/** The three answers a participant can give (D11). */
export const VOTE_VALUES = ['yes', 'maybe', 'no'] as const;

export type VoteValue = (typeof VOTE_VALUES)[number];

/**
 * The decision axis a proposal belongs to.
 *
 * A proposal can carry both a time and a place, in which case it takes part in
 * both decisions — one `decision` row per axis — because "when" and "where" are
 * confirmed as two separate questions even when the group picks the same card
 * for both.
 */
export const DECISION_AXES = ['time', 'place'] as const;

export type DecisionAxis = (typeof DECISION_AXES)[number];

/**
 * The four lenses, re-exported from the engine rather than restated.
 *
 * Two definitions of the lens set would drift, and a confirmed decision naming
 * a lens the engine no longer ranks under is a Decision Card nobody can
 * explain. `src/engine/types.ts` is the only definition.
 */
export { type Lens } from '@/src/engine/types';

/** The validation keys, so a caller cannot misspell one. */
export const VOTE_VALIDATION = {
  valueUnknown: 'voting.validation.valueUnknown',
  dealbreakerNotBoolean: 'voting.validation.dealbreakerNotBoolean',
  proposalWithdrawn: 'voting.validation.proposalWithdrawn',
  eventConfirmed: 'voting.validation.eventConfirmed',
  axisUnknown: 'decision.validation.axisUnknown',
} as const;

/**
 * `PUT /api/proposals/:id/vote`.
 *
 * ★ THERE IS NO PARTICIPANT ID IN THIS BODY, AND THAT IS THE POINT.
 *
 * The participant is the caller, resolved from `x-user-id` on the server. A
 * client-supplied participant id would let anyone vote as anyone — and a vote
 * attributed to the wrong person is worse than a missing one, because the
 * tally looks complete while being wrong.
 */
export const CastVoteSchema = z.object({
  value: z.enum(VOTE_VALUES, { message: VOTE_VALIDATION.valueUnknown }),
  /**
   * A hard veto, not a property of the venue (migration 007). Stored on the
   * vote; the engine's filter already reads it.
   */
  is_dealbreaker: z.boolean({ message: VOTE_VALIDATION.dealbreakerNotBoolean }).optional(),
});

export type CastVoteInput = z.infer<typeof CastVoteSchema>;

/**
 * `POST /api/events/:id/confirm`.
 *
 * `preferred_proposal_id` is the organizer's override. When it is absent the
 * server confirms the leader the ENGINE chose, so an organizer who taps confirm
 * without picking anything gets the same answer every other participant sees
 * (PRD-02 FR-2.27, AC-2.4.1).
 */
export const ConfirmSchema = z.object({
  axis: z.enum(DECISION_AXES, { message: VOTE_VALIDATION.axisUnknown }),
  preferred_proposal_id: z.string().uuid().nullish(),
  /**
   * The client's consent to proceed despite outstanding voters (FR-2.20).
   *
   * ★ RECORDED, NOT ENFORCED.
   *
   * A missing flag does NOT block the confirmation — one absent person cannot
   * hold the group hostage. The flag exists so the activity log can state
   * honestly whether the organizer saw the warning, which is the difference
   * between "confirmed over three non-voters" and "confirmed without knowing".
   */
  warned_outstanding: z.boolean().optional(),
});

export type ConfirmInput = z.infer<typeof ConfirmSchema>;

/** One vote, as the wire returns it. */
export interface Vote {
  proposal_id: string;
  participant_id: string;
  display_name: string;
  value: VoteValue;
  is_dealbreaker: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * The tally for one proposal.
 *
 * ★ `unanswered` IS A SEPARATE FIELD AND IS NEVER FOLDED INTO `no`.
 *
 * This is the single most likely logic bug in the whole app (PRD-02 §13.2).
 * Three votes from five people must never read as unanimous rejection.
 */
export interface Tally {
  yes: number;
  maybe: number;
  no: number;
  /** Participants with no vote row. NOT a "no". */
  unanswered: number;
  /** The number of participants eligible to vote. */
  total: number;
  /** The names behind each count, for named attribution (FR-2.15). */
  voters: {
    yes: string[];
    maybe: string[];
    no: string[];
  };
  /** The participants who have not answered — the organizer's key signal. */
  outstanding: string[];
}

/** The proposal statuses that count toward a live tally. */
export const TALLY_STATUSES = ['OPEN', 'CHOSEN', 'REOPENED'] as const;

/**
 * The state of one proposal in the Decision Status area.
 *
 * ★ DERIVED, NEVER STORED (PRD-02 §3.1). `deriveStatus` in
 * `src/features/voting/services/tally.ts` is the only producer.
 */
export type DerivedProposalStatus = 'LEADING' | 'ELIMINATED' | 'CLOSED' | 'OPEN';

/** The reason contract, re-exported so the decision card and the engine agree. */
export type { Reason } from '@/src/engine/types';

/** The activity log's action vocabulary (migration 009). */
export const ACTIVITY_ACTIONS = [
  'proposal_created',
  'proposal_withdrawn',
  'vote_cast',
  'vote_changed',
  'confirmed',
  'reopened',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * One append-only activity row.
 *
 * ★ `detail` HOLDS ENUM TOKENS AND NUMBERS, NEVER COORDINATES AND NEVER PROSE.
 *
 * `{"from":"maybe","to":"yes"}` is renderable in either language; a rendered
 * sentence would be frozen in whichever language it was written (FR-8.44).
 */
export interface ActivityEntry {
  id: string;
  action: ActivityAction;
  actor_name: string | null;
  subject_type: string | null;
  subject_id: string | null;
  detail: Record<string, string | number | boolean | null>;
  created_at: string;
}
