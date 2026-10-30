/**
 * The engine's domain types.
 *
 * The engine reads a *resolved* world: travel measurements arrive already
 * computed. It never fetches, never reads a clock, and never imports
 * React Native (PRD-05 §2, PRD-10 §6).
 *
 * `TravelMeasurement` is RE-EXPORTED from `src/routing/types.ts`, never
 * redefined here. Two definitions would drift, and Phase 4's adapter would
 * then populate a different shape than the engine reads.
 */

import type { Confidence, TravelMeasurement, TransportMode } from '@/src/routing/types';

export type { Confidence, TravelMeasurement, TransportMode };

/**
 * A tri-state accessibility value.
 *
 * `unknown` is the DEFAULT and the most important value in this file:
 * absent data means unknown, never accessible (PRD-05 §3.3).
 */
export type TriState = 'confirmed_yes' | 'confirmed_no' | 'unknown';

/** A participant's accessibility requirements and declared constraints. */
export interface AccessibilityContext {
  /** The participant needs a step-free entrance. */
  needsStepFree: boolean;
  /** Walking minutes are scaled for this participant. */
  limitedWalking: boolean;
  /** The most the participant can walk, in minutes. `null` = undeclared. */
  maxWalkMinutes: number | null;
  /** The participant avoids night travel. A declared preference. */
  avoidsNightTravel: boolean;
  /** The hour after which the participant will not walk alone, 0–23. */
  noWalkAloneAfter: number | null;
}

/** A participant, as the engine sees them. */
export interface ParticipantContext {
  id: string;
  name: string;
  /** `null` = no location shared. The participant is NOT scored as zero. */
  startPoint: { lat: number; lng: number; accuracyM: number } | null;
  /** The modes the participant can use. May be empty. */
  modes: TransportMode[];
  hasCar: boolean;
  /** Whether the participant can offer rides. P2 — reserved. */
  canOfferRides: boolean;
  /** The participant's travel budget in minutes. `null` = use the default. */
  maxTravelMinutes: number | null;
  accessibility: AccessibilityContext;
  /** Always 1 in the MVP. The field is reserved; no lens reads it. */
  weight: number;
}

/** A venue's accessibility attributes, as a tri-state. */
export interface AccessibilityAttributes {
  stepFreeEntrance: TriState;
  accessibleRestroom: TriState;
  limitedWalkingSuitable: TriState;
  /** Where the data came from. `none` means there is no data. */
  source: 'osm' | 'provider' | 'user' | 'none';
}

/** The opening hours of a venue, in a 24-hour local clock. */
export interface OpeningHours {
  /** The hour the venue opens, 0–23. */
  open: number;
  /** The hour the venue closes, 0–24, where 24 means midnight. */
  close: number;
}

/** A venue, as the engine sees them. */
export interface VenueContext {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** `null` = unknown hours. Absent hours are NOT "open" and NOT "closed". */
  openingHours: OpeningHours | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  venueType: string | null;
  accessibility: AccessibilityAttributes;
  rating: number | null;
}

/** The four aggregation lenses. Named, never "the fairest" (PRD-05 §6.2). */
export type Lens = 'balanced' | 'fastest' | 'fairest' | 'cheapest';

/**
 * The eight reason templates.
 *
 * The engine returns a template key and its parameters — never a rendered
 * sentence. A pre-rendered string freezes the digit set and the wording at
 * composition time, so neither can be re-localised (PRD-05 §11.1).
 *
 * The two `accessibility_*` ids are the detail-level templates the client
 * catalogue already carries; they are used for an exclusion and a conflict,
 * never for a ranked venue's headline reason (PRD-05 §15).
 */
export type ReasonTemplateId =
  | 'balanced_floor'
  | 'balanced_mean'
  | 'fastest_total'
  | 'fairest_gap'
  | 'cheapest_total'
  | 'with_coverage_gap'
  | 'with_low_confidence'
  | 'excluded'
  | 'accessibility_no_confirm'
  | 'accessibility_unknown_note';

/** A reason: a template key plus its parameters. */
export interface Reason {
  templateId: ReasonTemplateId;
  /**
   * The template's parameters. Numbers stay numbers — `floorMinutes: 18` is
   * the number 18; «۱۸» and "18" are the client's decision. Names are data
   * and are never translated.
   *
   * A parameter may be `null`, which means "unknown". A `null` cost is not
   * the same as a zero cost, and the engine does not coerce one into the
   * other (PRD-05 §8).
   */
  params: Record<string, number | string | null | Reason>;
}

/** Why a venue was excluded. */
export type ExclusionReason =
  | 'dealbreaker'
  | 'accessibility'
  | 'travel_budget'
  | 'walk_limit'
  | 'walk_alone_at_night'
  | 'closed'
  | 'too_far';

/** A recorded exclusion. Every exclusion carries a reason (PRD-05 §5.2). */
export interface Exclusion {
  venueId: string;
  reason: ExclusionReason;
  /** The participant the exclusion affects, when it is participant-scoped. */
  participantId: string | null;
  /** A template, not prose — the client renders it. */
  detail: Reason;
}

/** A conflict worth surfacing but not worth excluding over. */
export type ConflictType = 'accessibility_unknown' | 'low_confidence' | 'partial_cost';

/** A surfaced conflict. */
export interface Conflict {
  type: ConflictType;
  venueId: string;
  participantId: string | null;
  detail: Reason;
}

/** How much of the group the ranking actually covers. */
export interface Coverage {
  /** The number of participants the ranking could measure. */
  compared: number;
  /** The number of participants in the group. */
  total: number;
  /** The participants that could not be measured. */
  missing: string[];
  /** The participants in different cities — a ranking over them is odd. */
  wideGeography: boolean;
}

/** One participant's result for one venue. */
export interface ParticipantResult {
  id: string;
  name: string;
  mode: TransportMode;
  /** The travel time in minutes. */
  minutes: number;
  /** The range, when the measurement is not high-confidence. */
  minutesRange: [number, number] | null;
  /** `null` = unknown. NEVER 0 — unknown must not read as free. */
  costIrr: number | null;
  confidence: Confidence;
  /** The participant's utility for this venue, 0–100. */
  utility: number;
  /** The constraint the participant did not meet, as a template. */
  unmet: Reason | null;
}

/** A venue's aggregate over the participants who could be measured. */
export interface Aggregate {
  venueId: string;
  /** The worst-off participant's utility. */
  floor: number;
  /** The mean utility. */
  mean: number;
  /** The spread between the best and the worst-off utility. */
  gap: number;
  /** The sum of the travel times, in minutes. */
  totalTime: number;
  /** The sum of the KNOWN costs, in tomans. `null` if no cost is known. */
  totalCost: number | null;
  /**
   * Whether EVERY participant's cost is known.
   *
   * The Cheapest lens compares the complete costs first, so a venue that
   * is cheap only because some of its costs are missing cannot win
   * (PRD-05 §8).
   */
  costComplete: boolean;
  /** The longest journey of anyone in the group, in minutes. */
  worstMinutes: number;
  /** The spread between the longest and the shortest journey, in minutes. */
  minutesGap: number;
  /** The worst link's confidence — the worst link governs (PRD-05 §8.2). */
  confidence: Confidence;
  /** The utilities, in participant order. */
  utilities: number[];
}

/** A ranked venue. */
export interface RankedVenue {
  venueId: string;
  name: string;
  /**
   * The venue's coordinate, so the map can PLACE it.
   *
   * ★ THE PAYLOAD DROPPED THIS, AND THE MAP HAD NOTHING TO DRAW.
   *
   * `server/routes/rank-travel.ts` already selected `v.lat`/`v.lng` and used them
   * to build the matrix, then left them out of the answer. The ranked screen
   * compensated by passing `coordinates = {}` to the map, so no venue pin has ever
   * been placeable — the map drew an empty city and the list carried every fact.
   *
   * A venue's coordinate is public information (it is a restaurant, not a person),
   * so unlike a participant's start point there is nothing to fuzz here.
   */
  lat: number;
  lng: number;
  /** 1-based. */
  rank: number;
  floor: number;
  mean: number;
  gap: number;
  /**
   * The travel time shown to the user: a number, or a `[lower, upper]` range
   * when the underlying measurement is not precise. The union is the guard
   * against rendering a low-confidence estimate as a precise integer
   * (PRD-04 §13.4).
   */
  minutes: number | [number, number];
  /** The total cost, or `null` when no cost is known. */
  totalCost: number | null;
  /** The worst link's confidence. */
  confidence: Confidence;
  /** The reason: a template, never prose. */
  reason: Reason;
  /** The per-participant breakdown. */
  participants: ParticipantResult[];
  /** The conflicts worth surfacing. */
  conflicts: Conflict[];
}

/** The suggestions offered when no venue survives the filters. */
export type Suggestion =
  | 'relax_max_travel'
  | 'relax_accessibility'
  | 'add_venue'
  | 'remove_dealbreaker';

/**
 * The successful result.
 *
 * It IS the ranked array — `result[0]` is the first-ranked venue — and it
 * also carries the envelope the client needs: the coverage, the exclusions
 * and the conflicts. Both are required: the coverage must be present on
 * EVERY result (a ranking over 6 of 8 people must never be presentable as
 * 8), and the exclusions must be renderable, not merely implied by an
 * absence.
 */
export interface ScoreSuccess extends Array<RankedVenue> {
  state: 'ok';
  lens: Lens;
  coverage: Coverage;
  excluded: Exclusion[];
  conflicts: Conflict[];
}

/**
 * The no-viable-option state.
 *
 * A FIRST-CLASS return value — never `[]`, `null`, or a throw. An empty
 * candidate set is a documented failure mode of a τ-threshold aggregator, and
 * returning nothing leaves the user with no way forward (PRD-05 §5.3).
 */
export interface NoVenueMeetsThreshold {
  state: 'NoVenueMeetsThreshold';
  excluded: Exclusion[];
  suggestions: Suggestion[];
  /** The coverage, present on every path. */
  coverage: Coverage;
}

/** The engine's result. */
export type ScoreResult = ScoreSuccess | NoVenueMeetsThreshold;

/** The engine's options. */
export interface EngineOptions {
  /** The hour of the event, 0–23, on a 24-hour clock. */
  eventHour?: number;
  /**
   * The travel measurements, keyed by participant id and venue id.
   *
   * A participant with no entry for a venue is NOT measured for that venue:
   * they are excluded from the aggregation and reported in `coverage.missing`.
   */
  measurements?: Record<string, Record<string, TravelMeasurement>>;
  /** The venues a participant has marked as a hard `no` (PRD-02 FR-2.17). */
  dealbreakers?: Record<string, string[]>;
}
