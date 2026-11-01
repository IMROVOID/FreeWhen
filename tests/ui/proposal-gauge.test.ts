/**
 * The proposal gauge is an INSIDE edge, and the card/controls pair is one unit.
 *
 * ★ THE REPORTS.
 *
 * "Move the votes bar/border on proposal boxes INSIDE the box, not outside, like an
 * inside-border, and mask it to the background so it won't overflow the box's rounded
 * corner."
 *
 * "Reduce the spacing between the proposal box and its vote buttons/guide (stats) just
 * a little."
 *
 * The gauge was already absolutely placed inside the card and clipped by it. What made
 * it read as OUTSIDE was two things: its track was `transparent`, so the unfilled part
 * showed the page rather than the box; and its corners were `radius.md` inside a
 * `radius.lg` card, so its square ends crossed the card's curve.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { space } from '@/src/theme/tokens';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const BAR = code('src/features/proposals/components/VoteShareBar.tsx');
const CARD = code('src/features/proposals/components/ProposalCard.tsx');
const SCREEN = code('app/event/[id]/index.tsx');

/* ── The gauge ────────────────────────────────────────────────────────────── */

test('the bar takes a radius from its caller, so the two cannot disagree', () => {
  assert.match(BAR, /cornerRadius\?: number;/);
  assert.match(CARD, /cornerRadius=\{radius\.lg\}/, 'the card does not give the bar its own radius');
});

test('the bar’s corners follow the edge it is drawn against', () => {
  // Arrange
  const corners = /const corners =([\s\S]*?);/.exec(BAR)?.[1] ?? '';

  // Act / Assert — a top bar rounds its top corners and nothing else, so a bar at the
  // foot cannot be rounded on the wrong side.
  assert.match(corners, /position === 'top'/);
  assert.match(corners, /borderTopLeftRadius: cornerRadius/);
  assert.match(corners, /borderBottomLeftRadius: cornerRadius/);
});

test('the fill takes the bar’s corners too, so a full bar ends inside the curve', () => {
  assert.match(BAR, /styles\.fill, corners/);
});

test('the track is painted, not transparent', () => {
  // ★ A transparent track let the PAGE show through the unfilled part, which is what
  // made the gauge read as a strip under the box rather than an edge of it.
  assert.doesNotMatch(BAR, /backgroundColor: 'transparent'/);
  assert.match(BAR, /trackColor\?: string;/);
  assert.match(CARD, /trackColor=\{theme\.surface1\}/, 'the card does not paint the track with its own fill');
});

test('the bar is still clamped, so a bad payload cannot overflow the box', () => {
  assert.match(BAR, /Math\.min\(1, Math\.max\(0, share\)\)/);
});

test('the bar is still clipped by its own track', () => {
  assert.match(BAR, /overflow: 'hidden'/);
});

/* ── The spacing ──────────────────────────────────────────────────────────── */

test('the card reserves one step of clear space for the gauge, not two', () => {
  // Arrange — the foot is the bar plus a clearance step.
  const padding = /cardWithShare: \{([\s\S]*?)\n {2}\}/.exec(CARD)?.[1] ?? '';

  // Assert — `space[4]` was twenty points under the last line, which made the vote
  // controls read as the NEXT proposal's.
  assert.match(padding, /paddingBottom: space\[3\] \+ space\[1\]/);
  assert.ok(space[3] < space[4]);
});

test('the card and its controls are one block, one step tighter', () => {
  // Arrange
  const block = /proposalBlock: \{([\s\S]*?)\n {2}\}/.exec(SCREEN)?.[1] ?? '';

  // Act / Assert
  assert.ok(block.length > 0, 'the proposal block is no longer findable');
  assert.match(block, /gap: space\[3\]/, 'the card-to-controls gap is not the reduced step');
});

test('two proposals are still further apart than one proposal and its buttons', () => {
  // Assert — the grouping reads right only if the two gaps differ.
  const list = /list: \{([\s\S]*?)\n {2}\}/.exec(SCREEN)?.[1] ?? '';
  const block = /proposalBlock: \{([\s\S]*?)\n {2}\}/.exec(SCREEN)?.[1] ?? '';

  assert.match(list, /gap: space\[6\]/);
  assert.match(block, /gap: space\[3\]/);
});

test('the gauge still lives on the card’s own bottom edge', () => {
  // Arrange
  const slot = /shareSlot: \{([\s\S]*?)\n {2}\}/.exec(CARD)?.[1] ?? '';

  // Assert
  assert.match(slot, /position: 'absolute'/);
  assert.match(slot, /bottom: 0/);
});

test('the clip lands on the surface that has the radius, not on a wrapper', () => {
  // ★ THIS IS THE "STILL OUTSIDE THE BOX" DEFECT, AND IT WAS A PROP-PLACEMENT BUG.
  //
  // `Card` paints the radius and the fill on an INNER view; a `style` prop lands on
  // an outer wrapper that paints nothing. Passing `overflow: 'hidden'` through
  // `style` therefore clipped a box the reader cannot see while the gauge — a child
  // of the inner view — escaped the visible card and hung below it. The reservation
  // has to travel with it, or the gauge would sit over the last line of text.
  assert.match(CARD, /bleed=\{share !== undefined \? styles\.cardWithShare : undefined\}/);

  const share = /cardWithShare: \{([\s\S]*?)\n {2}\}/.exec(CARD)?.[1] ?? '';
  assert.ok(share.length > 0, 'the share style is gone');
  assert.match(share, /overflow: 'hidden'/, 'the surface does not clip');
  assert.match(share, /paddingBottom: space\[3\] \+ space\[1\]/);
});

test('the card component applies leed to the painted surface', () => {
  // Arrange ★ THE MECHANISM, ASSERTED WHERE IT LIVES.
  const card = code('src/components/ui/Card.tsx');

  // Act — the inner view is the one carrying styles.base and the background.
  const surface = /styles\.base,([\s\S]*?)>/.exec(card)?.[1] ?? '';

  // Assert
  assert.ok(surface.length > 0, 'the surface view is no longer findable');
  assert.match(surface, /\bbleed\b/, 'leed never reaches the view with the radius');
  assert.match(card, /bleed\?: StyleProp<ViewStyle>;/, 'the prop is not declared');
});

test('a card that does not pass leed is unchanged', () => {
  // Assert — the prop is optional, so every other caller keeps the box it had.
  const card = code('src/components/ui/Card.tsx');
  assert.match(card, /style=\{style\}/, 'the outer wrapper stopped taking style');
});