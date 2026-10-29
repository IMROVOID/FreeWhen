/**
 * Cards carry their separation in their fill, not in a drawn edge.
 *
 * ★ THE BORDER WAS ADDED FOR A REAL REASON AND THEN OUTLIVED IT.
 *
 * `surface` cards got a `cardEdge` hairline when the light page was 97% lightness
 * and a white card on it had no boundary at all. That page has since been stepped
 * down into the palette's warm hue, so `surface1` on `bg` is a real difference and
 * the hairline became a second boundary — a drawn box around every event and every
 * proposal. The request is to take it out.
 *
 * The repo's own WORDS say the same thing: a card is separated by its fill, and
 * `line` is reserved for an outlined CONTROL.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  FRAME_MAX_WIDTH,
  TABLET_BREAKPOINT,
} from '@/src/components/ui/overlay-surface';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CARD = code('src/components/ui/Card.tsx');
const PROPOSAL = code('src/features/proposals/components/ProposalCard.tsx');

/* ── The card ─────────────────────────────────────────────────────────────── */

test('a surface card paints no border', () => {
  // Act
  const paints = /variant === 'surface' && \{ borderWidth/.test(CARD);
  const base = /base:\s*\{([^}]*)\}/.exec(CARD)?.[1] ?? '';

  // Assert
  assert.ok(!paints, 'a surface card still paints a hairline');
  assert.ok(!/borderWidth/.test(base), 'the card base declares a border');
});

test('the card keeps its fill and its radius', () => {
  // Act — the removal must take the BORDER, not the separation.

  // Assert
  assert.ok(/backgroundColor: background/.test(CARD), 'the card lost its fill, so it has no boundary at all');
  assert.ok(/borderRadius: radius\.lg/.test(CARD), 'the card lost its radius');
});

test('the card no longer imports the border tokens it stopped using', () => {
  // Arrange — a leftover import is how a removed edge creeps back.
  const imports = /import \{[^}]*\} from '@\/src\/theme\/tokens'/.exec(CARD)?.[0] ?? '';

  // Assert
  assert.ok(!/\bborder\b/.test(imports.replace(/borderRadius/g, '')), 'the card still imports a border token');
});

/* ── The proposal ─────────────────────────────────────────────────────────── */

test('the proposal’s venue block has no border either', () => {
  // Arrange — a hairline here drew a second rectangle inside a card that no longer
  // has one, so a proposal read as a box inside a box.
  const venue = /venueBlock:\s*\{([\s\S]*?)\n {2}\},/.exec(PROPOSAL)?.[1] ?? '';

  // Act / Assert
  assert.ok(venue.length > 0, 'the venue block style is missing');
  assert.ok(!/borderWidth/.test(venue), 'the venue block still paints a border');
  assert.ok(!/borderColor/.test(venue), 'the venue block still names a border colour');
});

/* ── The notice table ─────────────────────────────────────────────────────── */

test('the notice table is not a bordered card', () => {
  // Arrange
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act / Assert
  assert.ok(!/<Card\b/.test(viewer), 'the table is still inside a Card, which brings a surface and an edge');
});

/* ── The frame ────────────────────────────────────────────────────────────── */

test('the desktop frame still declares its column edge, which is not a card', () => {
  // Arrange — the frame's rule separates the app from the canvas behind it, not one
  // content box from another, and the request is about the boxes.
  const frame = code('src/components/ui/AppFrame.web.tsx');

  // Act / Assert
  assert.ok(/borderStartWidth: StyleSheet\.hairlineWidth/.test(frame), 'the frame lost its column edge');
  assert.equal(FRAME_MAX_WIDTH, 520);
  assert.equal(TABLET_BREAKPOINT, 768);
});
