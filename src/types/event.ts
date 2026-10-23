/**
 * Event, participant and start-point schemas (PRD-01 §4, PRD-09 §5.2).
 *
 * Every boundary validates with these — the create screen, the join form, the
 * location picker, and the two server routes. One schema per payload means the
 * client and the server cannot drift, and the error a user sees on the screen
 * is produced by the same rule the server enforces.
 *
 * ★ Validation messages are CATALOGUE KEYS, never prose.
 *
 * A Zod message is a user-facing string the moment a screen renders it, and
 * `fa.json`/`en.json` are the only places user-facing Persian or English may
 * live (gate:i18n, and the "no hardcoded user-facing string" criterion). A
 * message here is therefore `events.validation.titleRequired`, and the caller
 * runs it through `t()`.
 */

import { z } from 'zod';

/** PRD-09 §5.1 — the fixed activity vocabulary. Tokens, never labels. */
export const ACTIVITY_TYPES = [
  'dinner',
  'coffee',
  'study',
  'birthday',
  'hiking',
  'movie',
  'games',
  'other',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const EVENT_STATUSES = ['DRAFT', 'OPEN', 'DECIDING', 'CONFIRMED', 'PAST', 'CANCELLED'] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

/** PRD-01 FR-1.17 — the participant cap. Named once, referenced everywhere. */
export const PARTICIPANT_CAP = 10;

/** PRD-01 FR-1.19 / FR-1.2 — the display-name bounds. */
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 30;

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 500;

/** Iran's bounding box, matching the `start_point` table constraints. */
export const LAT_MIN = 25;
export const LAT_MAX = 40;
export const LNG_MIN = 44;
export const LNG_MAX = 64;

/** Travel budget bounds, matching `participant.max_travel_minutes`. */
export const TRAVEL_MINUTES_MIN = 5;
export const TRAVEL_MINUTES_MAX = 240;

/** The Decimal places a coordinate may carry. Two ≈ 1.1 km (PRD-08 FR-8.11). */
export const COORD_DECIMALS = 2;

/** The validation keys, so a caller cannot misspell one. */
export const VALIDATION = {
  titleRequired: 'events.validation.titleRequired',
  titleTooLong: 'events.validation.titleTooLong',
  descriptionTooLong: 'events.validation.descriptionTooLong',
  windowRequired: 'events.validation.windowRequired',
  windowOrder: 'events.validation.windowOrder',
  deadlineAfterWindow: 'events.validation.deadlineAfterWindow',
  deadlineInPast: 'events.validation.deadlineInPast',
  nameRequired: 'events.validation.nameRequired',
  nameTooLong: 'events.validation.nameTooLong',
  coordRange: 'events.validation.coordRange',
  coordPrecision: 'events.validation.coordPrecision',
  travelRange: 'events.validation.travelRange',
  modesUnknown: 'events.validation.modesUnknown',
} as const;

/** A timestamp that survives `Date.parse`. ISO-8601 with an offset or `Z`. */
const instant = (messageKey: string) =>
  z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), { message: messageKey })
    .refine((value) => /(z|[+-]\d{2}:?\d{2})$/i.test(value), { message: messageKey });

/**
 * Whether a number carries no more than two decimal places.
 *
 * The check is on the DECIMAL TEXT, not on `Math.round(v * 100) / 100`:
 * binary floating point maps `35.700000000000003` and `35.7` to the same
 * double, so a rounding comparison would let an injected third decimal
 * through. `String(value)` gives the shortest representation that round-trips,
 * which is exactly the digits the caller sent.
 */
export function hasAtMostTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value)) return false;

  // `toString()` gives the shortest round-tripping representation, which is
  // exactly what the client sent for any value a user or device produced.
  const text = String(value);
  const dot = text.indexOf('.');
  if (dot === -1) return true;

  // Exponent form (`1e-7`) cannot be a valid coordinate; reject it outright.
  if (text.includes('e') || text.includes('E')) return false;

  return text.length - dot - 1 <= COORD_DECIMALS;
}

const coordinate = (min: number, max: number) =>
  z
    .number()
    .min(min, { message: VALIDATION.coordRange })
    .max(max, { message: VALIDATION.coordRange })
    .refine(hasAtMostTwoDecimals, { message: VALIDATION.coordPrecision });

/** The five options on S5 (PRD-08 §3.3). `none` is the skip. */
export const START_POINT_SOURCES = ['gps_coarse', 'manual', 'none'] as const;

export type StartPointSource = (typeof START_POINT_SOURCES)[number];

export const StartPointSchema = z.object({
  lat: coordinate(LAT_MIN, LAT_MAX),
  lng: coordinate(LNG_MIN, LNG_MAX),
  /**
   * Rounded to a coarse granularity by construction, so the column default
   * (1200 m) is the only honest value a client may send.
   */
  accuracy_m: z.number().int().positive().max(5000).default(1200),
  source: z.enum(START_POINT_SOURCES).default('gps_coarse'),
  /** A neighbourhood — `«پارک لاله»`. Never a geocoded street address (FR-8.13). */
  label: z.string().trim().max(TITLE_MAX).nullish(),
});

export type StartPointInput = z.infer<typeof StartPointSchema>;

/**
 * `POST /api/events` (PRD-01 FR-1.4).
 *
 * `voting_deadline` is optional and may not fall after the window's end — the
 * DB has the same constraint, but the user must see it inline rather than as a
 * 422 they never asked for (FR-1.4).
 */
export const EventCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: VALIDATION.titleRequired })
      .max(TITLE_MAX, { message: VALIDATION.titleTooLong }),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX, { message: VALIDATION.descriptionTooLong })
      .nullish(),
    activity_type: z.enum(ACTIVITY_TYPES).nullish(),
    date_window_start: instant(VALIDATION.windowRequired),
    date_window_end: instant(VALIDATION.windowRequired),
    voting_deadline: instant(VALIDATION.deadlineInPast).nullish(),
    home_tz: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Date.parse(value.date_window_start) < Date.parse(value.date_window_end), {
    path: ['date_window_end'],
    message: VALIDATION.windowOrder,
  })
  .refine(
    (value) =>
      !value.voting_deadline ||
      Date.parse(value.voting_deadline) <= Date.parse(value.date_window_end),
    { path: ['voting_deadline'], message: VALIDATION.deadlineAfterWindow },
  );

export type EventCreateInput = z.infer<typeof EventCreateSchema>;

/** `POST /api/invite/:token/join` — one field (PRD-01 FR-1.17). */
export const JoinSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(DISPLAY_NAME_MIN, { message: VALIDATION.nameRequired })
    .max(DISPLAY_NAME_MAX, { message: VALIDATION.nameTooLong }),
});

export type JoinInput = z.infer<typeof JoinSchema>;

/** The transport vocabulary (PRD-09 §5.3) — the same set the column checks. */
export const TRANSPORT_MODES = ['car', 'transit', 'walk', 'cycle', 'taxi'] as const;

export type TransportModeToken = (typeof TRANSPORT_MODES)[number];

export const VISIBILITIES = ['private', 'event'] as const;

/**
 * `PATCH /api/participants/me` (PRD-01 FR-1.21).
 *
 * Every field is optional, and an empty patch is rejected rather than sent:
 * a request that changes nothing is a client bug, and answering it 200 hides
 * the bug.
 */
export const ParticipantPatchSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(DISPLAY_NAME_MIN, { message: VALIDATION.nameRequired })
      .max(DISPLAY_NAME_MAX, { message: VALIDATION.nameTooLong })
      .optional(),
    modes: z.array(z.enum(TRANSPORT_MODES)).max(TRANSPORT_MODES.length).optional(),
    has_car: z.boolean().optional(),
    max_travel_minutes: z
      .number()
      .int()
      .min(TRAVEL_MINUTES_MIN, { message: VALIDATION.travelRange })
      .max(TRAVEL_MINUTES_MAX, { message: VALIDATION.travelRange })
      .optional(),
    access_needs: z.record(z.string(), z.unknown()).optional(),
    visibility: z.enum(VISIBILITIES).optional(),
    /**
     * The mute preference (Plan 10 Task 6, FR-6.19).
     *
     * ★ A BOOLEAN, NOT THE `preferences` BAG THE CLIENT USED TO SEND.
     *
     * `MuteToggle` originally sent
     * `{ preferences: { muted_events: 'mute' | 'unmute', event_id } }`, which
     * this schema rejected because no such field existed — so every toggle
     * silently reverted. The stored form is one participant-scoped flag
     * (migration 018), and the wire form names it directly: an envelope with a
     * free-form key inside it invites a second, unvalidated preference behind
     * the first.
     */
    notifications_muted: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: VALIDATION.nameRequired });

export type ParticipantPatchInput = z.infer<typeof ParticipantPatchSchema>;

/** The wire shapes the server returns. */

export interface EventSummary {
  id: string;
  title: string;
  status: EventStatus;
  activity_type: ActivityType | null;
  date_window_start: string;
  date_window_end: string;
  voting_deadline: string | null;
  participant_count: number;
  /** Whether the caller still owes a vote — drives S1's attention badge. */
  has_pending_vote: boolean;
  created_at: string;
}

export interface ParticipantSummary {
  id: string;
  event_id: string;
  display_name: string;
  role: 'organizer' | 'member';
  has_start_point: boolean;
  max_travel_minutes: number;
  modes: TransportModeToken[];
  visibility: 'private' | 'event';
  /**
   * The stored mute preference (migration 018, FR-6.19).
   *
   * Echoed so a client renders the switch from what was SAVED rather than from
   * what it hoped: the toggle's optimistic flip is reverted on a rejected write,
   * and the next read must agree with the server rather than with the tap.
   */
  notifications_muted: boolean;
}

/**
 * The one-time invite payload. The URL is never retrievable again.
 *
 * It carries no separate token field: the plaintext exists in exactly one place
 * on the wire, so there is one place a log could ever capture it.
 */
export interface InviteIssue {
  url: string;
  expires_at: string;
}

export interface InviteResolution {
  event_id: string;
  title: string;
  status: EventStatus;
  participant_count: number;
}

export interface JoinResult {
  participant: ParticipantSummary;
  event: InviteResolution;
  /** True when this call created the participant (false on a re-join). */
  created: boolean;
}
