/**
 * The opening-hours advisory (Plan 14 Task 6, PRD-03 FR-3.13, AC-3.3.1, E9).
 *
 * ★ THE TWO ASSERTIONS THAT MATTER.
 *
 * 1. `openingHours === null` renders `«نامشخص»`. Absence of hours is not
 *    "closed" and must never imply "open" — that is TC-7 and ROADMAP §8.3, and
 *    it is the rule an honest UI gets wrong by rendering an empty string.
 * 2. The advisory is NEVER blocking (AC-3.3.1). This module returns a verdict
 *    and nothing else: no throw, no `false`, no disabled state. The tests below
 *    pin that by asserting a closed verdict is still a perfectly good value to
 *    render — the caller carries on and the slot stays votable.
 *
 * ★ TEHRAN IS UTC+03:30, WHICH IS WHY THE CLOCK IS TESTED EXPLICITLY.
 *
 * A test written against `getHours()` would pass in Tehran and fail in CI, and
 * `19:00` local is `15:30Z` — a half-hour offset that a naive hour comparison
 * gets wrong in a way that looks like an off-by-one.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { closedBlocks } from '../../src/engine/filters';
import {
  ADVISORY_KEY_BY_VERDICT,
  advisoryKeyForProposal,
  localClock,
  openingHoursAdvisory,
  parseClock,
} from '../../src/features/proposals/services/opening-hours';
import type { VenueContext } from '../../src/engine/types';
import en from '../../src/i18n/en.json';
import fa from '../../src/i18n/fa.json';

/** Monday 2026-08-03, 19:00 Tehran (15:30Z) — inside the common 12:00–23:30. */
const MON_1900_TEHRAN = new Date('2026-08-03T15:30:00Z');

const WEEKDAY_HOURS = { mon: ['12:00', '23:30'], tue: ['12:00', '23:30'] } as const;

describe('E9 / TC-7 — absence of hours is unknown, never closed', () => {
  test('null hours resolve to unknown', () => {
    const verdict = openingHoursAdvisory(null, MON_1900_TEHRAN, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'unknown');
    assert.equal(verdict.hours, null);
  });

  test('undefined hours resolve to unknown', () => {
    assert.equal(
      openingHoursAdvisory(undefined, MON_1900_TEHRAN, 'Asia/Tehran').advisory,
      'unknown',
    );
  });

  test('an unreadable jsonb shape resolves to unknown, not closed', () => {
    // A provider that changed its payload shape must not start telling users
    // their venue is shut.
    for (const shape of ['closed', 42, [], {}, { mon: 'all day' }, { xx: ['09:00', '23:00'] }]) {
      assert.equal(
        openingHoursAdvisory(shape, MON_1900_TEHRAN, 'Asia/Tehran').advisory,
        'unknown',
        `shape ${JSON.stringify(shape)} should be unknown`,
      );
    }
  });

  test('the unknown verdict renders the catalogue word, not a blank', () => {
    const key = advisoryKeyForProposal(null, MON_1900_TEHRAN.toISOString(), 'Asia/Tehran');

    assert.equal(key, 'slots.advisoryUnknown');
    // The word itself is asserted in the catalogue test below; here the point
    // is that a key came back at all. A blank string would read as "open".
    assert.ok(key.length > 0);
  });

  test('a venue with hours but not for this day is unknown, not closed', () => {
    const mondayOnly = { mon: ['12:00', '23:30'] };
    // Tuesday 19:00 Tehran
    const tuesday = new Date('2026-08-04T15:30:00Z');

    const verdict = openingHoursAdvisory(mondayOnly, tuesday, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'unknown');
  });
});

describe('AC-3.3.1 — the advisory reports, and never blocks', () => {
  test('a time inside the published hours is open', () => {
    const verdict = openingHoursAdvisory(WEEKDAY_HOURS, MON_1900_TEHRAN, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'open');
    assert.deepEqual(verdict.hours, { open: '12:00', close: '23:30' });
  });

  test('a time after closing is closed, and still returns a renderable verdict', () => {
    // 23:45 Tehran — fifteen minutes past the 23:30 close.
    const late = new Date('2026-08-03T20:15:00Z');

    const verdict = openingHoursAdvisory(WEEKDAY_HOURS, late, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'closed');
    // ★ AC-3.3.1: closed is a STRING TO RENDER, not a refusal. The caller has
    // a catalogue key and no reason to disable anything.
    assert.equal(ADVISORY_KEY_BY_VERDICT[verdict.advisory], 'slots.advisoryClosed');
  });

  test('a closed verdict carries the hours it checked', () => {
    const early = new Date('2026-08-03T06:00:00Z'); // 09:30 Tehran
    const verdict = openingHoursAdvisory(WEEKDAY_HOURS, early, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'closed');
    assert.deepEqual(verdict.hours, { open: '12:00', close: '23:30' });
  });

  test('a midnight-crossing window is open on both sides of midnight', () => {
    const hours = { mon: ['18:00', '02:00'], tue: ['18:00', '02:00'] };

    // Monday 23:00 Tehran, before midnight.
    const beforeMidnight = new Date('2026-08-03T19:30:00Z');
    // Monday 01:00 Tehran — which is still Monday's window.
    const afterMidnight = new Date('2026-08-03T21:30:00Z');

    assert.equal(
      openingHoursAdvisory(hours, beforeMidnight, 'Asia/Tehran').advisory,
      'open',
    );
    assert.equal(
      openingHoursAdvisory(hours, afterMidnight, 'Asia/Tehran').advisory,
      'open',
    );
  });

  test('the opening minute is open and the closing minute is not', () => {
    assert.equal(
      openingHoursAdvisory(WEEKDAY_HOURS, new Date('2026-08-03T08:30:00Z'), 'Asia/Tehran')
        .advisory,
      'open',
      '12:00 Tehran is open',
    );
    assert.equal(
      openingHoursAdvisory(WEEKDAY_HOURS, new Date('2026-08-03T20:00:00Z'), 'Asia/Tehran')
        .advisory,
      'closed',
      '23:30 Tehran is closed',
    );
  });
});

describe('the advisory agrees with the engine on what unknown means', () => {
  test('both treat absent hours as no closure', () => {
    const venue = { openingHours: null } as VenueContext;

    // The engine applies no closure ...
    assert.equal(closedBlocks(venue, 19), false);
    // ... and the advisory says "unknown", not "closed".
    assert.equal(
      openingHoursAdvisory(null, MON_1900_TEHRAN, 'Asia/Tehran').advisory,
      'unknown',
    );
  });

  test('the engine shape is accepted, so a converted caller is not silently unknown', () => {
    // `src/engine/types.ts` OpeningHours: open 12, close 23.
    const verdict = openingHoursAdvisory({ open: 12, close: 23 }, MON_1900_TEHRAN, 'Asia/Tehran');

    assert.equal(verdict.advisory, 'open');
    assert.deepEqual(verdict.hours, { open: '12:00', close: '23:00' });
  });

  test('the advisory and the engine agree on a closed hour', () => {
    const engineHours = { open: 12, close: 23 };
    const atTen = new Date('2026-08-03T06:30:00Z'); // 10:00 Tehran

    assert.equal(
      closedBlocks({ openingHours: engineHours } as VenueContext, 10),
      true,
      'the engine excludes 10:00',
    );
    assert.equal(
      openingHoursAdvisory(engineHours, atTen, 'Asia/Tehran').advisory,
      'closed',
      'the advisory warns at 10:00',
    );
  });
});

describe('clock handling', () => {
  test('parseClock reads the stored forms and rejects nonsense', () => {
    assert.equal(parseClock('09:00'), 9 * 60);
    assert.equal(parseClock('9:00'), 9 * 60);
    assert.equal(parseClock('23:30'), 23 * 60 + 30);
    assert.equal(parseClock('24:00'), 24 * 60);
    assert.equal(parseClock('24:30'), null);
    assert.equal(parseClock('09:60'), null);
    assert.equal(parseClock('25:00'), null);
    assert.equal(parseClock('all day'), null);
    assert.equal(parseClock(null), null);
  });

  test('localClock reads the event zone, not the device zone', () => {
    const clock = localClock(MON_1900_TEHRAN, 'Asia/Tehran');

    assert.equal(clock.minutes, 19 * 60);
    assert.equal(clock.day, 'mon');
  });

  test('the same instant is a different local clock in another zone', () => {
    // 15:30Z is 19:00 in Tehran and 11:30 in New York.
    assert.equal(localClock(MON_1900_TEHRAN, 'Asia/Tehran').minutes, 19 * 60);
    assert.equal(localClock(MON_1900_TEHRAN, 'America/New_York').minutes, 11 * 60 + 30);
  });

  test('midnight reads as 00:00, not 24:00', () => {
    const midnightTehran = new Date('2026-08-03T20:30:00Z');

    assert.equal(localClock(midnightTehran, 'Asia/Tehran').minutes, 0);
  });
});

describe('the catalogue carries the advisory keys', () => {
  test('every verdict has a key and both catalogues define it', () => {
    for (const key of Object.values(ADVISORY_KEY_BY_VERDICT)) {
      // The whole dotted path, INCLUDING the `slots` namespace — dropping the
      // first segment would look up `advisoryOpen` at the top level and always
      // miss.
      const path = key.split('.');

      const lookup = (catalogue: unknown): unknown =>
        path.reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === 'object'
              ? (node as Record<string, unknown>)[part]
              : undefined,
          catalogue,
        );

      assert.equal(typeof lookup(fa), 'string', `${key} is missing from fa.json`);
      assert.equal(typeof lookup(en), 'string', `${key} is missing from en.json`);
    }
  });

  test('the unknown word is نامشخص, exactly', () => {
    // AC-3.3.1 / ROADMAP §8.3 name this word. A synonym would be a different
    // product decision, not an implementation detail.
    assert.equal(fa.slots.advisoryUnknown, 'نامشخص');
  });
});
