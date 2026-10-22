/**
 * Realtime with a polling floor (Plan 07 Task 10, PRD-10 D10, PRD-02 E9).
 *
 * ★ A THIN REACT WRAPPER OVER `createRealtimeEngine`.
 *
 * The polling floor, the state machine and the teardown all live in the engine,
 * which is pure and takes its timers and transport by injection. That is what
 * lets `tests/realtime/fallback.test.ts` exercise the behaviour that ships,
 * rather than a reimplementation of it.
 *
 * ★ THE TRANSPORT IS A PARAMETER, NOT AN IMPORT.
 *
 * The hook does not import a socket library. It keeps the bundle from carrying
 * one on web, and it means a screen can be tested with a dead transport by
 * passing one that reports `reconnecting`.
 *
 * ★ `start_point` IS NEVER SUBSCRIBED TO (FR-8.15).
 *
 * Phase 2 deliberately excluded it from the realtime publication: a location
 * broadcast to every participant of every event is a privacy leak.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  POLL_INTERVAL_MS,
  createRealtimeEngine,
  type ConnectionState,
  type Subscribe,
} from '../services/realtime-engine';

export {
  POLL_INTERVAL_MS,
  SUBSCRIBED_TABLES,
  eventChannels,
  type ConnectionState,
  type SubscribedTable,
  type Subscribe,
} from '../services/realtime-engine';

export interface UseRealtimeOptions {
  eventId: string;
  /** Refetches the payload. Called on every change and every poll. */
  refetch: () => void;
  /** The transport. Omitted means "no socket", so the poll carries everything. */
  subscribe?: Subscribe;
  /** The poll interval. Overridden by the tests so they do not sleep. */
  intervalMs?: number;
  /** Whether to poll at all — a finished event does not need it. */
  enabled?: boolean;
}

export interface UseRealtimeResult {
  connection: ConnectionState;
  /** Forces a refetch — the failed-vote path calls this. */
  refresh: () => void;
}

export function useRealtime({
  eventId,
  refetch,
  subscribe,
  intervalMs = POLL_INTERVAL_MS,
  enabled = true,
}: UseRealtimeOptions): UseRealtimeResult {
  const [connection, setConnection] = useState<ConnectionState>(
    subscribe ? 'reconnecting' : 'live',
  );

  // The latest `refetch`, held in a ref so a new closure does not tear down the
  // socket and restart the poll on every render. Without it the channel would
  // resubscribe whenever the parent re-rendered — the classic "reconnecting"
  // flicker.
  const latest = useRef(refetch);
  latest.current = refetch;

  const engine = useRef<ReturnType<typeof createRealtimeEngine> | null>(null);

  const refresh = useCallback(() => {
    engine.current?.refresh();
  }, []);

  useEffect(() => {
    const started = createRealtimeEngine({
      eventId,
      refetch: () => latest.current(),
      subscribe,
      intervalMs,
      enabled,
      onState: setConnection,
    });

    engine.current = started;
    setConnection(started.state());

    return () => {
      started.stop();
      engine.current = null;
    };
  }, [eventId, subscribe, intervalMs, enabled]);

  return { connection, refresh };
}
