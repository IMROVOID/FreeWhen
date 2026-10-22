/**
 * The deterministic Persian chat parser (Plan 14 Task 7, PRD-07 §4.2).
 *
 * ★ THIS IS THE PRIMARY IMPLEMENTATION, NOT A STUB (FR-7.2, §7 G5).
 *
 * Every AI provider is blocked or unreliable from Iran (PRD-07 §2, research
 * Q4), so a parser that is only a fallback is a parser that never runs. The
 * advisory claim "AI is optional" is true only if this file is genuinely usable
 * on its own — which is exactly what AC-7.3.1 asserts.
 *
 * ★ IT NEVER WRITES, AND IT NEVER THROWS.
 *
 * A parse failure is a normal outcome (FR-7.9): the caller gets an empty
 * candidate list and the raw text back, and the screen offers manual entry. No
 * malformed input reaches an exception, so no exception can reach a screen.
 *
 * ★ A PLACE WITHOUT A TIME IS STILL WORTH RETURNING.
 *
 * «کافه دیدار خوبه؟» is a complete suggestion. Demanding both halves would drop
 * half the real messages, so each message yields a `PLACE`, a `TIME` or a
 * `TIME_AND_PLACE` candidate depending on what it actually contained.
 */

import {
  gregorianDayToJalali,
  jalaliToGregorianDay,
  weekdayIndex,
  weekdayName,
} from '@/src/lib/jalali';
import { DEFAULT_DURATION_MIN, SLOT_GRANULARITY_MIN, type ProposalType } from '@/src/types/proposal';

import {
  findMonthDay,
  findRelativeDay,
  findTimes,
  findWeekday,
  normaliseText,
  splitMessages,
  titleFrom,
  type TimeMatch,
} from './lexicon';
import { findPlaces } from './places';
import { zonedTimeToUtc, zoneOffsetMs } from '@/src/features/proposals/services/slot-time';
import { MAX_CANDIDATES, type ParseContext, type ParsedCandidate, type ParseResult } from './types';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * The search horizon for a bare weekday, in days (plan E4).
 *
 * Seven days covers a full week, so any named weekday has exactly one nearest
 * future occurrence inside it. Past that the window is narrower than the guess
 * and the candidate is rejected by the window check instead — which is the
 * honest answer, not a guess stretched to fit.
 */
const WEEKDAY_HORIZON_DAYS = 7;

/** `YYYY-MM-DD` → the UTC midnight of that calendar day. */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** The event's wall clock for a UTC instant — the same arithmetic the app uses. */
function localParts(startUtc: string, homeTz: string): { date: string; time: string } {
  const instant = new Date(startUtc);
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));

  return {
    date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
  };
}

/**
 * Resolves the calendar day a message refers to, or `null` when it names none.
 *
 * ★ THE ORDER IS SPECIFICITY, NOT THE ORDER THE WORDS APPEAR.
 *
 * A month-and-day («۱۲ اسفند») is a fact. «فردا» is a fact relative to today.
 * «جمعه» is a guess and is marked as one. Reading them in the order they appear
 * would let «جمعه ۱۲ اسفند» choose the weekday and ignore the date.
 */
interface ResolvedDay {
  date: string;
  resolvedFromWeekday: boolean;
  evidence: string;
}

function resolveDay(message: string, context: ParseContext): ResolvedDay | null {
  const monthDay = findMonthDay(message);
  if (monthDay) {
    const { jy } = gregorianDayToJalali(context.now.date);

    // A month/day earlier in the year than now belongs to the next year: a group
    // planning «۱۲ فروردین» in December means next spring, not last spring.
    const sameYear = jalaliToGregorianDay(jy, monthDay.month, monthDay.day);
    const date = isWithin(sameYear, context.windowStartDate, context.windowEndDate)
      ? sameYear
      : jalaliToGregorianDay(jy + 1, monthDay.month, monthDay.day);

    return { date, resolvedFromWeekday: false, evidence: monthDay.match.text };
  }

  const relative = findRelativeDay(message);
  if (relative) {
    const date = isoDate(dayMs(context.now.date) + relative.offset * MS_PER_DAY);
    return { date, resolvedFromWeekday: false, evidence: relative.match.text };
  }

  const weekday = findWeekday(message);
  if (weekday) {
    const start = dayMs(context.now.date);
    for (let step = 0; step <= WEEKDAY_HORIZON_DAYS; step++) {
      const candidateMs = start + step * MS_PER_DAY;
      if (weekdayIndex(isoDate(candidateMs), 'fa') === weekday.index) {
        return { date: isoDate(candidateMs), resolvedFromWeekday: true, evidence: weekday.match.text };
      }
    }
  }

  return null;
}

function isWithin(date: string, start: string, end: string): boolean {
  const ms = dayMs(date);
  return ms >= dayMs(start) && ms <= dayMs(end);
}

/** The candidate's slot, snapped to the granularity grid the picker uses. */
function slotFor(day: string, time: TimeMatch, context: ParseContext): { startUtc: string; endUtc: string } {
  const snappedMinute =
    Math.round(time.minute / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN === 60
      ? 0
      : Math.round(time.minute / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN;

  const minuteCarry = snappedMinute === 0 && time.minute > 30 ? 1 : 0;

  const [gy, gm, gd] = day.split('-').map(Number) as [number, number, number];

  const start = zonedTimeToUtc(
    { gy, gm, gd, hour: time.hour + minuteCarry, minute: snappedMinute },
    context.homeTz,
  );

  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * MS_PER_MINUTE);

  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/** One message → at most one candidate. */
function candidateFor(message: string, context: ParseContext, ordinal: number): ParsedCandidate | null {
  const day = resolveDay(message, context);
  const times = findTimes(message);
  const places = findPlaces(message);

  const time = times[0] ?? null;
  const place = places[0] ?? null;

  if (!day && !time && !place) return null;

  // A time with no day is ambiguous ("at 7" — which day?). The window's first
  // day is the honest default only when the window IS one day; otherwise the
  // candidate would be one of several equally plausible dates chosen silently.
  if (time && !day && context.windowStartDate !== context.windowEndDate) return null;

  const resolvedDay = day?.date ?? context.windowStartDate;

  const slot = time ? slotFor(resolvedDay, time, context) : null;

  // The window check runs here, not in the route, so a candidate the parser
  // already knows is unusable never reaches the review list.
  if (slot && !isWithin(localParts(slot.startUtc, context.homeTz).date, context.windowStartDate, context.windowEndDate)) {
    return null;
  }

  const type: ProposalType =
    slot && place ? 'TIME_AND_PLACE' : slot ? 'TIME' : 'PLACE';

  const local = slot
    ? {
        ...localParts(slot.startUtc, context.homeTz),
        weekday: weekdayName(slot.startUtc, 'fa'),
        resolvedFromWeekday: day?.resolvedFromWeekday ?? false,
      }
    : null;

  const title = place
    ? titleFrom(place.text, place.text)
    : titleFrom(message, local ? `${local.weekday} ${local.time}` : message);

  return {
    id: `c${ordinal}`,
    type,
    title,
    placeQuery: place?.text ?? null,
    startUtc: slot?.startUtc ?? null,
    endUtc: slot?.endUtc ?? null,
    local,
    // Both halves read is a strong signal; one half alone is weaker; a weekday
    // the parser had to resolve is weaker still (E4).
    confidence: confidenceOf({ hasTime: slot !== null, hasPlace: place !== null, resolvedWeekday: local?.resolvedFromWeekday ?? false }),
    evidence: evidenceOf(day?.evidence ?? null, time?.text ?? null, place?.text ?? null),
    source: 'deterministic',
  };
}

function confidenceOf(input: { hasTime: boolean; hasPlace: boolean; resolvedWeekday: boolean }): number {
  let score = 0.55;
  if (input.hasTime) score += 0.2;
  if (input.hasPlace) score += 0.2;
  if (input.resolvedWeekday) score -= 0.15;

  return Math.min(0.99, Math.max(0.1, Number(score.toFixed(2))));
}

function evidenceOf(day: string | null, time: string | null, place: string | null): string {
  return [place, day, time].filter((part): part is string => part !== null).join(' · ');
}

/**
 * Parses pasted group-chat text into candidates.
 *
 * ★ ORDERED BY CONFIDENCE, THEN CAPPED (plan E5).
 *
 * Ordering before the cap is what makes the cap drop the least certain
 * candidates rather than the last ones typed. Ties keep source order, so the
 * list is stable across two parses of the same text.
 */
export function parseDeterministic(rawText: string, context: ParseContext): ParseResult {
  const text = normaliseText(rawText);

  if (text === '') return { candidates: [], text: '', recognised: false };

  const candidates: ParsedCandidate[] = [];

  for (const [index, message] of splitMessages(text).entries()) {
    const candidate = candidateFor(message, context, index);
    if (candidate) candidates.push(candidate);
  }

  const ordered = candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => b.candidate.confidence - a.candidate.confidence || a.order - b.order)
    .slice(0, MAX_CANDIDATES)
    .map(({ candidate }) => candidate);

  return { candidates: ordered, text: rawText, recognised: ordered.length > 0 };
}

/**
 * The window a message may resolve inside, as the event's own calendar days.
 *
 * Exported because the route needs the same boundaries to build `ParseContext`
 * and two callers computing them differently is how a parser and its route come
 * to disagree about which day the event starts.
 */
export function windowDays(windowStartUtc: string, windowEndUtc: string, homeTz: string): { start: string; end: string } {
  return {
    start: localParts(windowStartUtc, homeTz).date,
    end: localParts(windowEndUtc, homeTz).date,
  };
}

/** Parses the request body's text, reporting whether it is even a string. */
export function readText(body: Record<string, unknown>): string | null {
  const value = body.text;
  return typeof value === 'string' ? value : null;
}
