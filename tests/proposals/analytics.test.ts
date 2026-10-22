/**
 * Proposal analytics (Plan 06 Task 13, PRD-02 §9, PRD-03 §9).
 *
 * ★ THE ASSERTION THAT MATTERS: NO COORDINATE AND NO NAME REACHES A LOG LINE.
 *
 * The threshold that decides "duplicate" is tuned from these events, so they do
 * have to carry the resolution. What they must never carry is where the place
 * is or who proposed it — a metric is not a licence to log a location.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  trackDuplicateResolution,
  trackOpeningHoursWarningShown,
  trackTimezoneMismatchShown,
} from '../../src/features/proposals/services/analytics';

/**
 * Captures what `logSafe` writes, for the duration of one test.
 *
 * `logSafe` emits `console.log('[freewhen] <event>', payload)` and only when
 * `__DEV__` is set, so the harness supplies both: the flag, and a sink that
 * records the label and the payload.
 */
function captureLog(body: () => void): Array<{ event: string; payload: Record<string, unknown> }> {
  const globalScope = globalThis as unknown as { __DEV__?: boolean; console: Console };
  const originalLog = globalScope.console.log;
  const hadDev = '__DEV__' in globalScope;
  const originalDev = globalScope.__DEV__;

  const lines: Array<{ event: string; payload: Record<string, unknown> }> = [];

  globalScope.__DEV__ = true;
  globalScope.console.log = (...args: unknown[]) => {
    const label = String(args[0] ?? '');
    const payload = args[1];

    if (payload && typeof payload === 'object') {
      lines.push({
        event: label.replace('[freewhen] ', ''),
        payload: payload as Record<string, unknown>,
      });
    }
  };

  try {
    body();
  } finally {
    globalScope.console.log = originalLog;
    if (hadDev) globalScope.__DEV__ = originalDev;
    else delete globalScope.__DEV__;
  }

  return lines;
}

describe('duplicate_detected', () => {
  test('records each resolution separately', () => {
    // ★ The pair is the metric: a rising `created_anyway` share is what says
    // the 75 m threshold is too wide, long before anyone reports it.
    const voted = captureLog(() => trackDuplicateResolution('voted_existing', 'same_provider_place'));
    const anyway = captureLog(() => trackDuplicateResolution('created_anyway', 'near_and_similar'));

    assert.equal(voted.length, 1);
    assert.equal(anyway.length, 1);
    assert.equal(voted[0]?.event, 'duplicate_detected');
    assert.notEqual(
      JSON.stringify(voted[0]),
      JSON.stringify(anyway[0]),
      'the two resolutions must be distinguishable',
    );
  });

  test('carries the resolution and the match reason', () => {
    const lines = captureLog(() => trackDuplicateResolution('voted_existing', 'near_and_similar'));
    const payload = JSON.stringify(lines[0]);

    assert.equal(lines[0]?.event, 'duplicate_detected');

    assert.match(payload, /voted_existing/);
    assert.match(payload, /near_and_similar/);
  });
});

describe('timezone_mismatch_shown', () => {
  test('records the two zone names', () => {
    const lines = captureLog(() => trackTimezoneMismatchShown('Europe/Berlin', 'Asia/Tehran'));
    const payload = JSON.stringify(lines[0]);

    assert.equal(lines[0]?.event, 'timezone_mismatch_shown');

    // IANA identifiers are not locations — they say nothing about where in a
    // city someone is.
    assert.match(payload, /Europe\/Berlin/);
    assert.match(payload, /Asia\/Tehran/);
  });
});

describe('opening_hours_warning_shown', () => {
  test('records whether the hours were known', () => {
    const unknown = captureLog(() => trackOpeningHoursWarningShown(false));
    const known = captureLog(() => trackOpeningHoursWarningShown(true));

    assert.equal(unknown[0]?.event, 'opening_hours_warning_shown');
    assert.notEqual(JSON.stringify(unknown[0]), JSON.stringify(known[0]));
  });
});

describe('privacy', () => {
  test('no coordinate reaches the log from any of these events', () => {
    // The analytics payloads are closed scalar sets, so a coordinate cannot be
    // attached — and `logSafe` scrubs it anyway if one ever is.
    const lines = [
      ...captureLog(() => trackDuplicateResolution('created_anyway', 'near_and_similar')),
      ...captureLog(() => trackOpeningHoursWarningShown(false)),
      ...captureLog(() => trackTimezoneMismatchShown('Europe/Berlin', 'Asia/Tehran')),
    ];

    assert.ok(lines.length >= 3, 'every event was captured');

    for (const line of lines) {
      const payload = JSON.stringify(line);
      assert.doesNotMatch(payload, /\b3[45]\.\d+/, 'a latitude leaked into analytics');
      assert.doesNotMatch(payload, /\b5[01]\.\d+/, 'a longitude leaked into analytics');
    }
  });
});
