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

test('the card still clips what it draws, which is what makes the mask real', () => {
  const card = /card: \{([\s\S]*?)\n {2}\}/.exec(CARD)?.[1] ?? '';
  assert.match(card, /overflow: 'hidden'/);
});
