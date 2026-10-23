/**
 * When push permission may be requested (Plan 10 Task 7 — FR-6.14, AC-6.2.1).
 *
 * ★ THE RULE IS ABOUT TIMING, NOT ABOUT ASKING AT ALL.
 *
 * A launch prompt is denied because it arrives before the user has any reason to
 * say yes — and on iOS a denial is expensive: the app gets one prompt and then
 * only Settings can undo it. So the request hangs off the first successful vote.
 *
 * The hook and the decision screen both call `shouldRequestAfterVote`; this file
 * asserts the rule directly, from a module that imports no React Native.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { shouldRequestAfterVote } from '../../src/features/notifications/services/push-timing';

describe('the push-permission gate', () => {
  test('★ does not ask before the first vote', () => {
    // A vote that CHANGED an existing answer is not the first one. Asking here
    // would spend the single iOS prompt on a user who already passed the moment
    // that earned it.
    assert.equal(shouldRequestAfterVote({ isFirstVote: false, hasAsked: false }), false);
  });

  test('★ asks on the first vote', () => {
    assert.equal(shouldRequestAfterVote({ isFirstVote: true, hasAsked: false }), true);
  });

  test('never asks twice', () => {
    // Voting for the first time on a SECOND proposal is the case that would
    // double-prompt without the device-level flag.
    assert.equal(shouldRequestAfterVote({ isFirstVote: true, hasAsked: true }), false);
  });

  test('the gate is the AND of both conditions, not either', () => {
    for (const isFirstVote of [true, false]) {
      for (const hasAsked of [true, false]) {
        assert.equal(
          shouldRequestAfterVote({ isFirstVote, hasAsked }),
          isFirstVote && !hasAsked,
          `isFirstVote=${isFirstVote} hasAsked=${hasAsked}`,
        );
      }
    }
  });
});

describe('the rule cannot be satisfied by launch alone', () => {
  test('there is no inputs combination that asks without a vote', () => {
    // ★ THE LAUNCH PROMPT IS EXCLUDED BY THE TYPE, NOT BY A CONVENTION.
    //
    // FR-6.14's failure mode is a prompt that fires on mount. `VoteOutcome`
    // carries `isFirstVote`, so the only way to reach `true` is to claim a first
    // vote happened — there is no "app just started" input that returns true.
    const everyCombination = [true, false].flatMap((isFirstVote) =>
      [true, false].map((hasAsked) => ({ isFirstVote, hasAsked })),
    );

    const asks = everyCombination.filter(shouldRequestAfterVote);

    assert.deepEqual(asks, [{ isFirstVote: true, hasAsked: false }]);
  });
});
