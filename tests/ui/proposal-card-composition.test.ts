/**
 * The proposal card's composition: action first, gauge inside, venue boxed off.
 *
 * ★ THE DEFECTS THIS PINS.
 *
 *  - The three vote pills came AFTER the tally and the share bar. On every card the
 *    numbers arrived before the control the screen exists for, so the tallies read as
 *    a result to interpret rather than as context for a question still open.
 *  - The share bar was a SIBLING of the card — a hairline floating in the list's gap
 *    with nothing tying it to the proposal it described. It is now drawn inside the
 *    card's bottom edge and clipped by the card's own radius.
 *  - The venue box sat the same distance from the time block as two lines of text sit
 *    from each other, so a bordered box read as welded to the element above it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const EVENT_HOME = 'app/event/[id]/index.tsx';

test('the vote control comes before the tallies on a proposal block', () => {
  // Arrange
  const home = code(EVENT_HOME);

  // Act — both are inside the same `proposalBlock`; order is what the reader sees.
  const voteAt = home.indexOf('<VoteControl');
  const tallyAt = home.indexOf('<TallyBar');

  // Assert
  assert.ok(voteAt > 0, 'the block no longer renders the vote control');
  assert.ok(tallyAt > 0, 'the block no longer renders the tally');
  assert.ok(voteAt < tallyAt, 'the tallies still come before the vote controls');
});

test('the share gauge is drawn by the card, not beside it', () => {
  // Arrange
  const home = code(EVENT_HOME);
  const card = code('src/features/proposals/components/ProposalCard.tsx');

  // Assert — the card owns it…
  assert.ok(
    /share=\{/.test(home),
    'the event home does not hand the share to the card',
  );
  assert.ok(
    !/<VoteShareBar/.test(home),
    'the event home still renders a standalone share bar beside the card',
  );

  // …and draws it in the card's own tree.
  assert.ok(/<VoteShareBar/.test(card), 'the card does not draw the gauge');
  assert.ok(
    /shareSlot:\s*\{[^}]*position:\s*'absolute'[^}]*bottom:\s*0/.test(card),
    'the gauge is not pinned to the card’s bottom edge',
  );
  assert.ok(
    /card:\s*\{[^}]*overflow:\s*'hidden'/.test(card),
    'the card does not clip the gauge to its own radius',
  );
});

test('the card leaves room for the gauge so it cannot overlap the footer', () => {
  // Arrange — the bar is absolutely placed, so it takes no space in the flow.
  const card = code('src/features/proposals/components/ProposalCard.tsx');

  // Act
  const padded = /cardWithShare:\s*\{[^}]*paddingBottom/.test(card);
  const applied = /share !== undefined \? styles\.cardWithShare/.test(card);

  // Assert
  assert.ok(padded, 'the card declares no bottom padding for the gauge');
  assert.ok(applied, 'the padding is never applied');
});

test('the venue box is separated from the element above it', () => {
  // Arrange — the card's gap is uniform, so this has to be local to the block.
  const card = code('src/features/proposals/components/ProposalCard.tsx');

  // Act
  const venue = /venueBlock:\s*\{([\s\S]{0,900}?)\},/.exec(card)?.[1] ?? '';

  // Assert
  assert.ok(venue.length > 0, 'the venue block style was not found');
  assert.ok(/marginTop/.test(venue), 'the venue box has no top margin, so it touches the block above');
});

test('the gauge still states its own share and stays a progressbar', () => {
  // Arrange
  const bar = code('src/features/proposals/components/VoteShareBar.tsx');

  // Assert
  assert.ok(/accessibilityRole="progressbar"/.test(bar), 'the bar is not a progressbar');
  assert.ok(/Math\.min\(1, Math\.max\(0, share\)\)/.test(bar) || /clamped/.test(bar), 'the share is not clamped');
});
