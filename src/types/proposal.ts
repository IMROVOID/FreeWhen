/**
 * Proposal schemas (PRD-02 §4.1, PRD-09 §3.2).
 *
 * ★ THE REFINEMENTS MIRROR THE DATABASE CONSTRAINTS, ONE FOR ONE.
 *
 * `migrations/006_proposal.sql` declares three checks:
 *
 * | Constraint | Meaning |
 * |---|---|
 * | `place_has_venue` | `type = 'TIME'` or `venue_id is not null` |
 * | `time_has_slot`   | `type = 'PLACE'` or `start_utc is not null` |
 * | `time_ordered`    | `end_utc > start_utc` when both are present |
 *
 * A schema looser than the database turns a user's mistake into a 500 raised by
 * Postgres — a message they cannot act on and cannot read. Every refinement
 * below therefore restates a constraint rather than approximating it, and
 * `tests/proposals/schemas.test.ts` pins the pairing.
 *
 * ★ VALIDATION MESSAGES ARE CATALOGUE KEYS, NEVER PROSE.
 *
 * Same rule as `src/types/event.ts`: the string here is `proposals.validation.*`
 * and the caller runs it through `t()`, so the same response reads Persian in
 * `fa` and English in `en` with no server round trip per locale.
 */

import { z } from 'zod';

/** The three shapes a proposal can take (PRD-02 FR-2.2). */
export const PROPOSAL_TYPES = ['TIME', 'PLACE', 'TIME_AND_PLACE'] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/**
 * The lifecycle states the `status` column allows.
 *
 * ★ `LEADING` and `ELIMINATED` are NOT here, and must not be added.
 *
 * They are derived per render from the tally (PRD-02 §3.1). Storing them makes
 * the label and the tally two sources of truth for the same question, and they
 * drift the first time a vote is withdrawn.
 */
export const PROPOSAL_STATUSES = ['OPEN', 'CHOSEN', 'REOPENED', 'WITHDRAWN'] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Where a proposal came from. Only `manual` is reachable until Phase 14. */
export const PROPOSAL_ORIGINS = ['manual', 'deterministic_parse', 'ai_parse'] as const;

export type ProposalOrigin = (typeof PROPOSAL_ORIGINS)[number];

/** The column bounds, matching `006_proposal.sql`. */
export const PROPOSAL_TITLE_MIN = 1;
export const PROPOSAL_TITLE_MAX = 60;
export const PROPOSAL_NOTES_MAX = 300;

/**
 * A slot's granularity, in minutes (PRD-03 §3.4, default 30).
 *
 * Named because three places depend on it — validation, the picker's step and
 * the grid adapter — and a literal `30` in three files is three chances to
 * disagree.
 */
export const SLOT_GRANULARITY_MIN = 30;

/**
 * The default slot length, in minutes.
 *
 * A proposal is a real interval, not an instant: `end_utc` drives the calendar
 * export and the "ends at" line, and deriving it from a hardcoded 60 at each
 * call site would let two screens disagree about the same proposal.
 */
export const DEFAULT_DURATION_MIN = 120;

/** The validation keys, so a caller cannot misspell one. */
export const VALIDATION = {
  titleRequired: 'proposals.validation.titleRequired',
  titleTooLong: 'proposals.validation.titleTooLong',
  notesTooLong: 'proposals.validation.notesTooLong',
  typeUnknown: 'proposals.validation.typeUnknown',
  timeNeedsSlot: 'proposals.validation.timeNeedsSlot',
  placeNeedsVenue: 'proposals.validation.placeNeedsVenue',
  endBeforeStart: 'proposals.validation.endBeforeStart',
  endWithoutStart: 'proposals.validation.endWithoutStart',
  instantInvalid: 'proposals.validation.instantInvalid',
  slotPast: 'proposals.validation.slotPast',
  slotOutOfWindow: 'proposals.validation.slotOutOfWindow',
  slotOffGranularity: 'proposals.validation.slotOffGranularity',
  linkInvalid: 'proposals.validation.linkInvalid',
  venueNameRequired: 'proposals.validation.venueNameRequired',
  coordRange: 'proposals.validation.coordRange',
  nothingToChange: 'proposals.validation.nothingToChange',
  lockedConfirmed: 'proposals.validation.lockedConfirmed',
} as const;

/** A timestamp that survives `Date.parse` and carries a zone designator. */
const instant = (messageKey: string) =>
  z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), { message: messageKey })
    .refine((value) => /(z|[+-]\d{2}:?\d{2})$/i.test(value), { message: messageKey });

/** The venue a place proposal points at, either an existing row or a new pin. */
export const VenueRefSchema = z.object({
  /** An existing `venue` row — a Neshan result that was already proposed. */
  id: z.string().uuid().nullish(),
  name: z
    .string()
    .trim()
    .min(1, { message: VALIDATION.venueNameRequired })
    .max(120, { message: VALIDATION.venueNameRequired }),
  lat: z.number().min(-90).max(90, { message: VALIDATION.coordRange }),
  lng: z.number().min(-180).max(180, { message: VALIDATION.coordRange }),
  address: z.string().trim().max(300).nullish(),
  /** The Neshan place id. Authoritative for dedup (FR-2.7). */
  provider_place_id: z.string().trim().max(200).nullish(),
});

export type VenueRef = z.infer<typeof VenueRefSchema>;

/**
 * `POST /api/events/:id/proposals`.
 *
 * The three refinements are the database constraints, in order. `notes` and
 * `link` are optional on every type; `title` is required, because an untitled
 * card is a row nobody can refer to in conversation.
 */
export const ProposalCreateSchema = z
  .object({
    type: z.enum(PROPOSAL_TYPES, { message: VALIDATION.typeUnknown }),
    title: z
      .string()
      .trim()
      .min(PROPOSAL_TITLE_MIN, { message: VALIDATION.titleRequired })
      .max(PROPOSAL_TITLE_MAX, { message: VALIDATION.titleTooLong }),
    notes: z
      .string()
      .trim()
      .max(PROPOSAL_NOTES_MAX, { message: VALIDATION.notesTooLong })
      .nullish(),
    link: z.url({ message: VALIDATION.linkInvalid }).max(2000).nullish(),
    /** Required for the place-bearing types (`place_has_venue`). */
    venue: VenueRefSchema.nullish(),
    /** Required for the time-bearing types (`time_has_slot`). */
    start_utc: instant(VALIDATION.timeNeedsSlot).nullish(),
    end_utc: instant(VALIDATION.endWithoutStart).nullish(),
  })
  // `place_has_venue` — mirrored exactly.
  .refine((value) => value.type === 'TIME' || value.venue != null, {
    path: ['venue'],
    message: VALIDATION.placeNeedsVenue,
  })
  // `time_has_slot` — mirrored exactly.
  .refine((value) => value.type === 'PLACE' || value.start_utc != null, {
    path: ['start_utc'],
    message: VALIDATION.timeNeedsSlot,
  })
  // `time_ordered` — an end without a start is meaningless, and both are
  // compared as instants so an offset form cannot slip an inverted slot past.
  .refine((value) => value.end_utc == null || value.start_utc != null, {
    path: ['end_utc'],
    message: VALIDATION.endWithoutStart,
  })
  .refine(
    (value) =>
      value.start_utc == null ||
      value.end_utc == null ||
      Date.parse(value.end_utc) > Date.parse(value.start_utc),
    { path: ['end_utc'], message: VALIDATION.endBeforeStart },
  );

export type ProposalCreateInput = z.infer<typeof ProposalCreateSchema>;

/**
 * `PATCH /api/proposals/:id` — a partial edit of the fields a user can change.
 *
 * `type` is deliberately absent: changing a place proposal into a time proposal
 * would silently orphan its venue, and the honest way to express that is to
 * withdraw it and add the new one. An empty patch is rejected rather than sent,
 * because a request that changes nothing is a client bug and answering 200
 * would hide it.
 */
export const ProposalPatchSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(PROPOSAL_TITLE_MIN, { message: VALIDATION.titleRequired })
      .max(PROPOSAL_TITLE_MAX, { message: VALIDATION.titleTooLong })
      .optional(),
    notes: z
      .string()
      .trim()
      .max(PROPOSAL_NOTES_MAX, { message: VALIDATION.notesTooLong })
      .nullish(),
    link: z.url({ message: VALIDATION.linkInvalid }).max(2000).nullish(),
    start_utc: instant(VALIDATION.instantInvalid).nullish(),
    end_utc: instant(VALIDATION.instantInvalid).nullish(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: VALIDATION.nothingToChange,
  })
  .refine(
    (value) =>
      value.start_utc == null ||
      value.end_utc == null ||
      Date.parse(value.end_utc) > Date.parse(value.start_utc),
    { path: ['end_utc'], message: VALIDATION.endBeforeStart },
  );

export type ProposalPatchInput = z.infer<typeof ProposalPatchSchema>;

/** The venue as the wire returns it, for rendering a place card. */
export interface ProposalVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  provider_place_id: string | null;
  /** `null` means unknown, never closed (PRD-03 E9). */
  opening_hours: unknown | null;
}

/** One proposal, as every endpoint and card sees it. */
export interface Proposal {
  id: string;
  event_id: string;
  type: ProposalType;
  title: string;
  notes: string | null;
  link: string | null;
  status: ProposalStatus;
  origin: ProposalOrigin;
  /** Set when the proposal arrived after voting began (FR-2.9). */
  is_late: boolean;
  start_utc: string | null;
  end_utc: string | null;
  venue: ProposalVenue | null;
  proposer_id: string;
  proposer_name: string;
  created_at: string;
}

/** The event window a slot is validated against. */
export interface EventWindow {
  /** The event's home timezone. `Asia/Tehran` for every MVP event. */
  home_tz: string;
  window_start: string;
  window_end: string;
}

/**
 * A duplicate hint.
 *
 * ★ THIS IS A HINT, NOT A REFUSAL (FR-2.7).
 *
 * It is returned alongside a successful creation, and the client offers the
 * existing proposal as a convenience. There is no code path in which holding
 * one of these prevents a proposal from existing.
 */
export interface DuplicateHint {
  proposal: Proposal;
  /** `provider_place_id` — an exact match on the authoritative identifier. */
  reason: 'same_provider_place' | 'near_and_similar';
  /** The measured distance in metres, when the match was positional. */
  metres: number | null;
}
