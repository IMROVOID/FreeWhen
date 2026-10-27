/**
 * The owner is asked for a location too — once, on first entry.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * The starting-point prompt was not gated on a role, but it was only ever
 * REACHED by one route: the invite screen navigated to `/e/[token]/location`
 * after a successful join. The owner's path never did. `POST /api/events` →
 * `/new/invite` → `/event/:id` went straight to the event home, so the organiser
 * — who is a first-class participant with a `'organizer'` role row and no start
 * point, exactly like a member — was the one person in the event whose travel
 * time the ranking silently left out.
 *
 * ★ AND IT CANNOT BE A ROLE CHECK.
 *
 * Joining and organising are two routes into the same question. The condition is
 * "I am a participant here and I have not answered", which is
 * `start_point_state === 'none'` — a member who skips also answers `'none'` by
 * choosing to, and must not be asked again on every visit. So the gate is:
 *
 *   asked  — this mount has already offered the question
 *   none   — the server says this participant has no start point
 *   ready  — the event has finished loading (an unanswered load is not `'none'`,
 *            it is "we do not know", and prompting on that would ask the owner
 *            again before their own event finished rendering)
 *
 * ★ IT ASKS, IT DOES NOT REDIRECT.
 *
 * The invite flow replaces the route outright, which is right: a guest is not yet
 * anywhere. The owner has just landed on their own event and is its organiser —
 * pulling them off it before they have seen it is a different, worse product.
 * The prompt opens over the page, and the page keeps working behind it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { shouldOfferStartPoint } from '@/src/features/participants/services/start-point-gate';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('a participant with no start point is asked', () => {
  // Act / Assert
  assert.equal(shouldOfferStartPoint({ state: 'none', ready: true, asked: false }), true);
});

test('a participant who has given one is not asked again', () => {
  // Act / Assert
  assert.equal(shouldOfferStartPoint({ state: 'shared', ready: true, asked: false }), false);
  assert.equal(shouldOfferStartPoint({ state: 'not_shared', ready: true, asked: false }), false);
});

test('someone who skipped is not asked on every visit', () => {
  // Arrange — "skip" is a decision, and re-asking it is nagging. The server says
  // `'none'` for both "never asked" and "chose not to", so the local asked flag
  // is what separates them.
  // Act / Assert
  assert.equal(shouldOfferStartPoint({ state: 'none', ready: true, asked: true }), false);
});

test('an event that has not loaded is not "no start point"', () => {
  // Act / Assert — prompting on an unanswered load would flash the sheet at the
  // owner before their own event rendered.
  assert.equal(shouldOfferStartPoint({ state: 'none', ready: false, asked: false }), false);
  assert.equal(shouldOfferStartPoint({ state: null, ready: false, asked: false }), false);
});

test('an unknown state is not treated as missing', () => {
  // Act / Assert
  assert.equal(shouldOfferStartPoint({ state: null, ready: true, asked: false }), false);
  assert.equal(shouldOfferStartPoint({ state: 'unknown', ready: true, asked: false }), false);
});

test('★ the owner path reaches the prompt without a role check', () => {
  // Arrange — the prompt must not be keyed on `organizer`/`member`; the two
  // roles arrive by different routes and ask the same question.
  const gate = code('src/features/participants/services/start-point-gate.ts');

  // Act / Assert
  assert.ok(!/organizer|is_organizer|isOwner|role ===/.test(gate), 'the gate keys on a role');
});

test('the event screen offers the prompt on first entry', () => {
  // Arrange
  const eventScreen = code('app/event/[id]/index.tsx');

  // Act
  const usesGate = /shouldOfferStartPoint/.test(eventScreen);
  const rendersPrompt = /StartPointSheet|StartPointPrompt/.test(eventScreen);

  // Assert
  assert.ok(usesGate, 'the event screen never decides whether to ask');
  assert.ok(rendersPrompt, 'the event screen renders no starting-point prompt');
});

test('the organiser is not redirected away from their own event', () => {
  // Arrange — `/new/invite` sent the owner to `/event/:id`; a redirect to the
  // location route from there would replace the event before it was seen.
  const gate = code('src/features/participants/services/start-point-gate.ts');

  // Act / Assert
  assert.ok(!/router\.replace|redirect/.test(gate), 'the gate navigates instead of asking');
});
