/**
 * The boundary schemas (Plan 05 Task 1).
 *
 * Each case mirrors a boundary the server enforces, so a passing suite is
 * evidence that the client and the database agree on the same limits.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EventCreateSchema,
  JoinSchema,
  ParticipantPatchSchema,
  StartPointSchema,
  VALIDATION,
  hasAtMostTwoDecimals,
} from '@/src/types/event';

const WINDOW_START = '2026-11-01T16:00:00.000Z';
const WINDOW_END = '2026-11-04T20:00:00.000Z';

/** The first message key a failed parse reports, so the assertion is stable. */
function firstKey(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return result.error?.issues[0]?.message ?? '';
}

test('a valid event payload passes', () => {
  const result = EventCreateSchema.safeParse({
    title: 'شام جمعه',
    description: 'همه دور هم',
    activity_type: 'dinner',
    date_window_start: WINDOW_START,
    date_window_end: WINDOW_END,
    voting_deadline: '2026-11-03T20:00:00.000Z',
  });

  assert.equal(result.success, true);
});

test('the minimum event payload passes — no optional field is required', () => {
  const result = EventCreateSchema.safeParse({
    title: 'x',
    date_window_start: WINDOW_START,
    date_window_end: WINDOW_END,
  });

  assert.equal(result.success, true);
});

test('an empty title is rejected with the inline key', () => {
  const result = EventCreateSchema.safeParse({
    title: '   ',
    date_window_start: WINDOW_START,
    date_window_end: WINDOW_END,
  });

  assert.equal(result.success, false);
  assert.equal(firstKey(result), VALIDATION.titleRequired);
});

test('an 80-character title passes and an 81-character one does not', () => {
  const at = { title: 'a'.repeat(80), date_window_start: WINDOW_START, date_window_end: WINDOW_END };
  const over = { ...at, title: 'a'.repeat(81) };

  assert.equal(EventCreateSchema.safeParse(at).success, true);
  assert.equal(firstKey(EventCreateSchema.safeParse(over)), VALIDATION.titleTooLong);
});

test('a 500-character description passes and a 501-character one is rejected', () => {
  const base = { title: 'شام', date_window_start: WINDOW_START, date_window_end: WINDOW_END };

  assert.equal(
    EventCreateSchema.safeParse({ ...base, description: 'b'.repeat(500) }).success,
    true,
  );
  assert.equal(
    firstKey(EventCreateSchema.safeParse({ ...base, description: 'b'.repeat(501) })),
    VALIDATION.descriptionTooLong,
  );
});

test('a window that ends before it starts is rejected on the end field', () => {
  const result = EventCreateSchema.safeParse({
    title: 'شام',
    date_window_start: WINDOW_END,
    date_window_end: WINDOW_START,
  });

  assert.equal(result.success, false);
  assert.equal(firstKey(result), VALIDATION.windowOrder);
  assert.deepEqual(result.error?.issues[0]?.path, ['date_window_end']);
});

test('a voting deadline after the window end is rejected inline, not as a 422', () => {
  const result = EventCreateSchema.safeParse({
    title: 'شام',
    date_window_start: WINDOW_START,
    date_window_end: WINDOW_END,
    voting_deadline: '2026-11-05T20:00:00.000Z',
  });

  assert.equal(result.success, false);
  assert.equal(firstKey(result), VALIDATION.deadlineAfterWindow);
  assert.deepEqual(result.error?.issues[0]?.path, ['voting_deadline']);
});

test('a voting deadline exactly on the window end passes — the bound is inclusive', () => {
  const result = EventCreateSchema.safeParse({
    title: 'شام',
    date_window_start: WINDOW_START,
    date_window_end: WINDOW_END,
    voting_deadline: WINDOW_END,
  });

  assert.equal(result.success, true);
});

test('a timestamp without an offset is rejected', () => {
  const result = EventCreateSchema.safeParse({
    title: 'شام',
    date_window_start: '2026-11-01T16:00:00',
    date_window_end: WINDOW_END,
  });

  assert.equal(result.success, false);
});

test('a display name must be 1–30 characters', () => {
  assert.equal(JoinSchema.safeParse({ display_name: 'علی' }).success, true);
  assert.equal(JoinSchema.safeParse({ display_name: 'a'.repeat(30) }).success, true);

  assert.equal(firstKey(JoinSchema.safeParse({ display_name: '' })), VALIDATION.nameRequired);
  assert.equal(firstKey(JoinSchema.safeParse({ display_name: '   ' })), VALIDATION.nameRequired);
  assert.equal(
    firstKey(JoinSchema.safeParse({ display_name: 'a'.repeat(31) })),
    VALIDATION.nameTooLong,
  );
});

test('a non-string display name is rejected by the boundary, not coerced', () => {
  assert.equal(JoinSchema.safeParse({ display_name: 123 }).success, false);
});

test('an absent display name is allowed, because the nickname is the fallback', () => {
  // ★ THIS USED TO BE INVALID, AND THE CHANGE IS DELIBERATE (Plan 49 T7).
  //
  // A caller who has already chosen a global nickname should not have to type a
  // name again on every invite, so the field is optional at the schema and the
  // ROUTE refuses the join when neither a supplied name nor a nickname exists.
  // The guarantee that an invite cannot be redeemed anonymously therefore lives
  // in `joinInviteHandler`, and `tests/db/profile.test.ts` proves it end to end.
  assert.equal(JoinSchema.safeParse({}).success, true);
  assert.equal(JoinSchema.safeParse({ display_name: undefined }).success, true);
});

test('a coordinate outside Iran is rejected', () => {
  const base = { accuracy_m: 1200, source: 'gps_coarse' as const };

  assert.equal(StartPointSchema.safeParse({ ...base, lat: 35.7, lng: 51.4 }).success, true);
  assert.equal(firstKey(StartPointSchema.safeParse({ ...base, lat: 48.85, lng: 2.35 })), VALIDATION.coordRange);
  assert.equal(firstKey(StartPointSchema.safeParse({ ...base, lat: 35.7, lng: 20 })), VALIDATION.coordRange);
});

test('a 6-decimal coordinate is rejected at the boundary — precision never enters', () => {
  const result = StartPointSchema.safeParse({
    lat: 35.700123,
    lng: 51.400456,
    accuracy_m: 1200,
    source: 'gps_coarse',
  });

  assert.equal(result.success, false);
  assert.equal(firstKey(result), VALIDATION.coordPrecision);
});

test('a 2-decimal coordinate passes, and so does a whole or 1-decimal one', () => {
  const base = { accuracy_m: 1200, source: 'gps_coarse' as const };

  assert.equal(StartPointSchema.safeParse({ ...base, lat: 35.7, lng: 51.4 }).success, true);
  assert.equal(StartPointSchema.safeParse({ ...base, lat: 36, lng: 52 }).success, true);
  assert.equal(StartPointSchema.safeParse({ ...base, lat: 35.12, lng: 51.42 }).success, true);
});

test('hasAtMostTwoDecimals sees through floating-point noise', () => {
  assert.equal(hasAtMostTwoDecimals(35.7), true);
  assert.equal(hasAtMostTwoDecimals(35.12), true);
  assert.equal(hasAtMostTwoDecimals(36), true);

  assert.equal(hasAtMostTwoDecimals(35.123), false);
  assert.equal(hasAtMostTwoDecimals(35.7000001), false);
  assert.equal(hasAtMostTwoDecimals(Number.NaN), false);
  assert.equal(hasAtMostTwoDecimals(Number.POSITIVE_INFINITY), false);
});

test('a travel budget outside 5–240 minutes is rejected', () => {
  assert.equal(ParticipantPatchSchema.safeParse({ max_travel_minutes: 60 }).success, true);
  assert.equal(ParticipantPatchSchema.safeParse({ max_travel_minutes: 5 }).success, true);
  assert.equal(ParticipantPatchSchema.safeParse({ max_travel_minutes: 240 }).success, true);

  assert.equal(
    firstKey(ParticipantPatchSchema.safeParse({ max_travel_minutes: 4 })),
    VALIDATION.travelRange,
  );
  assert.equal(
    firstKey(ParticipantPatchSchema.safeParse({ max_travel_minutes: 241 })),
    VALIDATION.travelRange,
  );
});

test('an unknown transport mode is rejected rather than stored', () => {
  assert.equal(ParticipantPatchSchema.safeParse({ modes: ['car', 'transit'] }).success, true);
  assert.equal(ParticipantPatchSchema.safeParse({ modes: ['teleport'] }).success, false);
});

test('an empty participant patch is rejected — a no-op request is a client bug', () => {
  assert.equal(ParticipantPatchSchema.safeParse({}).success, false);
});
