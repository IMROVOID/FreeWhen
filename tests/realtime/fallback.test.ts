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

/** A scheduler the test advances by hand, so nothing sleeps for ten seconds. */
function manualScheduler(): Scheduler & { advance: (times?: number) => void; live: () => number } {
  const callbacks = new Set<() => void>();

  return {
    setInterval(callback) {
      callbacks.add(callback);
      return callback;
    },
    clearInterval(handle) {
      callbacks.delete(handle as () => void);
      return undefined;
    },
    advance(times = 1) {
      for (let index = 0; index < times; index++) {
        for (const callback of callbacks) callback();
      }
    },
    live() {
      return callbacks.size;
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
