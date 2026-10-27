/**
 * The general notifications switch (Plan 49 T18).
 *
 * ★ THE REQUIREMENT IS RESTORE, NOT ENABLE-EVERYTHING.
 *
 * "Enabling back should return the original state of all Events not forcefully
 * enabling all." A one-bit flag cannot express that: the events a person had muted
 * individually before turning notifications off would come back on, silently
 * reversing a choice they made on purpose. So switching off snapshots the muted
 * set and switching on replays exactly that set.
 *
 * These assertions are the reason the state is a snapshot rather than a boolean.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INITIAL_SWITCH,
  disableAll,
  displayedEventMute,
  enableAll,
  isEventRowInteractive,
} from '@/src/features/notifications/services/general-switch';

test('the switch starts on', () => {
  // Act / Assert — a fresh install has notifications enabled.
  assert.equal(INITIAL_SWITCH.enabled, true);
  assert.deepEqual(INITIAL_SWITCH.previousMuted, []);
});

test('turning the switch off snapshots which events were already muted', () => {
  // Arrange
  const alreadyMuted = ['event-a', 'event-c'];

  // Act
  const state = disableAll(alreadyMuted);

  // Assert
  assert.equal(state.enabled, false);
  assert.deepEqual(state.previousMuted, alreadyMuted);
});

test('re-enabling restores exactly the events that were muted, and no others', () => {
  // ★ THE WHOLE POINT OF THE TASK.
  //
  // The muted set was {a, c}. After off and back on it must STILL be {a, c} — not
  // empty (which would force every event's notifications on) and not everything.
  const state = disableAll(['event-a', 'event-c']);

  // Act
  const { restoredMuted } = enableAll(state);

  // Assert
  assert.deepEqual(restoredMuted, ['event-a', 'event-c']);
});

test('an event that was NOT muted before does not become muted', () => {
  // Arrange — only `a` was muted.
  const state = disableAll(['event-a']);

  // Act
  const { restoredMuted } = enableAll(state);

  // Assert — `b` must come back unmuted.
  assert.equal(restoredMuted.includes('event-b'), false, 'an unmuted event came back muted');
});

test('the snapshot is consumed, not retained', () => {
  // Arrange — one full off/on cycle with `a` muted.
  const afterOneCycle = enableAll(disableAll(['event-a']));

  // Act — a second cycle, with nothing muted.
  const afterTwoCycles = disableAll([]);
  const { restoredMuted } = enableAll(afterTwoCycles);

  // Assert — holding the old snapshot would replay `a` two cycles later.
  assert.deepEqual(afterOneCycle.state.previousMuted, []);
  assert.deepEqual(restoredMuted, []);
});

test('the snapshot is a copy, so a later mutation cannot rewrite history', () => {
  // Arrange
  const live = ['event-a'];

  // Act
  const state = disableAll(live);
  live.push('event-z');

  // Assert — an aliased array would make the restore depend on what happened after
  // the switch was flipped.
  assert.deepEqual(state.previousMuted, ['event-a']);
});

test('per-event rows are not interactive while the general switch is off', () => {
  // Act / Assert
  assert.equal(isEventRowInteractive(INITIAL_SWITCH), true);
  assert.equal(isEventRowInteractive(disableAll([])), false);
});

test('a per-event row DISPLAYS muted while the general switch is off, without changing value', () => {
  // ★ GREYED OUT IS A DISPLAY FACT, NOT A DATA CHANGE.
  //
  // Rendering an unmuted event as "off" is honest — the app has silenced it — but
  // the stored value must stay untouched, which is why this is a separate function
  // from the state. The restore then has nothing to put back.
  const off = disableAll(['event-a']);

  // Act / Assert
  assert.equal(displayedEventMute(off, false), true, 'an unmuted row is not greyed');
  assert.equal(displayedEventMute(off, true), true);

  // And with the switch on, the stored value is what shows.
  assert.equal(displayedEventMute(INITIAL_SWITCH, false), false);
  assert.equal(displayedEventMute(INITIAL_SWITCH, true), true);
});
