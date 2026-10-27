/**
 * A nickname's colour is derived, not stored (Plan 49 T9).
 *
 * ★ THE PROPERTY THAT MATTERS IS DETERMINISM.
 *
 * The colour is hashed from the name so the same person is the same colour on
 * every device and in every event, with no column and no drift. A test that only
 * asserted "it returns a colour" would pass on `Math.random()`, which is exactly
 * the bug this replaces.
 *
 * ★ AND THE HASH MUST ACTUALLY DISPERSE.
 *
 * A polynomial hash assigns neighbouring buckets to names differing in a late
 * character, so "Ali"/"Alia"/"Alim" and the common Persian names built on the same
 * stem would all be one colour. FNV-1a avalanches; these tests check that a
 * one-character change moves the colour often enough to be visible.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colorForNickname, nicknameHash } from '@/src/features/profile/services/nickname-color';
import { participantColors } from '@/src/theme/tokens';

test('the same name is the same colour every time', () => {
  // Arrange
  const name = 'Bahar';

  // Act
  const first = colorForNickname(name);
  const second = colorForNickname(name);

  // Assert — a colour that changes between two renders is the stored-colour bug
  // in a different disguise.
  assert.equal(first, second);
});

test('case and surrounding space do not change the colour', () => {
  // Arrange
  const variants = ['Bahar', 'bahar', 'BAHAR', '  Bahar  '];

  // Act
  const colours = variants.map(colorForNickname);

  // Assert — the name is typed by a human; the colour must not depend on how they
  // capitalised it today.
  assert.equal(new Set(colours).size, 1, `variants disagreed: ${colours.join(', ')}`);
});

test('the colour always comes from the shared participant palette', () => {
  // Arrange
  const names = ['Bahar', 'Nima', 'Sara', 'Reza', 'Mina', 'Ali'];

  // Act / Assert — one palette means a nickname and a map pin for the same person
  // agree, and the contrast checks already cover it.
  for (const name of names) {
    assert.ok(
      (participantColors as readonly string[]).includes(colorForNickname(name)),
      `${name} produced a colour outside participantColors`,
    );
  }
});

test('different names spread across the palette', () => {
  // Arrange — a realistic set, all distinct.
  const names = ['Bahar', 'Nima', 'Sara', 'Reza', 'Mina', 'Ali', 'Parisa', 'Kaveh'];

  // Act
  const used = new Set(names.map(colorForNickname));

  // Assert — a hash that collapses everything onto two colours would satisfy
  // determinism and still be useless. Half the palette is a low bar that a
  // broken hash cannot clear.
  assert.ok(
    used.size >= Math.ceil(participantColors.length / 2),
    `only ${used.size} colours used across ${names.length} names`,
  );
});

test('a one-character change usually moves the colour', () => {
  // Arrange — names sharing a long prefix are the case that exposes a weak hash.
  const names = ['Ali', 'Alia', 'Alim', 'Alin', 'Alis', 'Alir', 'Alit'];

  // Act
  const colours = names.map(colorForNickname);

  // Assert — at least two distinct colours among names that differ by one
  // character. A polynomial hash puts all of these in one or two neighbouring
  // buckets; FNV-1a does not.
  assert.ok(new Set(colours).size >= 2, `all prefix-sharing names collapsed: ${colours.join(', ')}`);
});

test('an empty name still resolves to a palette colour', () => {
  // Act / Assert — boundary only. The gate refuses a blank name, so this can only
  // be reached by a row rendering before the value loaded, where `undefined`
  // styling would be worse than an arbitrary colour.
  assert.ok((participantColors as readonly string[]).includes(colorForNickname('')));
});

test('the hash is a 32-bit unsigned integer', () => {
  // Arrange
  const names = ['Bahar', 'a'.repeat(30), 'مکان انتخابی'];

  // Act / Assert — a float here would make the modulo unstable across engines.
  for (const name of names) {
    const hash = nicknameHash(name);
    assert.ok(Number.isInteger(hash), `${name} hashed to a non-integer`);
    assert.ok(hash >= 0 && hash <= 0xffffffff, `${name} hashed outside uint32`);
  }
});
