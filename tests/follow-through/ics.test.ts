/**
 * The `.ics` generator (Plan 10 Task 9, AC-3.4.1, AC-3.4.2).
 *
 * ★ THE PURITY ASSERTION IS THE POINT OF HALF THIS FILE.
 *
 * `AC-3.4.1` says the calendar file is generated client-side with **no network
 * call**. A test that only checked the output shape would pass just as happily
 * against an implementation that fetched a server-rendered file. So the first
 * test installs a tripwire on `fetch` and asserts it is never touched, and the
 * module's import list is what makes that true rather than lucky.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ICS_DURATION_MS,
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
  toIcsUtc,
  type IcsEvent,
} from '../../src/features/follow-through/services/ics';

const NOW = new Date('2026-08-01T09:00:00.000Z');

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    decisionId: '11111111-2222-3333-4444-555555555555',
    title: 'کافه دیدار',
    venueName: 'کافه دیدار',
    startUtc: '2026-08-02T19:00:00.000Z',
    endUtc: '2026-08-02T21:00:00.000Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Purity — AC-3.4.1
// ─────────────────────────────────────────────────────────────

test('AC-3.4.1: generating a .ics makes no network call', () => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (() => {
    calls += 1;
    throw new Error('buildIcs must not perform a network call');
  }) as typeof fetch;

  try {
    const ics = buildIcs(event(), NOW);

    // The output is real, so this is not passing because nothing happened.
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /SUMMARY:کافه دیدار/);
    assert.equal(calls, 0, 'no fetch call may occur while building an .ics');
  } finally {
    globalThis.fetch = original;
  }
});

// ─────────────────────────────────────────────────────────────
// Structure — AC-3.4.2
// ─────────────────────────────────────────────────────────────

test('a valid VCALENDAR carries title, start, end and location', () => {
  const ics = buildIcs(event({ venueAddress: 'خیابان ولیعصر، پلاک ۱۲' }), NOW);


  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'starts with BEGIN:VCALENDAR');
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'), 'ends with END:VCALENDAR');

  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /END:VEVENT\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /PRODID:-\/\/FreeWhen/);
  assert.match(ics, /UID:11111111-2222-3333-4444-555555555555@freewhen/);

  assert.match(ics, /DTSTART:20260802T190000Z/);
  assert.match(ics, /DTEND:20260802T210000Z/);
  assert.match(ics, /DTSTAMP:20260801T090000Z/);

  // The address arrives with a Persian comma, which RFC 5545 does not treat as
  // a separator — see the escaping tests below for why that is correct.
  assert.match(ics, /LOCATION:کافه دیدار — خیابان ولیعصر، پلاک ۱۲/);
});

test('every line is CRLF-terminated and the file ends with CRLF', () => {
  const ics = buildIcs(event(), NOW);

  assert.ok(ics.endsWith('\r\n'), 'RFC 5545 requires a trailing CRLF');
  // A bare LF that is not part of a CRLF is the classic corruption.
  assert.equal(/(?<!\r)\n/.test(ics), false, 'no LF may appear without a preceding CR');
  assert.equal(ics.includes('\r\r'), false);
});

test('a missing end defaults to one hour rather than an open-ended entry', () => {
  const ics = buildIcs(event({ endUtc: null }), NOW);
  const start = new Date('2026-08-02T19:00:00.000Z');
  const expectedEnd = new Date(start.getTime() + DEFAULT_ICS_DURATION_MS);

  assert.match(ics, new RegExp(`DTEND:${toIcsUtc(expectedEnd)}`));
});

// ─────────────────────────────────────────────────────────────
// Escaping
// ─────────────────────────────────────────────────────────────

test('escaping covers backslash, semicolon, comma and newlines', () => {
  assert.equal(escapeIcsText('a\\b'), 'a\\\\b');
  assert.equal(escapeIcsText('a;b'), 'a\\;b');
  assert.equal(escapeIcsText('a,b'), 'a\\,b');
  assert.equal(escapeIcsText('a\nb'), 'a\\nb');
  assert.equal(escapeIcsText('a\r\nb'), 'a\\nb');
});

test('an ASCII comma in a venue name does not break the file', () => {
  // ★ THE HAZARD IS THE ASCII COMMA (U+002C), NOT THE PERSIAN ONE (U+060C).
  //
  // A venue entered with a Latin name — "Café, Vanak" — carries the separator
  // RFC 5545 uses for multi-valued text. Left unescaped it ends the LOCATION
  // value early and the rest of the name becomes a stray fragment the parser
  // chokes on. The Persian comma is a letter in a different block and is
  // correctly left alone (asserted separately below).
  const ics = buildIcs(event({ venueName: 'Cafe, Vanak' }), NOW);

  assert.match(ics, /LOCATION:Cafe\\, Vanak/);

  const locationLine = ics.split('\r\n').find((line) => line.startsWith('LOCATION:'));
  assert.ok(locationLine);
  // An unescaped comma would mean the parser saw two values in one text field.
  assert.equal(/[^\\],/.test(locationLine.slice('LOCATION:'.length)), false);
});

test('the Persian comma is passed through, because it is not a separator', () => {
  // U+060C is an ordinary character in RFC 5545's grammar. Escaping it would
  // put a literal backslash into the venue name every calendar app displays.
  const ics = buildIcs(event({ venueName: 'کافه دیدار، شعبه مرکزی' }), NOW);

  assert.match(ics, /LOCATION:کافه دیدار، شعبه مرکزی/);
  assert.equal(ics.includes('\\،'), false, 'the Persian comma must not be escaped');
});

test('a backslash in a title is not double-escaped', () => {
  const ics = buildIcs(event({ title: 'C:\\Meet' }), NOW);
  assert.match(ics, /SUMMARY:C:\\\\Meet/);
});

// ─────────────────────────────────────────────────────────────
// Folding
// ─────────────────────────────────────────────────────────────

test('lines fold at 75 octets and continue with a leading space', () => {
  const long = 'ا'.repeat(80);
  const folded = foldIcsLine(`SUMMARY:${long}`);
  const lines = folded.split('\r\n');

  assert.ok(lines.length > 1, 'an 80-character Persian line must fold');

  const encoder = new TextEncoder();
  for (const line of lines) {
    assert.ok(
      encoder.encode(line).length <= 75,
      `every folded line stays within 75 octets, got ${encoder.encode(line).length}`,
    );
  }

  for (const continuation of lines.slice(1)) {
    assert.ok(continuation.startsWith(' '), 'continuations begin with a space');
  }

  // Unfolding restores the original exactly — nothing is lost or reordered.
  const unfolded = lines.map((line, index) => (index === 0 ? line : line.slice(1))).join('');
  assert.equal(unfolded, `SUMMARY:${long}`);
});

test('folding never splits a multi-byte character', () => {
  const folded = foldIcsLine('DESCRIPTION:' + 'ک'.repeat(40));

  // A replacement character means a UTF-8 sequence was cut in half.
  assert.equal(folded.includes('\uFFFD'), false);

  const unfolded = folded
    .split('\r\n')
    .map((line, index) => (index === 0 ? line : line.slice(1)))
    .join('');
  assert.ok(unfolded.endsWith('ک'.repeat(40)));
});

test('a short line is left untouched', () => {
  assert.equal(foldIcsLine('VERSION:2.0'), 'VERSION:2.0');
});

// ─────────────────────────────────────────────────────────────
// Conversion and file naming
// ─────────────────────────────────────────────────────────────

test('toIcsUtc converts to the compact UTC form', () => {
  assert.equal(toIcsUtc('2026-03-21T06:30:00.000Z'), '20260321T063000Z');
  assert.equal(toIcsUtc(new Date('2026-12-31T23:59:59.000Z')), '20261231T235959Z');
});

test('toIcsUtc refuses an unparseable instant instead of writing Invalid Date', () => {
  assert.throws(() => toIcsUtc('not-a-date'), RangeError);
});

test('icsFileName is filesystem safe and keeps Persian letters', () => {
  assert.equal(icsFileName('کافه دیدار'), 'کافه-دیدار.ics');
  assert.equal(icsFileName('  a/b:c*?  '), 'a-b-c.ics');
  assert.equal(icsFileName('   '), 'freewhen.ics');
});
