/**
 * The mute write, extracted so its revert is provable (Plan 10 Task 6).
 *
 * ★ THE BUG THIS SHAPE PREVENTS, EXACTLY.
 *
 * The original component wrote `{ preferences: { muted_events, event_id } }`,
 * which no schema accepted. The optimistic `onChange(next)` fired, the request
 * was rejected, and the `catch` called `onChange(!next)` — so the switch flipped
 * and flopped on every single use, and a test that only rendered the component
 * saw a perfectly normal switch.
 *
 * Keeping the optimistic-flip-then-revert pair in one function means a test can
 * drive both paths without a browser: `toggleMute` is what the component calls,
 * and the two assertions it has to satisfy are "the new value was shown" and "the
 * old value came back when the write failed".
 */

import type { ApiResult, RequestOptions } from '@/src/lib/api';

/**
 * The transport, injected rather than imported.
 *
 * ★ `src/lib/api.ts` IMPORTS `expo-constants` AT MODULE SCOPE, so importing it
 * here would drag a native module into the Node test runner and the suite could
 * not load this file at all. The write contract is the thing that broke before —
 * it must be testable without a device.
 */
export type MuteRequest = <T>(
  path: string,
  options: RequestOptions,
) => Promise<ApiResult<T>>;

/** What the toggle displays and where it reports each step. */
export interface MuteWrite {
  /** The value the switch shows now. */
  next: boolean;
  /** Reports a value to the caller for rendering. */
  onChange: (muted: boolean) => void;
}

export interface ToggleMuteOptions {
  eventId: string;
  userId: string | null;
  next: boolean;
  onChange: (muted: boolean) => void;
  /** The transport. Required, so no call site can silently use a mock. */
  request: MuteRequest;
  /**
   * Reads the catalogue key out of a refusal.
   *
   * Passed in with the transport for the same reason: `ApiFailure` lives beside
   * `expo-constants`, and this module must stay loadable under Node.
   */
  messageKeyOf?: (error: unknown) => string | null;
}

export type ToggleMuteResult =
  | { ok: true }
  | { ok: false; messageKey: string };

/**
 * Writes the preference, reverting the visible switch if the write fails.
 *
 * The optimistic flip happens FIRST and unconditionally: a switch that lags
 * behind the finger reads as broken. The revert is the second half of the same
 * promise — the switch must never claim a preference was saved when it was not.
 */
export async function toggleMute({
  eventId,
  userId,
  next,
  onChange,
  request,
  messageKeyOf,
}: ToggleMuteOptions): Promise<ToggleMuteResult> {
  onChange(next);

  try {
    await request(`/api/participants/me`, {
      method: 'PATCH',
      userId,
      platform: 'app',
      body: { event_id: eventId, notifications_muted: next },
    });

    return { ok: true };
  } catch (error) {
    onChange(!next);

    return {
      ok: false,
      messageKey: messageKeyOf?.(error) ?? 'notifications.errors.muteFailed',
    };
  }
}
