/**
 * The Jalali month is NAMED, not numbered (Plan 49 T19).
 *
 * ★ "MONTH 8 1405" IS NOT A DATE.
 *
 * The English branch of the date picker built `` `Month ${viewMonth}` `` for the
 * header and fell back to a bare month number in the selected-date line, so a
 * Jalali date read as a month NUMBER. That is meaningless to anyone who does not
 * already know the calendar and visibly wrong to anyone who does — Aban is month
 * eight.
 *
 * ★ THE NAMES ARE TRANSLITERATIONS, NOT TRANSLATIONS.
 *
 * These are the names Persian speakers use for these months in Latin script.
 * Mapping them onto Gregorian month names would be a different calendar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { ENGLISH_MONTHS, monthName } from '@/src/lib/jalali';

test('there are twelve English month names', () => {
  // Act / Assert
  assert.equal(ENGLISH_MONTHS.length, 12);
});

test('month eight is Aban', () => {
  // Arrange / Act — the exact case the request named: "Month 8 1405" is Aban.
  const result = monthName(8, 'en');

  // Assert
  assert.equal(result, 'Aban');
});

test('the first and last months are named', () => {
  // Act / Assert — the boundaries are where an off-by-one shows up.
  assert.equal(monthName(1, 'en'), 'Farvardin');
  assert.equal(monthName(12, 'en'), 'Esfand');
});

test('every month resolves in both locales', () => {
  // Arrange / Act / Assert — an empty string would render as a blank header,
  // which is worse than the number it replaced.
  for (let month = 1; month <= 12; month++) {
    assert.ok(monthName(month, 'en').length > 0, `month ${month} has no English name`);
    assert.ok(monthName(month, 'fa').length > 0, `month ${month} has no Persian name`);
  }
});

test('the Persian locale still returns Persian names', () => {
  // Act / Assert — this fix must not have changed the Persian interface.
  assert.equal(monthName(1, 'fa'), 'فروردین');
  assert.equal(monthName(8, 'fa'), 'آبان');
});

test('an out-of-range month returns empty rather than an exception', () => {
  // Act / Assert — a calendar component rendering a bad month should show
  // nothing, not crash the sheet.
  assert.equal(monthName(0, 'en'), '');
  assert.equal(monthName(13, 'en'), '');
  assert.equal(monthName(-1, 'en'), '');
});

test('the date component no longer builds "Month N"', () => {
  // Arrange
  const component = readFileSync('src/components/ui/DateSelectionComponent.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act / Assert — the literal that produced the reported output.
  assert.ok(!/`Month \$\{/.test(component), 'the component still builds "Month N"');
  assert.ok(/monthName\(/.test(component), 'the component does not use the month-name helper');
});
