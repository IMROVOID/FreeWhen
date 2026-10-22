/**
 * The `.ics` export (Plan 10 Task 9, PRD-03 FR-3.20 / FR-3.21).
 *
 * ★ PURE TRANSFORMATION. ZERO NETWORK CALLS.
 *
 * AC-3.4.1 asserts this file makes no request, and that is not an incidental
 * property to be preserved by care — it is a structural one. Nothing in this
 * module imports `fetch`, `api`, or a React Native module, so there is no
 * transport for it to reach for. A calendar file is a string; producing it needs
 * no server round trip, no external calendar API and no OAuth surface, and
 * adding one later would be a conscious change to this import list rather than
 * an accident.
 *
 * ★ CRLF, AND A TRAILING CRLF (RFC 5545 §3.1).
 *
 * Lines end `\r\n`, including the last one. An LF-only file is rejected by a
 * meaningful share of parsers, and the failure surfaces to the user as a
 * "corrupt" download with no clue what went wrong. `buildIcs` joins on CRLF and
 * appends the empty final element that produces the trailing break.
 *
 * ★ TEXT IS ESCAPED BEFORE IT IS FOLDED.
 *
 * A venue named «کافه دیدار، شعبه ۲» contains a comma, which would otherwise
 * end the `LOCATION` value early and break every field after it. Backslash is
 * escaped first so the escapes this function introduces are not themselves
 * re-escaped.
 *
 * ★ FOLDING IS AT 75 OCTETS, NOT 75 CHARACTERS.
 *
 * RFC 5545 counts octets, and a Persian venue name is two octets per character
 * in UTF-8 — folding by character count would produce lines well over the limit
 * for exactly the names this product is built around. The fold point also never
 * splits a multi-byte sequence, which is why the encoder walks the string rather
 * than slicing the encoded bytes.
 */

/** What the card must supply to produce a calendar entry. */
export interface IcsEvent {
  /** Stable identity, so a re-import updates rather than duplicates. */
  decisionId: string;
  title: string;
  venueName: string;
  /** ISO-8601 UTC instant. */
  startUtc: string;
  /** ISO-8601 UTC instant; `null` gives a one-hour entry. */
  endUtc: string | null;
  description?: string | null;
  /** Where the venue is, when it has an address. */
  venueAddress?: string | null;
}

/** The default duration when a decision carries a start but no end. */
export const DEFAULT_ICS_DURATION_MS = 60 * 60 * 1000;

/** RFC 5545 §3.1 — a content line SHOULD be no longer than 75 octets. */
const MAX_LINE_OCTETS = 75;

/**
 * Escapes a text value (RFC 5545 §3.3.11).
 *
 * Order matters: the backslash replacement runs first, so the `\;` and `\,` it
 * introduces are not escaped again by a later pass.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * `2026-08-02T19:00:00.000Z` → `20260802T190000Z`.
 *
 * Throws on an unparseable instant rather than emitting `Invalid Date` into a
 * file a calendar app will try to import.
 */
export function toIcsUtc(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant for .ics: ${String(instant)}`);
  }

  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** The UTF-8 octet length of one code point. */
function octetsOf(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line onto continuation lines (RFC 5545 §3.1).
 *
 * A continuation is CRLF followed by a single space, and that space is part of
 * the 75-octet budget. The walk is over code points so a two-octet Persian
 * character or a surrogate pair is never cut in half.
 */
export function foldIcsLine(line: string): string {
  const encoded = new TextEncoder().encode(line);
  if (encoded.length <= MAX_LINE_OCTETS) return line;

  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  // The first line has the full budget; continuations spend one octet on the
  // leading space, so they hold 74.
  let budget = MAX_LINE_OCTETS;

  for (const character of line) {
    const size = octetsOf(character.codePointAt(0) ?? 0);

    if (currentOctets + size > budget) {
      out.push(current);
      current = ` ${character}`;
      // The space is counted as part of the continuation line's octets.
      currentOctets = 1 + size;
      budget = MAX_LINE_OCTETS;
      continue;
    }

    current += character;
    currentOctets += size;
  }

  if (current !== '') out.push(current);

  return out.join('\r\n');
}

/**
 * Builds a complete `VCALENDAR` string for one confirmed decision.
 *
 * The returned value is ready to be written to a `.ics` file as-is: it already
 * carries CRLF terminations and its final line ends with one.
 */
export function buildIcs(event: IcsEvent, now: Date = new Date()): string {
  const start = new Date(event.startUtc);
  const end = event.endUtc
    ? new Date(event.endUtc)
    : new Date(start.getTime() + DEFAULT_ICS_DURATION_MS);

  // The location line names the venue and its address when there is one; the
  // address is optional data, not a fallback for a missing name.
  const location = event.venueAddress
    ? `${event.venueName} — ${event.venueAddress}`
    : event.venueName;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FreeWhen//FreeWhen//FA',
    'CALSCALE:GREGORIAN',
    // The method makes the file an invitation-shaped event without an
    // organizer, which is what keeps it importable by every client we target.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.decisionId}@freewhen`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(location)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // Folded per line, then joined: folding a joined string would have to
  // re-split on CRLF and could break a fold across a line boundary.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** A filesystem-safe file name for the download. */
export function icsFileName(title: string): string {
  const safe = title
    .trim()
    // Letters and digits in any script survive; everything a filesystem or a
    // header would object to becomes a hyphen.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${safe === '' ? 'freewhen' : safe}.ics`;
}
