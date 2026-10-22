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
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): unknown;
}

const realScheduler: Scheduler = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RealtimeEngineOptions {
  eventId: string;
  refetch: () => void;
  /** Omitted means "no socket", so the poll carries everything. */
  subscribe?: Subscribe;
  intervalMs?: number;
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
  enabled = true,
  scheduler = realScheduler,
  onState,
}: RealtimeEngineOptions): RealtimeEngine {
  let current = refetch;
  let stopped = false;

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

  if (!enabled) {
    return {
      state: () => state,
      setRefetch: (next) => {
        current = next;
      },
      refresh: () => {},
      stop: () => {
        stopped = true;
      },
    };
  }

  // ★ THE FLOOR. Registered before the transport, so a transport that throws
  // still leaves the poll running — which is the entire point of a floor.
  const handle = scheduler.setInterval(safeRefetch, intervalMs);

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
    stop: () => {
      if (stopped) return;
      stopped = true;
      scheduler.clearInterval(handle);
      teardown?.();
    },
  };
}
