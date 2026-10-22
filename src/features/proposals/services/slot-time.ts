/**
 * Slot time: local wall clock ↔ UTC instant, and slot validation
 * (PRD-03 §3.1, §7, §8, §13.1, §13.3).
 *
 * ★ STORE THE INSTANT, NEVER THE WALL CLOCK.
 *
 * Every instant that reaches the database is an ISO string ending in `Z`. A
 * persisted local time breaks in two situations that both actually happen:
 * Iran reinstating DST (it has had none since 2022, which is a fact about now,
 * not a guarantee), and a participant in another zone reading the proposal.
 *
 * ★ CONVERT IN THE EVENT'S TIMEZONE, NOT THE DEVICE'S.
 *
 * A participant in Berlin proposing "19:00" for a Tehran dinner means 19:00
 * Tehran. Converting with the device zone would store 17:30 Tehran and every
 * Iranian participant would arrive two hours early. The converter therefore
 * takes `homeTz` as an argument and never reads the device zone.
 *
 * ★ IRAN IS UTC+03:30.
 *
 * A half-hour offset. Anything that rounds an offset to whole hours shifts
 * every slot in the country by thirty minutes — silently, because the stored
 * value still looks like a valid instant.
 */

import { DEFAULT_DURATION_MIN } from '@/src/types/proposal';
import { jalaliToGregorianParts } from '@/src/lib/jalali';

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

/** A slot, as the wire carries it. */
export interface SlotInstant {
  startUtc: string;
  endUtc: string;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * The UTC offset of `timeZone` at a given instant, in milliseconds.
 *
 * `Intl.DateTimeFormat` is the only zone database available in a React Native
 * runtime that is not a native dependency, and it is the same database the OS
 * uses — so a zone rule change reaches this code through the platform update
 * rather than a hardcoded table that goes stale.
 *
 * The technique: format the instant AS the target zone, read those wall-clock
 * fields back as if they were UTC, and the difference from the real instant is
 * the offset. It is exact for any offset the tz database knows, including the
 * half-hour ones.
 */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(new Date(instantMs));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };

  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );

  // `second` truncates the milliseconds, so the comparison ignores them.
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in a named zone.
 *
 * The offset depends on the instant, so the naive conversion is applied twice:
 * the first pass lands within an hour of the answer, and the second corrects
 * it using the offset in force at that point. For a fixed-offset zone — every
 * Iranian date since 2022 — one pass is already exact and the second is a
 * no-op; for a DST zone it fixes the case where the naive answer falls on the
 * wrong side of the transition.
 */
export function zonedTimeToUtc(
  parts: { gy: number; gm: number; gd: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const wallClockMs = Date.UTC(parts.gy, parts.gm - 1, parts.gd, parts.hour, parts.minute);

  const firstGuess = wallClockMs - zoneOffsetMs(wallClockMs, timeZone);
  const corrected = wallClockMs - zoneOffsetMs(firstGuess, timeZone);

  return new Date(corrected);
}

/**
 * A Jalali picker's output → the UTC slot to store (AC-3.1.3).
 *
 * `durationMin` defaults to `DEFAULT_DURATION_MIN` so a proposal is an interval
 * rather than an instant; callers that know better pass it explicitly.
 */
export function localSlotToUtc(
  jalaaliDate: JalaliDate,
  hour: number,
  minute: number,
  homeTz: string,
  durationMin: number = DEFAULT_DURATION_MIN,
): SlotInstant {
  const { gy, gm, gd } = jalaliToGregorianParts(jalaaliDate.jy, jalaaliDate.jm, jalaaliDate.jd);

  const start = zonedTimeToUtc({ gy, gm, gd, hour, minute }, homeTz);
  const end = new Date(start.getTime() + durationMin * MS_PER_MINUTE);

  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/**
 * The UTC slot → a Jalali date and wall-clock time in the event's zone.
 *
 * The inverse of `localSlotToUtc`, for rendering a picker seeded from a stored
 * proposal. Both directions go through `homeTz`, so a round trip is exact.
 */
export function utcToLocalSlot(
  startUtc: string,
  homeTz: string,
): { parts: { gy: number; gm: number; gd: number }; hour: number; minute: number } {
  const instant = new Date(startUtc);
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));

  return {
    parts: {
      gy: shifted.getUTCFullYear(),
      gm: shifted.getUTCMonth() + 1,
      gd: shifted.getUTCDate(),
    },
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Whether a slot's end falls on a later day in the event's zone.
 *
 * Drives the honest label: a `23:00–01:00` proposal must say it ends the next
 * day, or a participant reads `01:00` as a morning slot (E4).
 */
export function endsNextDay(startUtc: string, endUtc: string, homeTz: string): boolean {
  const start = new Date(startUtc);
  const end = new Date(endUtc);

  const startLocal = new Date(start.getTime() + zoneOffsetMs(start.getTime(), homeTz));
  const endLocal = new Date(end.getTime() + zoneOffsetMs(end.getTime(), homeTz));

  const dayOf = (date: Date): number =>
    Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);

  return dayOf(endLocal) > dayOf(startLocal);
}

/** A wall-clock `HH:MM` in the event's zone — the picker's display form. */
export function formatLocalTime(instantUtc: string, homeTz: string): string {
  const instant = new Date(instantUtc);
  const local = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));

  const hours = local.getUTCHours();
  const minutes = local.getUTCMinutes();
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));

  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * The device's zone, for the "your local time" indicator (AC-3.1.4).
 *
 * Reads the runtime's resolved zone rather than calling `zoneOffsetMs` with a
 * guess: an empty string means the runtime could not resolve one, and the
 * caller must then suppress the indicator rather than show a wrong label.
 */
export function deviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.trim() !== '' ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Whether a device zone differs from the event's, and so needs the indicator.
 *
 * A device that cannot resolve its zone answers `false`: claiming a mismatch we
 * cannot substantiate puts a scary label on a screen with no real difference.
 */
export function timezonesDiffer(deviceTz: string | null, homeTz: string): boolean {
  return deviceTz != null && deviceTz !== homeTz;
}
