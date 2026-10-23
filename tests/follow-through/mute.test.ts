/**
 * The mute write contract (Plan 10 Task 6 — FR-6.19).
 *
 * ★ THIS IS THE HALF THAT WAS BROKEN, AND NO RENDER TEST COULD SEE IT.
 *
 * The component drew a correct switch and sent
 * `{ preferences: { muted_events, event_id } }` — a shape `ParticipantPatchSchema`
 * has never had. Every tap was rejected, the `catch` reverted the optimistic
 * flip, and the switch silently reset. The mounted-render suite in `tests/ui`
 * passes against that bug; this file is what fails.
 *
 * `toggleMute` is the function the component calls, and the transport is
 * injected because `src/lib/api.ts` imports `expo-constants` at module scope.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { toggleMute } from '../../src/features/follow-through/services/mute';

const EVENT_ID = '11111111-2222-3333-4444-555555555555';

describe('a successful write', () => {
  test('shows the new value once and never reverts', async () => {
    const shown: boolean[] = [];

    const result = await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: true,
      onChange: (muted) => shown.push(muted),
      request: async () => ({ data: {} }) as never,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(shown, [true]);
  });

  test('★ sends the field the schema and migration 018 accept', async () => {
    let body: Record<string, unknown> = {};
    let path = '';

    await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: true,
      onChange: () => {},
      request: async (requestPath, options) => {
        path = requestPath;
        body = options.body as Record<string, unknown>;
        return { data: {} } as never;
      },
    });

    assert.equal(path, '/api/participants/me');

    // The event is named so the server can resolve WHICH participant row.
    assert.equal(body?.event_id, EVENT_ID);
    assert.equal(body?.notifications_muted, true);

    // ★ THE REGRESSION GUARD. The old envelope must never come back: it matched
    // no schema field, so the server could only ever reject it.
    assert.equal(body?.preferences, undefined);
  });

  test('unmuting sends false rather than omitting the field', async () => {
    let body: Record<string, unknown> = {};

    const shown: boolean[] = [];

    await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: false,
      onChange: (muted) => shown.push(muted),
      request: async (_path, options) => {
        body = options.body as Record<string, unknown>;
        return { data: {} } as never;
      },
    });

    // An omitted field would be a no-op patch, which the schema rejects as an
    // empty patch — so "unmute" would fail the same way the mute did.
    assert.equal(body?.notifications_muted, false);
    assert.deepEqual(shown, [false]);
  });
});

describe('a rejected write', () => {
  test('★ reverts the visible value, in that order', async () => {
    const shown: boolean[] = [];

    const result = await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: true,
      onChange: (muted) => shown.push(muted),
      request: async () => {
        throw new Error('422');
      },
    });

    assert.equal(result.ok, false);

    // Optimistic first (the switch tracks the finger), then the revert — the
    // switch must not claim a preference was saved when it was not.
    assert.deepEqual(shown, [true, false]);
  });

  test('reports the server’s own catalogue key when it supplied one', async () => {
    const result = await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: true,
      onChange: () => {},
      request: async () => {
        throw new Error('403');
      },
      messageKeyOf: () => 'errors.notParticipant',
    });

    assert.equal(result.ok, false);
    assert.equal(result.messageKey, 'errors.notParticipant');
  });

  test('falls back to the mute-specific key for a transport failure', async () => {
    const result = await toggleMute({
      eventId: EVENT_ID,
      userId: null,
      next: true,
      onChange: () => {},
      request: async () => {
        throw new Error('offline');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.messageKey, 'notifications.errors.muteFailed');
  });
});
