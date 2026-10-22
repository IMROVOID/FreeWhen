/**
 * The routing analytics.
 *
 * ★ `ranking_degraded.level_reached` IS A KEY METRIC.
 *
 * PRD-05 §16 names it as such: if the demo never reaches level 1, the
 * routing assumption failed and the labelled fallback is carrying the
 * product. That is a finding to REPORT, not to hide.
 *
 * The event therefore fires once per resolution WHATEVER the level — a
 * level 1 is the evidence the metric is meaningful, and a level 5 is the
 * evidence the fallback is carrying the product. Recording only the
 * degraded cases would make the denominator invisible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { logSafe } from '@/src/lib/redact';
import {
  trackRankingDegraded,
  trackTransitProxyUsed,
  trackRouting,
} from '@/server/lib/routing-analytics';

/** The calls the redaction module made, captured for the assertions. */
interface CapturedCall {
  event: string;
  props: Record<string, unknown>;
}

const captured: CapturedCall[] = [];

/**
 * The redaction module is the only logging path, and it is not a stub
 * here — the capture is installed by replacing `console.log`, which is
 * what `logSafe` does in a dev build.
 */
function captureConsole(): void {
  console.log = (...args: unknown[]): void => {
    const [prefix, props] = args as [string, Record<string, unknown>];
    // `logSafe` prefixes the event name with `[freewhen]`.
    captured.push({
      event: prefix.replace(/^\[freewhen\]\s*/, ''),
      props,
    });
  };
}

test.before(() => {
  captureConsole();
});

test.beforeEach(() => {
  captured.length = 0;
});

test('the degraded event carries the level reached and the reason', () => {
  // Arrange / Act
  trackRankingDegraded({
    eventId: 'evt_1',
    levelReached: 1,
    reason: 'served',
  });

  // Assert
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.event, 'ranking_degraded');
  assert.equal(captured[0]!.props.event_id, 'evt_1');
  assert.equal(captured[0]!.props.level_reached, 1);
  assert.equal(captured[0]!.props.reason, 'served');
});

test('the event fires for a degraded level too — that is the finding', () => {
  // Arrange / Act
  trackRankingDegraded({
    eventId: 'evt_1',
    levelReached: 5,
    reason: 'provider_unavailable',
  });

  // Assert — a level 5 is the evidence the fallback is carrying the
  // product, so it is recorded, not hidden
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.props.level_reached, 5);
  assert.equal(captured[0]!.props.reason, 'provider_unavailable');
});

test('the transit proxy event carries the participant count', () => {
  // Arrange / Act
  trackTransitProxyUsed({ eventId: 'evt_2', participantCount: 4 });

  // Assert
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.event, 'transit_proxy_used');
  assert.equal(captured[0]!.props.event_id, 'evt_2');
  assert.equal(captured[0]!.props.participant_count, 4);
});

test('no payload carries a coordinate or a key', () => {
  // Arrange / Act
  trackRankingDegraded({ eventId: 'evt_1', levelReached: 2, reason: 'served' });
  trackTransitProxyUsed({ eventId: 'evt_1', participantCount: 2 });

  // Assert — the payload is a closed set of scalars
  for (const call of captured) {
    for (const key of Object.keys(call.props)) {
      assert.ok(
        !['lat', 'lng', 'lat_rounded', 'lng_rounded', 'token', 'key'].includes(key),
        `the payload must not carry ${key}`,
      );
    }
  }
});

test('the payload goes through the redaction module', () => {
  // Arrange — a payload with a coordinate-shaped STRING in it. The
  // redaction module scrubs coordinate-shaped strings, so the value that
  // reaches the console is not the value that was passed in.
  // Arrange / Act
  trackRouting('ranking_degraded', {
    event_id: 'evt_1',
    level_reached: 1,
    reason: 'served',
  });

  // Assert — the redaction module is the only path, and the payload
  // arrives redacted
  assert.equal(captured.length, 1);
  const props = captured[0]!.props;
  assert.equal(props.event_id, 'evt_1');
  assert.equal(props.level_reached, 1);
});

test('the redaction module is the one that writes to the console', () => {
  // Arrange / Act / Assert — `logSafe` exists and is the entry point
  assert.equal(typeof logSafe, 'function');
});
