/**
 * Jalali conversion and formatting.
 *
 * `jalaali-js` provides CONVERSION PRIMITIVES ONLY — no formatting, no Persian
 * digits, no month names (PRD-03 §13.2, PRD-10 D12). The formatter is ours.
 *
 * The library's `toJalaali(date)` overload reads the date's LOCAL-TIME
 * components. Iran is UTC+03:30, so a local-time read shifts the Jalali day
 * near midnight. Every conversion here therefore builds its Gregorian
 * components from `getUTC*` and uses the explicit 3-argument overload.
 */

import { isLeapJalaaliYear, toGregorian, toJalaali } from 'jalaali-js';

import type { Language } from '@/src/i18n/types';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Style Guide §3.1 / PRD-03 §6 — Persian month names, Farvardin to Esfand. */
export const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

export const PERSIAN_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
] as const;

/** `Date.getUTCDay()` is 0 for Sunday. Saturday is 0 in the `fa` locale. */
const SATURDAY_UTC_DAY = 6;

/**
 * Converts Latin digits to Persian digits. Non-digit characters pass through
 * unchanged, so a mixed string like `'19:00'` becomes `'۱۹:۰۰'`.
 */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/** Converts Persian digits back to Latin digits. */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d as (typeof PERSIAN_DIGITS)[number])));
}

/** The Gregorian (UTC) calendar components of an instant. */
function utcParts(input: string | Date): { gy: number; gm: number; gd: number } {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${String(input)}`);
  }
  return {
    gy: date.getUTCFullYear(),
    gm: date.getUTCMonth() + 1,
    gd: date.getUTCDate(),
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Formats a date as Jalali — `۱۴۰۳/۰۵/۱۲` in `fa`, `1403/05/12` in `en`.
 * The `en` form keeps the Jalali calendar but uses Latin digits.
 */
export function formatJalali(input: string | Date, locale: Language = 'fa'): string {
  const { gy, gm, gd } = utcParts(input);
  const { jy, jm, jd } = toJalaali(gy, gm, gd);
  const formatted = `${jy}/${pad2(jm)}/${pad2(jd)}`;
  return locale === 'fa' ? toPersianDigits(formatted) : formatted;
}

/**
 * Formats a date as Gregorian — `2026-08-02`. The secondary line always uses
 * Latin digits, in either locale (PRD-03 §3.2).
 */
export function formatGregorian(input: string | Date): string {
  const { gy, gm, gd } = utcParts(input);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

/**
 * The weekday index within the locale's week: **0 = Saturday** in `fa`,
 * **0 = Monday** in `en` (PRD-03 §3.3).
 */
export function weekdayIndex(input: string | Date, locale: Language = 'fa'): number {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${String(input)}`);
  }
  const utcDay = date.getUTCDay();

  if (locale === 'fa') {
    // Shift so Saturday (6) becomes 0.
    return (utcDay - SATURDAY_UTC_DAY + 7) % 7;
  }
  // Monday (1) becomes 0.
  return (utcDay + 6) % 7;
}

/** The Persian month name for an instant. */
export function persianMonthName(input: string | Date): string {
  const { gy, gm, gd } = utcParts(input);
  const { jm } = toJalaali(gy, gm, gd);
  return PERSIAN_MONTHS[jm - 1] ?? '';
}

/** The weekday name for an instant, in the locale's own order. */
export function weekdayName(input: string | Date, locale: Language = 'fa'): string {
  const index = weekdayIndex(input, locale);
  if (locale === 'fa') return PERSIAN_WEEKDAYS[index] ?? '';
  return ENGLISH_WEEKDAYS[index] ?? '';
}

const ENGLISH_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Whether the given Jalali year has 366 days — Esfand then has 30. */
export function isLeapYear(jalaaliYear: number): boolean {
  return isLeapJalaaliYear(jalaaliYear);
}

/** The number of days in a Jalali month — Esfand is 29 or 30 (PRD-03 E8). */
export function jalaliMonthLength(jalaaliYear: number, jalaaliMonth: number): number {
  if (jalaaliMonth <= 6) return 31;
  if (jalaaliMonth <= 11) return 30;
  return isLeapJalaaliYear(jalaaliYear) ? 30 : 29;
}

/** Converts a Jalali date to its Gregorian components. */
export function jalaliToGregorianParts(
  jalaaliYear: number,
  jalaaliMonth: number,
  jalaaliDay: number,
): { gy: number; gm: number; gd: number } {
  const { gy, gm, gd } = toGregorian(jalaaliYear, jalaaliMonth, jalaaliDay);
  return { gy, gm, gd };
}
