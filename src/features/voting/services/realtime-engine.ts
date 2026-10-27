/**
 * The realtime engine, without React (Plan 07 Task 10, PRD-10 D10, PRD-02 E9).
 *
 * ★ THE POLLING FLOOR IS THE POINT, AND IT IS NOT A FAILURE PATH.
 *
 * Websocket reliability on Iranian mobile networks is UNVERIFIED, so a client
 * that only listened would show a frozen tally whenever the socket is down —
 * which is often. The poll runs whether or not a socket is subscribed: the bridge
 * delivers at-most-once across a reconnect, so "no socket error" is not the same
 * as "up to date" (AC-10.6.1).
 *
 * ★ A DROPPED SOCKET IS `reconnecting`, NEVER AN ERROR.
 *
 * The user is looking at a tally that is a few seconds stale. An error would tell
 * them the product is broken when it is working; the honest statement is
 * "reconnecting", which the status area renders as one quiet line.
 *
 * ★ THE ENGINE IS SEPARATE FROM THE HOOK SO IT CAN BE TESTED HONESTLY.
 *
 * `useRealtime` is a thin React wrapper over `createRealtimeEngine`. Every
 * timing and lifecycle assertion runs against the engine directly, with the
 * scheduler and transport injected — so the tests exercise the code that ships
 * rather than a reimplementation of it.
 */

/**
 * The polling interval, in milliseconds.
 *
 * Named because the hook, its documentation and the test all depend on it, and a
 * literal in three places is three chances to disagree. Fast enough that another
 * device's vote appears while the user is still looking; slow enough not to
 * spend the battery on a screen nobody is reading.
 */
export const POLL_INTERVAL_MS = 10_000;

import { nextPollDelay } from './poll-backoff';

/** The connection state the indicator renders. */
export type ConnectionState = 'live' | 'reconnecting';

/** The tables this phase listens to. `start_point` is deliberately absent. */
export const SUBSCRIBED_TABLES = ['vote', 'proposal', 'rsvp', 'event'] as const;

export type SubscribedTable = (typeof SUBSCRIBED_TABLES)[number];

/**
 * The channel names, from `server/realtime/channels.ts` — the client contract.
 *
 * A typo on either side silently stops every update, so both sides name them the
 * same way and the test pins the format.
 */
export function eventChannels(eventId: string): string[] {
  return [
    `event:${eventId}:votes`,
    `event:${eventId}:proposals`,
    `event:${eventId}:status`,
  ];
}

/**
 * A transport: it calls `onChange` whenever a subscribed row changes and reports
 * its connection state, and returns a teardown.
 */
export type Subscribe = (
  eventId: string,
  onChange: () => void,
  onStatus: (state: ConnectionState) => void,
) => () => void;

/** The timers, injected so a test does not sleep for ten seconds. */
export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): unknown;
}

const realScheduler: Scheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RealtimeEngineOptions {
  eventId: string;
  refetch: () => void;
  /** Omitted means "no socket", so the poll carries everything. */
  subscribe?: Subscribe;
  intervalMs?: number;
  /**
   * Called after each poll with whether it failed, so the engine can back off.
   *
   * Omitted means "refetch reports nothing", which keeps the fixed cadence. A
   * caller whose refetch cannot fail has nothing to report.
   */
  onPollResult?: (failed: boolean) => void;
  enabled?: boolean;
  scheduler?: Scheduler;
  /** Notified on every state change, so the hook can setState. */
  onState?: (state: ConnectionState) => void;
}

export interface RealtimeEngine {
  /** The current state. */
  state: () => ConnectionState;
  /** Replaces the refetch closure when the caller re-renders. */
  setRefetch: (refetch: () => void) => void;
  /** Forces a refetch. */
  refresh: () => void;
  /**
   * Tells the engine whether the last refetch failed, so the next poll can back
   * off. Also reschedules, because a `setTimeout` chain cannot retime itself.
   */
  reportPollResult: (failed: boolean) => void;
  /** Stops the poll and tears the transport down. Idempotent. */
  stop: () => void;
}

/**
 * Starts the poll and the subscription.
 *
 * Returns an engine whose `stop` must be called on unmount — the poll is a real
 * timer and a screen that has gone cannot keep spending requests.
 */
export function createRealtimeEngine({
  eventId,
  refetch,
  subscribe,
  intervalMs = POLL_INTERVAL_MS,
  onPollResult,
  enabled = true,
  scheduler = realScheduler,
  onState,
}: RealtimeEngineOptions): RealtimeEngine {
  let current = refetch;
  let stopped = false;

  /** Failures since the last success, which is what the backoff curve reads. */
  let failures = 0;
  let timer: unknown;

  // With a transport we do not yet know whether it is healthy, so the honest
  // starting state is `reconnecting`; a transport reports `live` when it
  // subscribes. Without one the poll is the only mechanism, which is by design
  // and is not a degraded state.
  let state: ConnectionState = subscribe ? 'reconnecting' : 'live';

  const setState = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    onState?.(next);
  };

  const safeRefetch = (): void => {
    if (stopped) return;
    current();
  };

  /**
   * Arms the next poll.
   *
   * ★ A `setTimeout` CHAIN, NOT A `setInterval`.
   *
   * The period is no longer constant, so the timer is re-armed after every poll
   * with the delay the backoff curve returns. `intervalMs` is the healthy floor;
   * a failure doubles from there.
   */
  const schedule = (): void => {
    if (stopped) return;
    timer = scheduler.setTimeout(() => {
      if (stopped) return;
      safeRefetch();
      // The refetch reports its own outcome, which reschedules. This is the
      // fallback for a caller that never reports, so the poll cannot stop
      // silently the first time it fires.
      if (!onPollResult) schedule();
    }, nextPollDelay(failures, intervalMs));
  };

  const reportPollResult = (failed: boolean): void => {
    if (stopped) return;

    failures = failed ? failures + 1 : 0;
    onPollResult?.(failed);

    // A result only reschedules when the caller reports outcomes; without that
    // wiring the engine keeps its own unconditional chain.
    if (onPollResult) {
      scheduler.clearTimeout(timer);
      schedule();
    }
  };

  if (!enabled) {
    return {
      state: () => state,
      setRefetch: (next) => {
        current = next;
      },
      refresh: () => {},
      reportPollResult: () => {},
      stop: () => {
        stopped = true;
      },
    };
  }

  // ★ THE FLOOR. Registered before the transport, so a transport that throws
  // still leaves the poll running — which is the entire point of a floor.
  schedule();

  const teardown = subscribe?.(
    eventId,
    safeRefetch,
    (next) => {
      if (stopped) return;
      setState(next);
    },
  );

  return {
    state: () => state,
    setRefetch: (next) => {
      current = next;
    },
    refresh: safeRefetch,
    reportPollResult,
    stop: () => {
      if (stopped) return;
      stopped = true;
      scheduler.clearTimeout(timer);
      teardown?.();
    },
  };
}
