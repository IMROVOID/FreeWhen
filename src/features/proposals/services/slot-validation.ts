/**
 * Slot validation (Plan 06 Task 3, PRD-03 §7, §8).
 *
 * ★ `nowUtc` IS A PARAMETER.
 *
 * Client clocks are untrusted, so the check runs against the server's clock and
 * the caller passes it: a function that reads `Date.now()` internally cannot be
 * tested for the "device clock set back a day" case, which is exactly the case
 * that lets a past slot through.
 *
 * ★ A MIDNIGHT-CROSSING SLOT IS VALID (E4).
 *
 * `23:00–01:00` is a real dinner. The ordering check compares instants, so the
 * end being on the next calendar day is not an error — and the window check is
 * deliberately applied to the START only, because a slot that begins inside the
 * window may legitimately run past its end.
 */

import { SLOT_GRANULARITY_MIN, VALIDATION } from '@/src/types/proposal';

import { zoneOffsetMs } from './slot-time';

const MS_PER_MINUTE = 60_000;

/** A field error carrying the catalogue key the screen renders inline. */
export class SlotError extends Error {
  constructor(
    readonly field: 'start_utc' | 'end_utc',
    readonly messageKey: string,
  ) {
    super(messageKey);
    this.name = 'SlotError';
  }
}

export interface SlotWindow {
  start: string;
  end: string;
}

/**
 * Whether an instant sits on the granularity grid (PRD-03 §3.4).
 *
 * Measured in MINUTES SINCE THE EPOCH, not in `getUTCMinutes()`.
 *
 * That distinction is the whole point for Iran: `19:00` Tehran is `15:30` UTC,
 * whose `getUTCMinutes()` is `30` — not a multiple of 30? It is, exactly. But
 * `19:15` Tehran is `15:45` UTC and an honest 15-minute slot would be rejected
 * by a naive check that only looked at local minutes. Anchoring to the epoch
 * accepts every slot that is aligned in the EVENT's zone, which is the zone the
 * user was actually looking at when they picked it.
 */
export function isOnGranularity(
  startUtc: string,
  homeTz: string,
  granularityMin: number = SLOT_GRANULARITY_MIN,
): boolean {
  const instant = new Date(startUtc);
  const local = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));

  const minutesSinceEpoch = Math.floor(local.getTime() / MS_PER_MINUTE);
  return minutesSinceEpoch % granularityMin === 0;
}

/**
 * Server-side slot validation (PRD-03 §7, §8).
 *
 * ★ `nowUtc` IS A PARAMETER.
 *
 * Client clocks are untrusted, so the check runs against the server's clock and
 * the caller passes it: a function that reads `Date.now()` internally cannot be
 * tested for the "device clock set back a day" case, which is exactly the case
 * that lets a past slot through.
 *
 * ★ A MIDNIGHT-CROSSING SLOT IS VALID (E4).
 *
 * `23:00–01:00` is a real dinner. The ordering check compares instants, so the
 * end being on the next calendar day is not an error — and the window check is
 * deliberately applied to the START only, because a slot that begins inside the
 * window may legitimately run past its end.
 *
 * Returns the errors rather than throwing, so a caller can report every field
 * problem in one 422 instead of one per round trip.
 */
export function validateSlot(
  startUtc: string | null,
  endUtc: string | null,
  window: SlotWindow,
  nowUtc: Date = new Date(),
  homeTz = 'Asia/Tehran',
): SlotError[] {
  // A place-only proposal has no slot at all; nothing to validate.
  if (startUtc == null) return [];

  const errors: SlotError[] = [];
  const start = new Date(startUtc);

  if (endUtc != null) {
    const end = new Date(endUtc);
    if (!(end > start)) errors.push(new SlotError('end_utc', VALIDATION.endBeforeStart));
  }

  const windowStart = new Date(window.start);
  const windowEnd = new Date(window.end);

  // ★ ORDER MATTERS: the response keeps ONE message per field.
  //
  // `validationFailed` flattens to a `fields` map with the first issue per
  // field winning, because a picker shows one message under it. "That time has
  // passed" is the more useful of the two when both apply — a past slot is also
  // outside the window, and telling the user only the second fact makes them
  // hunt for a time that is both in-window AND in the future.
  if (start <= nowUtc) {
    errors.push(new SlotError('start_utc', VALIDATION.slotPast));
  } else if (start < windowStart || start > windowEnd) {
    errors.push(new SlotError('start_utc', VALIDATION.slotOutOfWindow));
  }

  if (!isOnGranularity(startUtc, homeTz)) {
    errors.push(new SlotError('start_utc', VALIDATION.slotOffGranularity));
  }

  return errors;
}
