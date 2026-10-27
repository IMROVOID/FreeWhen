/**
 * The realtime fallback (Plan 07 Task 10, AC-10.6.1, PRD-02 E9).
 *
 * ★ THE CLAIM UNDER TEST: A KILLED SOCKET IS NEVER AN ERROR SCREEN.
 *
 * Websocket reliability on Iranian mobile networks is UNVERIFIED (PRD-10 D10), so
 * the poll is mandatory infrastructure rather than a defensive extra. With the
 * socket dead the tally must still update within 10 seconds, the UI must say
 * `reconnecting`, and nothing may throw.
 *
 * ★ THESE TESTS DRIVE THE CODE THAT SHIPS.
 *
 * The polling floor, the state machine and the teardown live in
 * `createRealtimeEngine`, which takes its scheduler and transport by injection.
 * The hook is a two-effect wrapper over it, so testing the engine tests the
 * behaviour. The alternative — restating the logic in the test — passes while the
 * hook is broken, which is the one thing a fallback test must not do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLL_INTERVAL_MS,
  SUBSCRIBED_TABLES,
  createRealtimeEngine,
  eventChannels,
  type ConnectionState,
  type Scheduler,
  type Subscribe,
} from '@/src/features/voting/services/realtime-engine';

/**
 * A scheduler the test advances by hand, so nothing sleeps for ten seconds.
 *
 * ★ IT MODELS A TIMEOUT CHAIN, NOT AN INTERVAL.
 *
 * The engine re-arms a single `setTimeout` after every poll, because the period
 * is no longer constant — a failing poll backs off. Only one timer is ever
 * pending, so `advance()` fires the pending callback once per step and the
 * delay it was armed with is recorded for the backoff assertions.
 */
function manualScheduler(): Scheduler & {
  advance: (times?: number) => void;
  live: () => number;
  delays: () => number[];
} {
  let pending: { callback: () => void; ms: number } | null = null;
  const armed: number[] = [];

  return {
    setTimeout(callback, ms) {
      pending = { callback, ms };
      armed.push(ms);
      return callback;
    },
    clearTimeout() {
      pending = null;
      return undefined;
    },
    advance(times = 1) {
      for (let index = 0; index < times; index++) {
        const next = pending;
        if (!next) return;
        pending = null;
        next.callback();
      }
    },
    live() {
      return pending ? 1 : 0;
    },
    delays() {
      return [...armed];
    },
  };
}

/** A counter that records how many times the payload was refetched. */
function counter(): { hits: number; refetch: () => void } {
  const state = { hits: 0, refetch: () => void (state.hits += 1) };
  return state;
}

test('the polling interval is the 10 s the plan specifies', () => {
  assert.equal(POLL_INTERVAL_MS, 10_000);
});

test('start_point is never subscribed to', () => {
  // A location broadcast to every participant is a privacy leak (FR-8.15), so
  // Phase 2 excluded it from the publication and this phase must not reintroduce
  // it on the client.
  assert.ok(
    !(SUBSCRIBED_TABLES as readonly string[]).includes('start_point'),
    'start_point is on the client subscribe list',
  );

  assert.deepEqual(
    [...SUBSCRIBED_TABLES].sort(),
    ['event', 'proposal', 'rsvp', 'vote'],
    'the subscribed table set drifted from Phase 2\u2019s publication',
  );
});

test('the client listens on the channel names the server publishes', () => {
  // The names ARE the contract: `server/realtime/channels.ts` produces them, and
  // a typo on either side silently stops every update.
  assert.deepEqual(eventChannels('11111111-1111-1111-1111-111111111111'), [
    'event:11111111-1111-1111-1111-111111111111:votes',
    'event:11111111-1111-1111-1111-111111111111:proposals',
    'event:11111111-1111-1111-1111-111111111111:status',
  ]);
});

test('AC-10.6.1: with the socket killed, a change still arrives within 10 s', () => {
  // Arrange — a transport that connects, delivers one change, then dies.
  const scheduler = manualScheduler();
  const refetch = counter();
  const states: ConnectionState[] = [];

  const subscribe: Subscribe = (_eventId, onChange, onStatus) => {
    onStatus('live');
    onChange();
    onStatus('reconnecting');
    return () => {};
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
    onState: (state) => states.push(state),
  });

  // Act — the socket delivered its one message; now only the poll remains.
  const before = refetch.hits;
  scheduler.advance();

  // Assert
  assert.equal(refetch.hits, before + 1, 'the poll did not refetch after the socket died');
  assert.deepEqual(states, ['live', 'reconnecting'], 'the state machine did not report the drop');

  // ★ `reconnecting` IS NOT AN ERROR.
  //
  // It is the state the UI renders as one quiet line. Nothing in this path
  // throws, and there is no error state to render.
  assert.equal(engine.state(), 'reconnecting');

  engine.stop();
});

test('the poll runs even with a healthy socket', () => {
  // ★ THE FLOOR IS NOT ONLY FOR FAILURES.
  //
  // The bridge delivers at-most-once across a reconnect, so "no socket error" is
  // not the same as "up to date". The poll closes that gap.
  const scheduler = manualScheduler();
  const refetch = counter();

  const subscribe: Subscribe = (_eventId, _onChange, onStatus) => {
    onStatus('live');
    return () => {};
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
  });

  // Act
  scheduler.advance(3);

  // Assert
  assert.equal(refetch.hits, 3);
  assert.equal(engine.state(), 'live');

  engine.stop();
});

test('with no transport at all, the poll still carries everything', () => {
  // Arrange — the web build, or a device whose socket never connects.
  const scheduler = manualScheduler();
  const refetch = counter();

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    scheduler,
  });

  // Act
  scheduler.advance(2);

  // Assert — a missing socket is not an error, and not a degraded state.
  assert.equal(refetch.hits, 2);
  assert.equal(engine.state(), 'live');

  engine.stop();
});

test('a socket that drops before connecting still polls', () => {
  // Arrange — the realistic Iranian-mobile failure: the join never lands.
  const scheduler = manualScheduler();
  const refetch = counter();

  const subscribe: Subscribe = (_eventId, _onChange, onStatus) => {
    onStatus('reconnecting');
    return () => {};
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
  });

  // Act
  scheduler.advance(1);

  // Assert
  assert.equal(refetch.hits, 1);
  assert.equal(engine.state(), 'reconnecting');

  engine.stop();
});

test('a disabled engine neither subscribes nor polls', () => {
  // Arrange — a confirmed event needs no live updates.
  const scheduler = manualScheduler();
  const refetch = counter();
  let subscribed = false;

  const subscribe: Subscribe = () => {
    subscribed = true;
    return () => {};
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
    enabled: false,
  });

  // Act
  scheduler.advance(5);

  // Assert
  assert.equal(subscribed, false);
  assert.equal(refetch.hits, 0);
  assert.equal(scheduler.live(), 0);

  engine.stop();
});

test('stopping clears the interval, tears down the transport, and is idempotent', () => {
  // Arrange
  const scheduler = manualScheduler();
  const refetch = counter();
  let tornDown = 0;

  const subscribe: Subscribe = () => () => {
    tornDown += 1;
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
  });

  // Act
  scheduler.advance(1);
  engine.stop();
  engine.stop();
  scheduler.advance(5);

  // Assert — a screen that has gone cannot keep spending requests, and a double
  // unmount (which React does in development) must not tear down twice.
  assert.equal(refetch.hits, 1);
  assert.equal(tornDown, 1);
  assert.equal(scheduler.live(), 0);
});

test('a transport change reaches subscribers without touching the poll', () => {
  // Arrange — the socket comes back. The poll must not be disturbed.
  const scheduler = manualScheduler();
  const refetch = counter();
  const states: ConnectionState[] = [];

  // A holder, not a bare `let`: TypeScript narrows a `let` that is only ever
  // assigned inside a callback down to `null`, and then the call below is
  // `never`-typed.
  const transport: { report: ((state: ConnectionState) => void) | null } = { report: null };

  const subscribe: Subscribe = (_eventId, _onChange, onStatus) => {
    transport.report = onStatus;
    onStatus('reconnecting');

    return () => {};
  };

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: refetch.refetch,
    subscribe,
    scheduler,
    onState: (state) => states.push(state),
  });

  // Act
  transport.report?.('live');
  scheduler.advance(1);

  // Assert
  //
  // `reconnecting` is the engine's STARTING state when a transport exists — it
  // does not yet know the socket is healthy — so a transport that immediately
  // reports `reconnecting` produces no transition at all. Only the recovery is
  // reported, which is what stops the indicator flashing on every mount.
  assert.deepEqual(states, ['live']);
  assert.equal(refetch.hits, 1);
  assert.equal(scheduler.live(), 1, 'the recovery path restarted the poll');

  engine.stop();
});

test('setRefetch swaps the closure without restarting anything', () => {
  // Arrange
  const scheduler = manualScheduler();
  const first = counter();
  const second = counter();

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: first.refetch,
    scheduler,
  });

  // Act
  engine.setRefetch(second.refetch);
  scheduler.advance(2);

  // Assert — a parent re-render must not resubscribe the channel or reset the
  // timer, which is what causes a "reconnecting" flicker on every render.
  assert.equal(first.hits, 0);
  assert.equal(second.hits, 2);

  engine.stop();
});

test('a failing poll backs off instead of retrying at full speed', () => {
  // ★ THE BUG THIS LOCKS OUT.
  //
  // The engine polled on a fixed interval and never looked at the outcome, so a
  // persistent 500 — a cold Vercel function with no TLS, for instance — was
  // retried six times a minute per screen, forever, each poll running ten
  // sequential queries. That load fed the failure it was retrying.
  const scheduler = manualScheduler();
  const outcomes: boolean[] = [];

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: () => {},
    scheduler,
    onPollResult: (failed) => outcomes.push(failed),
  });

  // Act — three failures in a row.
  scheduler.advance(1);
  engine.reportPollResult(true);
  scheduler.advance(1);
  engine.reportPollResult(true);
  scheduler.advance(1);
  engine.reportPollResult(true);

  // Assert — the armed delays grow, and the very first one is the healthy floor.
  const delays = scheduler.delays();
  assert.equal(delays[0], POLL_INTERVAL_MS, 'the healthy cadence changed');
  const last = delays[delays.length - 1] ?? 0;
  assert.ok(last > POLL_INTERVAL_MS, `the wait never grew: ${JSON.stringify(delays)}`);

  engine.stop();
});

test('a success returns the poll to the healthy cadence', () => {
  // Arrange
  const scheduler = manualScheduler();

  const engine = createRealtimeEngine({
    eventId: 'e1',
    refetch: () => {},
    scheduler,
    onPollResult: () => {},
  });

  // Act — fail twice, then succeed.
  scheduler.advance(1);
  engine.reportPollResult(true);
  scheduler.advance(1);
  engine.reportPollResult(true);
  scheduler.advance(1);
  engine.reportPollResult(false);

  // Assert — backing off from a success would make the product feel slow for no
  // reason, so the cadence must snap back to the floor.
  const delays = scheduler.delays();
  assert.equal(delays[delays.length - 1], POLL_INTERVAL_MS);

  engine.stop();
});
