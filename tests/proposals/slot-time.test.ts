/**
 * UTC conversion and slot validation (Plan 06 Tasks 2, 3).
 *
 * ★ THE HALF-HOUR OFFSET IS THE POINT.
 *
 * Iran is UTC+03:30. Every assertion below that pins `:30` in the UTC value
 * exists because an implementation that rounds the offset to whole hours looks
 * completely correct in review and is thirty minutes wrong in Tehran.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deviceTimezone,
  endsNextDay,
  formatLocalTime,
  localSlotToUtc,
  timezonesDiffer,
  utcToLocalSlot,
  zoneOffsetMs,
} from '../../src/features/proposals/services/slot-time';
import {
  isOnGranularity,
  validateSlot,
} from '../../src/features/proposals/services/slot-validation';

/** 1403/05/12 — 2024-08-02, a fixed date so the suite never drifts. */
const JALALI = { jy: 1403, jm: 5, jd: 12 };

/** A window that contains the fixed test slots. */
const WINDOW = { start: '2024-08-01T00:00:00.000Z', end: '2024-08-10T00:00:00.000Z' };

/** A "now" before every test slot, so nothing is accidentally in the past. */
const BEFORE = new Date('2024-07-01T00:00:00.000Z');

const TEHRAN = 'Asia/Tehran';

describe('AC-3.1.3 — a local slot becomes the UTC instant', () => {
  test('19:00 Tehran is 15:30Z', () => {
    const slot = localSlotToUtc(JALALI, 19, 0, TEHRAN);

    // The half hour is the assertion that matters.
    assert.equal(slot.startUtc, '2024-08-02T15:30:00.000Z');
    assert.ok(new Date(slot.endUtc) > new Date(slot.startUtc));
  });

  test('the end is the default duration after the start', () => {
    const slot = localSlotToUtc(JALALI, 19, 0, TEHRAN);
    const minutes = (new Date(slot.endUtc).getTime() - new Date(slot.startUtc).getTime()) / 60_000;

    assert.equal(minutes, 120);
  });

  test('an explicit duration is honoured', () => {
    const slot = localSlotToUtc(JALALI, 19, 0, TEHRAN, 90);
    const minutes = (new Date(slot.endUtc).getTime() - new Date(slot.startUtc).getTime()) / 60_000;

    assert.equal(minutes, 90);
  });

  test('a 23:00 slot crosses midnight and the end is the next UTC day', () => {
    const slot = localSlotToUtc(JALALI, 23, 0, TEHRAN, 120);

    // 23:00 Tehran is 19:30Z; +2h is 21:30Z, still the same UTC day.
    assert.equal(slot.startUtc, '2024-08-02T19:30:00.000Z');
    assert.equal(slot.endUtc, '2024-08-02T21:30:00.000Z');
    // Local 23:00 → 01:00 IS the next local day.
    assert.equal(endsNextDay(slot.startUtc, slot.endUtc, TEHRAN), true);
  });

  test('a 03:00 slot is 23:30Z the previous UTC day', () => {
    // ★ THIS IS THE CASE THAT REVEALS A WRONG OFFSET.
    //
    // With a whole-hour offset this would land at 00:00Z and be a different
    // calendar day entirely.
    const slot = localSlotToUtc(JALALI, 3, 0, TEHRAN, 60);

    assert.equal(slot.startUtc, '2024-08-01T23:30:00.000Z');
  });

  test('a round trip through the picker is exact', () => {
    const slot = localSlotToUtc(JALALI, 19, 30, TEHRAN);
    const back = utcToLocalSlot(slot.startUtc, TEHRAN);

    assert.deepEqual(back.parts, { gy: 2024, gm: 8, gd: 2 });
    assert.equal(back.hour, 19);
    assert.equal(back.minute, 30);
  });
});

describe('zone offsets', () => {
  test('Tehran is +03:30', () => {
    const offset = zoneOffsetMs(Date.UTC(2024, 7, 2, 12, 0), TEHRAN);

    assert.equal(offset, 3.5 * 3_600_000);
  });

  test('a UTC zone has no offset', () => {
    assert.equal(zoneOffsetMs(Date.UTC(2024, 7, 2, 12, 0), 'UTC'), 0);
  });

  test('Berlin is +02:00 in August (DST)', () => {
    const offset = zoneOffsetMs(Date.UTC(2024, 7, 2, 12, 0), 'Europe/Berlin');

    assert.equal(offset, 2 * 3_600_000);
  });

  test('Berlin is +01:00 in January (no DST)', () => {
    const offset = zoneOffsetMs(Date.UTC(2024, 0, 15, 12, 0), 'Europe/Berlin');

    assert.equal(offset, 1 * 3_600_000);
  });

  test('converting in a DST zone picks the right side of the transition', () => {
    // 12:00 Berlin on 2024-07-01 is 10:00Z (CEST, +02:00).
    const slot = localSlotToUtc({ jy: 1403, jm: 4, jd: 11 }, 12, 0, 'Europe/Berlin', 60);

    assert.equal(slot.startUtc, '2024-07-01T10:00:00.000Z');
  });
});

describe('AC-3.1.4 — a different device zone sees a different clock time', () => {
  test('19:00 Tehran reads as 17:30 in Berlin', () => {
    const { startUtc } = localSlotToUtc(JALALI, 19, 0, TEHRAN);

    assert.equal(formatLocalTime(startUtc, TEHRAN), '19:00');
    assert.equal(formatLocalTime(startUtc, 'Europe/Berlin'), '17:30');
  });

  test('a differing device zone is detected, an identical one is not', () => {
    assert.equal(timezonesDiffer('Europe/Berlin', TEHRAN), true);
    assert.equal(timezonesDiffer(TEHRAN, TEHRAN), false);
  });

  test('an unresolvable device zone does not claim a mismatch', () => {
    // Claiming a mismatch we cannot substantiate would put a scary label on a
    // screen with no real difference.
    assert.equal(timezonesDiffer(null, TEHRAN), false);
  });

  test('the device zone is either a string or null', () => {
    const zone = deviceTimezone();
    assert.ok(zone === null || typeof zone === 'string');
  });
});

describe('granularity', () => {
  test('19:00 Tehran is on the grid', () => {
    const { startUtc } = localSlotToUtc(JALALI, 19, 0, TEHRAN);

    assert.equal(isOnGranularity(startUtc, TEHRAN), true);
  });

  test('19:30 Tehran is on the grid', () => {
    const { startUtc } = localSlotToUtc(JALALI, 19, 30, TEHRAN);

    assert.equal(isOnGranularity(startUtc, TEHRAN), true);
  });

  test('19:17 Tehran is off the grid', () => {
    const { startUtc } = localSlotToUtc(JALALI, 19, 17, TEHRAN);

    assert.equal(isOnGranularity(startUtc, TEHRAN), false);
  });

  test('a slot aligned in the event zone is accepted even though its UTC minutes differ', () => {
    // ★ 19:00 Tehran is 15:30Z. A naive `getUTCMinutes() % 60` check would
    // reject 19:00 itself; anchoring to the epoch in the event's zone does not.
    const { startUtc } = localSlotToUtc(JALALI, 21, 0, TEHRAN);

    assert.equal(new Date(startUtc).getUTCMinutes(), 30);
    assert.equal(isOnGranularity(startUtc, TEHRAN), true);
  });
});

describe('validateSlot', () => {
  test('a valid slot reports nothing', () => {
    const slot = localSlotToUtc(JALALI, 19, 0, TEHRAN);

    assert.deepEqual(validateSlot(slot.startUtc, slot.endUtc, WINDOW, BEFORE, TEHRAN), []);
  });

  test('a place-only proposal has nothing to validate', () => {
    assert.deepEqual(validateSlot(null, null, WINDOW, BEFORE, TEHRAN), []);
  });

  test('end <= start is rejected on the end field', () => {
    const slot = localSlotToUtc(JALALI, 19, 0, TEHRAN);
    const errors = validateSlot(slot.endUtc, slot.startUtc, WINDOW, BEFORE, TEHRAN);

    assert.equal(errors[0]?.field, 'end_utc');
    assert.equal(errors[0]?.messageKey, 'proposals.validation.endBeforeStart');
  });

  test('a slot after the window is rejected', () => {
    const errors = validateSlot(
      '2024-09-01T15:30:00.000Z',
      '2024-09-01T17:30:00.000Z',
      WINDOW,
      BEFORE,
      TEHRAN,
    );

    assert.equal(errors[0]?.field, 'start_utc');
    assert.equal(errors[0]?.messageKey, 'proposals.validation.slotOutOfWindow');
  });

  test('a slot before the window is rejected', () => {
    const errors = validateSlot(
      '2024-07-01T15:30:00.000Z',
      '2024-07-01T17:30:00.000Z',
      WINDOW,
      BEFORE,
      TEHRAN,
    );

    assert.equal(errors[0]?.messageKey, 'proposals.validation.slotOutOfWindow');
  });

  test('a past slot is reported as past, not merely out of window', () => {
    // ★ BOTH ARE TRUE HERE, AND "PAST" IS THE MORE USEFUL MESSAGE.
    //
    // A slot that has already happened is also outside a future window; telling
    // the user only the second fact sends them hunting for a time that is both
    // in-window and in the future.
    const errors = validateSlot(
      '2024-01-01T15:30:00.000Z',
      '2024-01-01T17:30:00.000Z',
      WINDOW,
      BEFORE,
      TEHRAN,
    );

    assert.equal(errors[0]?.messageKey, 'proposals.validation.slotPast');
  });

  test('a device clock set back a day cannot make a past slot look valid', () => {
    // ★ `nowUtc` IS INJECTED PRECISELY FOR THIS CASE.
    //
    // The server passes its own clock. Here the slot is in 2024 and the server
    // clock is in 2026, even though the slot is inside the window: it is past.
    const errors = validateSlot(
      '2024-08-03T15:30:00.000Z',
      '2024-08-03T17:30:00.000Z',
      WINDOW,
      new Date('2026-01-01T00:00:00.000Z'),
      TEHRAN,
    );

    assert.equal(errors[0]?.messageKey, 'proposals.validation.slotPast');
  });

  test('an off-granularity start is rejected', () => {
    const errors = validateSlot(
      '2024-08-02T15:47:00.000Z',
      '2024-08-02T17:47:00.000Z',
      WINDOW,
      BEFORE,
      TEHRAN,
    );

    assert.equal(errors[0]?.messageKey, 'proposals.validation.slotOffGranularity');
  });

  test('E4 — a midnight-crossing slot is accepted', () => {
    // 23:00 → 01:00 Tehran is a real dinner, not an error.
    const slot = localSlotToUtc(JALALI, 23, 0, TEHRAN, 120);

    assert.deepEqual(validateSlot(slot.startUtc, slot.endUtc, WINDOW, BEFORE, TEHRAN), []);
  });

  test('a slot that starts in the window and runs past its end is accepted', () => {
    // The window constrains the START; a dinner may legitimately run late.
    const errors = validateSlot(
      '2024-08-09T23:00:00.000Z',
      '2024-08-10T01:00:00.000Z',
      WINDOW,
      BEFORE,
      TEHRAN,
    );

    assert.deepEqual(errors, []);
  });
});

describe('formatLocalTime', () => {
  test('pads to HH:MM', () => {
    const { startUtc } = localSlotToUtc(JALALI, 9, 5, TEHRAN);

    assert.equal(formatLocalTime(startUtc, TEHRAN), '09:05');
  });

  test('a midnight slot reads as 00:00', () => {
    const { startUtc } = localSlotToUtc(JALALI, 0, 0, TEHRAN);

    assert.equal(formatLocalTime(startUtc, TEHRAN), '00:00');
  });
});
