import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatGregorian,
  formatJalali,
  isLeapYear,
  jalaliMonthLength,
  persianMonthName,
  toLatinDigits,
  toPersianDigits,
  weekdayIndex,
  weekdayName,
} from '@/src/lib/jalali';
import { digits, formatDate, formatNumber, renderReason } from '@/src/lib/format';
import { initI18n } from '@/src/i18n';

initI18n('fa');

test('formats a Gregorian date as Jalali with Persian digits', () => {
  // Arrange
  const date = '2024-08-02T12:00:00Z';

  // Act
  const out = formatJalali(date, 'fa');

  // Assert
  assert.equal(out, '۱۴۰۳/۰۵/۱۲');
});

test('formats a Jalali date with Latin digits for the English locale', () => {
  // Arrange
  const date = '2024-08-02T12:00:00Z';

  // Act
  const out = formatJalali(date, 'en');

  // Assert
  assert.equal(out, '1403/05/12');
});

test('handles Esfand 30 in a leap year', () => {
  // Arrange: 1403 is a Jalali leap year, so Esfand has 30 days
  const esfand30 = '2025-03-20T12:00:00Z';

  // Act
  const out = formatJalali(esfand30, 'fa');

  // Assert
  assert.equal(out, '۱۴۰۳/۱۲/۳۰');
});

test('handles Esfand 29 in a common year', () => {
  // Arrange: 1404 is not a leap year, so Esfand has 29 days
  const esfand29 = '2026-03-20T12:00:00Z';

  // Act
  const out = formatJalali(esfand29, 'fa');

  // Assert
  assert.equal(out, '۱۴۰۴/۱۲/۲۹');
});

test('crosses the Jalali year boundary', () => {
  // Arrange: 1403 is a leap year, so Esfand has 30 days and 1403/12/30 is
  // the last day of the year. The next day is 1404/01/01.
  const lastDay = '2025-03-20T12:00:00Z';
  const firstDay = '2025-03-21T12:00:00Z';

  // Act / Assert
  assert.equal(formatJalali(lastDay, 'en'), '1403/12/30');
  assert.equal(formatJalali(firstDay, 'en'), '1404/01/01');
});

test('reports the Jalali month length for Esfand in leap and common years', () => {
  // Act / Assert
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.equal(isLeapYear(1403), true);
  assert.equal(isLeapYear(1404), false);
});

test('does not shift the Jalali day when the instant is near UTC midnight', () => {
  // Arrange: 20:30Z is 00:00 the next day in Tehran (UTC+03:30).
  // The conversion must use the event's own day, not the device's offset.
  const nearMidnightUtc = '2024-08-02T20:30:00Z';

  // Act
  const out = formatJalali(nearMidnightUtc, 'en');

  // Assert — still 12 Mordad 1403, not the 13th
  assert.equal(out, '1403/05/12');
});

test('converts Latin digits to Persian digits', () => {
  // Act / Assert
  assert.equal(toPersianDigits('1403/05/12'), '۱۴۰۳/۰۵/۱۲');
});

test('converts a mixed string of Latin digits', () => {
  // Act / Assert
  assert.equal(toPersianDigits('19:00'), '۱۹:۰۰');
});

test('converts Persian digits back to Latin digits', () => {
  // Act / Assert
  assert.equal(toLatinDigits('۱۹:۰۰'), '19:00');
});

test('returns Saturday as weekday 0 in the fa locale', () => {
  // Arrange: 2024-08-03 is a Saturday
  const saturday = '2024-08-03T12:00:00Z';

  // Act / Assert
  assert.equal(weekdayIndex(saturday, 'fa'), 0);
});

test('returns Monday as weekday 0 in the en locale', () => {
  // Arrange: 2024-08-05 is a Monday
  const monday = '2024-08-05T12:00:00Z';

  // Act / Assert
  assert.equal(weekdayIndex(monday, 'en'), 0);
});

test('returns the Persian weekday name for a Saturday', () => {
  // Act / Assert
  assert.equal(weekdayName('2024-08-03T12:00:00Z', 'fa'), 'شنبه');
});

test('returns the Persian month name for a date in Mordad', () => {
  // Act / Assert
  assert.equal(persianMonthName('2024-08-02T12:00:00Z'), 'مرداد');
});

test('formats a Gregorian date with Latin digits in both locales', () => {
  // Act / Assert
  assert.equal(formatGregorian('2024-08-02T12:00:00Z'), '2024-08-02');
});

test('throws on an invalid date rather than rendering garbage', () => {
  // Act / Assert
  assert.throws(() => formatJalali('not-a-date', 'fa'), RangeError);
});

test('renders digits in the locale digit set', () => {
  // Act / Assert
  assert.equal(digits(18, 'en'), '18');
  assert.equal(digits(18, 'fa'), '۱۸');
});

test('renders a number with locale-aware thousands separators', () => {
  // Act / Assert
  assert.equal(formatNumber(142000, 'en'), '142,000');
  assert.equal(formatNumber(142000, 'fa'), '۱۴۲٬۰۰۰');
});

test('formats a date with Jalali primary and Gregorian secondary in fa', () => {
  // Act
  const out = formatDate('2024-08-02T12:00:00Z', 'fa');

  // Assert
  assert.equal(out.primary, '۱۴۰۳/۰۵/۱۲');
  assert.equal(out.secondary, '2024-08-02');
});

test('formats a date with Gregorian primary and Jalali secondary in en', () => {
  // Act
  const out = formatDate('2024-08-02T12:00:00Z', 'en');

  // Assert
  assert.equal(out.primary, '2024-08-02');
  assert.equal(out.secondary, '1403/05/12');
});

test('renders a reason in Persian with Persian digits', () => {
  // Act
  const out = renderReason({ templateId: 'balanced_floor', params: { floorMinutes: 18 } }, 'fa');

  // Assert
  assert.match(out, /۱۸/);
  assert.match(out, /متعادل/);
});

test('renders a reason in English with Latin digits', () => {
  // Act
  const out = renderReason({ templateId: 'balanced_floor', params: { floorMinutes: 18 } }, 'en');

  // Assert
  assert.match(out, /18/);
  assert.match(out, /Balanced/);
});

test('renders a nested reason modifier', () => {
  // Act
  const out = renderReason(
    {
      templateId: 'with_coverage_gap',
      params: {
        base: { templateId: 'fastest_total', params: { totalMinutes: 96 } },
        n: 2,
      },
    },
    'en',
  );

  // Assert
  assert.match(out, /Fastest: 96 minutes/);
  assert.match(out, /2 people/);
});

test('falls back without throwing when the reason template is unknown', () => {
  // Act
  const out = renderReason({ templateId: 'nope', params: {} }, 'fa');

  // Assert
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});
