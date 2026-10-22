/**
 * The Decision Card, built from the decision ROW (Plan 07 Task 9, PRD-02 §13.5).
 *
 * ★ "WHAT DID WE DECIDE?" MUST HAVE EXACTLY ONE ANSWER.
 *
 * So the card is assembled from the confirmed `decision` row and the proposal it
 * points at — never from per-user derived state, never from a per-viewer
 * re-ranking, never from an optimistic ordering. Two participants on two devices
 * run this same pure function over the same row and get byte-identical content
 * (AC-2.5.1, AC-12.3.1).
 *
 * ★ ONLY THE TRAVEL LINE IS VIEWER-SPECIFIC, AND IT IS ADDITIVE.
 *
 * `viewerTrip` is appended to the card; it never replaces or reorders anything
 * the group sees. That is what keeps the identity property true while still
 * telling each person how long the journey is for them.
 *
 * ★ THE REASON IS A TEMPLATE, RENDERED PER LOCALE.
 *
 * The row stores `reason_template` + `reason_params`. Rendering happens in
 * `renderReason` at display time, so switching language changes the wording and
 * the digits and changes nothing about the venue, the time or the attendee list.
 */

import { formatDate } from '@/src/lib/format';
import { digits } from '@/src/lib/format';
import type { Reason } from '@/src/engine/types';
import type { Language } from '@/src/i18n/types';
import type { Proposal } from '@/src/types/proposal';
import type { DecisionAxis } from '@/src/types/vote';

import type { WireDecision, WireParticipant } from './voting-api';

/** One attendee, with their RSVP when they have given one. */
export interface CardAttendee {
  name: string;
  rsvp: 'going' | 'maybe' | 'cannot' | null;
}

/**
 * The card's content.
 *
 * Every field here is identical for every participant except `viewerTrip`.
 */
export interface DecisionCard {
  axis: DecisionAxis;
  /** Data, never translated — a venue's name is its name in any language. */
  venueName: string;
  venueAddress: string | null;
  /** `null` for a time-only decision. */
  startUtc: string | null;
  endUtc: string | null;
  /** Jalali in `fa`, Gregorian in `en`. */
  datePrimary: string;
  /** The other calendar, always present (PRD-03 §3.2). */
  dateSecondary: string;
  /** The time range in the event's zone, `19:00–21:00`. */
  timeRange: string | null;
  lens: string;
  /** A template plus params — rendered by `renderReason` at display time. */
  reason: Reason;
  attendees: CardAttendee[];
  going: number;
  maybe: number;
  /** The decision's own row identity, for a stable React key and a share URL. */
  decisionId: string;
}

/** The viewer's own line. The only per-participant field on the screen. */
export interface ViewerTrip {
  minutes: number | null;
  mode: string | null;
}

/** Formats `19:00–21:00` in a zone, with the locale's digits. */
function timeRangeIn(
  startUtc: string | null,
  endUtc: string | null,
  timeZone: string,
  locale: Language,
): string | null {
  if (!startUtc) return null;

  const format = (iso: string): string => {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
    // `en-GB` already gives 24-hour, but a narrow ICU may still emit a
    // narrow no-break space; normalise so two devices agree byte for byte.
    return formatted.replace(/\u202f|\u2009/g, '').trim();
  };

  const start = format(startUtc);
  if (!endUtc) return digits(start, locale);

  return digits(`${start}–${format(endUtc)}`, locale);
}

export interface BuildCardInput {
  decision: WireDecision;
  /** The proposal the decision points at. `null` when it was withdrawn. */
  proposal: Proposal | null;
  participants: WireParticipant[];
  homeTz: string;
  locale: Language;
  /** RSVPs by participant id. Absent until Phase 10 wires them. */
  rsvps?: Record<string, 'going' | 'maybe' | 'cannot'>;
}

/**
 * Assembles the card. Pure: same inputs, same output, on every device.
 */
export function buildDecisionCard({
  decision,
  proposal,
  participants,
  homeTz,
  locale,
  rsvps = {},
}: BuildCardInput): DecisionCard {
  const startUtc = proposal?.start_utc ?? null;
  const endUtc = proposal?.end_utc ?? null;

  // `formatDate` returns both calendars: Jalali primary with a Gregorian
  // secondary in `fa`, and the reverse in `en`. Both stay readable either way.
  const date =
    startUtc !== null
      ? formatDate(startUtc, locale)
      : { primary: '', secondary: '' };

  const attendees: CardAttendee[] = participants.map((participant) => ({
    name: participant.display_name,
    rsvp: rsvps[participant.id] ?? null,
  }));

  // ★ THE ATTENDEE LIST IS IN JOIN ORDER, WHICH EVERY DEVICE SHARES.
  //
  // The payload already arrives ordered by `joined_at`; re-sorting here by name
  // would be a second ordering rule, and two rules is how two devices come to
  // disagree about the same row.
  return {
    axis: decision.axis,
    venueName: proposal?.venue?.name ?? proposal?.title ?? '',
    venueAddress: proposal?.venue?.address ?? null,
    startUtc,
    endUtc,
    datePrimary: date.primary,
    dateSecondary: date.secondary,
    timeRange: timeRangeIn(startUtc, endUtc, homeTz, locale),
    lens: decision.lens,
    reason: {
      // The row stores a template id; `renderReason` falls back gracefully on
      // an id this build does not know (it logs and shows `reason.unknownTemplate`)
      // rather than throwing, so the cast is the contract, not a trust assumption.
      templateId: decision.reason_template as Reason['templateId'],
      params: decision.reason_params as Reason['params'],
    },
    attendees,
    going: attendees.filter((attendee) => attendee.rsvp === 'going').length,
    maybe: attendees.filter((attendee) => attendee.rsvp === 'maybe').length,
    decisionId: decision.id,
  };
}

/**
 * The card's content with the personal line REMOVED.
 *
 * This is what the byte-identity test compares: everything except
 * `viewerTrip`. Exported rather than open-coded in the test so the definition of
 * "what everyone sees" lives beside the definition of what the card is.
 */
export function sharedCardContent(card: DecisionCard): string {
  return JSON.stringify({
    axis: card.axis,
    venueName: card.venueName,
    venueAddress: card.venueAddress,
    startUtc: card.startUtc,
    endUtc: card.endUtc,
    datePrimary: card.datePrimary,
    dateSecondary: card.dateSecondary,
    timeRange: card.timeRange,
    lens: card.lens,
    reason: card.reason,
    attendees: card.attendees,
    going: card.going,
    maybe: card.maybe,
    decisionId: card.decisionId,
  });
}
