/**
 * The joined-events search (Plan 49 T11).
 *
 * ★ RESULTS MUST STAY IN THE SHEET.
 *
 * Filtering the home list in place would make the page's own state ambiguous —
 * "my events" or "my search results"? — and clearing the query would leave the
 * reader unsure what they were looking at. The assertion is that the sheet owns
 * both the query and the results.
 *
 * ★ AND THE MATCHING ITSELF IS WORTH PINNING.
 *
 * A search that is case-sensitive on a phone (where autocapitalisation is on) is
 * a search that finds nothing, which reads as a broken feature. The rule lives in
 * `services/event-search.ts` so it can be tested without mounting a bottom sheet.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { matchesQuery } from '@/src/features/events/services/event-search';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('an empty query matches everything', () => {
  // Act / Assert — opening the sheet must not show an empty list.
  assert.equal(matchesQuery('Friday dinner', ''), true);
  assert.equal(matchesQuery('Friday dinner', '   '), true);
});

test('matching is case-insensitive', () => {
  // ★ Autocapitalisation is on by default on a phone, so a case-sensitive search
  // finds nothing for the exact title the user is looking at.
  assert.equal(matchesQuery('Friday Dinner', 'friday'), true);
  assert.equal(matchesQuery('friday dinner', 'FRIDAY'), true);
  assert.equal(matchesQuery('Friday Dinner', 'DINNER'), true);
});

test('a substring in the middle matches', () => {
  // Arrange / Act / Assert — a prefix-only search would miss a title where the
  // remembered word is not the first one.
  assert.equal(matchesQuery('Team offsite in Tabriz', 'offsite'), true);
  assert.equal(matchesQuery('Team offsite in Tabriz', 'tabriz'), true);
});

test('a non-matching query does not match', () => {
  // Act / Assert
  assert.equal(matchesQuery('Friday dinner', 'picnic'), false);
});

test('the results render inside the sheet, not on the home page', () => {
  // Arrange
  const sheet = code('src/features/events/components/EventSearchSheet.tsx');
  const home = code('app/index.tsx');

  // Act / Assert — the sheet renders its own `EventRow`s…
  assert.ok(/EventRow/.test(sheet), 'the sheet renders no results at all');

  // …and the home page mounts the sheet rather than filtering in place.
  assert.ok(/EventSearchSheet/.test(home), 'the search sheet is not mounted on home');
});

test('the empty answer names the query it could not match', () => {
  // Arrange
  const sheet = code('src/features/events/components/EventSearchSheet.tsx');

  // Act / Assert — "no results" with no context reads as a broken search.
  assert.ok(
    /search\.noResults/.test(sheet) && /query:/.test(sheet),
    'the empty state does not mention what was searched for',
  );
});

test('the search control opens the sheet rather than navigating', () => {
  // Arrange
  const home = code('app/index.tsx');

  // Act / Assert — a route would lose the query on back, and the request is an
  // overlay.
  assert.ok(/setSearchOpen\(true\)/.test(home), 'the search button does not open the sheet');
});

test('a list row does not space itself', () => {
  // Arrange
  const row = code('src/features/events/components/EventRow.tsx');
  const gate = code('src/components/states/ScreenStateGate.tsx');

  // Act — the gap between two event boxes.
  const rowHasMargin = /card:\s*\{[\s\S]*?marginBottom/.test(row);

  // Assert — a row carrying its own margin on top of the container's `gap` is
  // how the spacing became double the design step.
  assert.equal(rowHasMargin, false, 'the row still carries its own marginBottom');
  assert.ok(/gap: space\[2\]/.test(gate), 'the list container does not own the tighter gap');
});
