/**
 * The event page's `New Proposal` button sits above the list.
 *
 * ★ THE REPORT: "MOVE `NEW PROPOSAL` BUTTON ON TOP OF ALL PROPOSALS IN EVENT PAGE."
 *
 * It was rendered after every card, so on an event with a dozen proposals the one
 * action that adds another was a full scroll past all of them — furthest away exactly
 * when the list is longest, and reading as a footer to the page rather than as the
 * list's own action.
 *
 * Two things are asserted, and the second is the one a careless move breaks: the
 * button must be ABOVE the list, and there must still be exactly one of it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const HOME = readFileSync('app/event/[id]/index.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Where the one action button is rendered, by its test id. */
function buttonAt(): number {
  return HOME.indexOf('testID="event-home-new-proposal"');
}

test('the action is above the list it adds to', () => {
  // Arrange
  const button = buttonAt();
  const heading = HOME.indexOf('styles.listHeading');
  const map = HOME.indexOf('<EventRouteMap');
  const cards = HOME.indexOf('rankedProposals.map((proposal) => {');

  // Assert — every anchor exists, and the button precedes each of them.
  assert.ok(button > 0, 'the event home no longer renders a new-proposal action');
  assert.ok(heading > 0 && map > 0 && cards > 0, 'the list’s own anchors moved');
  assert.ok(button > heading, 'the action is not attached to the list heading');
  assert.ok(button < map, 'the action is below the map the list opens with');
  assert.ok(button < cards, 'the action is still below the proposals');
});

test('there is exactly one new-proposal action in the non-empty state', () => {
  // Arrange — the empty state carries its own copy inside its prompt, so two on one
  // screen is one too many.
  const occurrences = HOME.split('testID="event-home-new-proposal"').length - 1;

  // Assert
  assert.equal(occurrences, 1, `the screen renders ${occurrences} new-proposal actions`);
});

test('the empty state keeps its own first-proposal action', () => {
  // Assert — AC-11.3.1: the prompt is the ACTION, not a description of the emptiness.
  assert.match(HOME, /testID="event-home-proposals-empty-action"/);
});
