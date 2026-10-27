/**
 * The nickname gate (Plan 49 T8).
 *
 * ★ THE REQUIREMENT IS A GATE, NOT A PROMPT.
 *
 * The overlay "shouldn't be able to skip or Close … or use the App until choosing
 * a Nickname". Asserting the component `renders` would pass while the sheet offered
 * an Escape key or a scrim press, so the dismissal path is what these tests pin.
 *
 * ★ AND IT MUST NOT BECOME A LOCKOUT.
 *
 * A gate with no exit is a total lockout the moment its save request fails. Being
 * unable to reach the server has to mean "use the app with the name you typed",
 * never "you cannot use the app".
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const GATE = 'src/features/profile/components/NicknameGate.tsx';

test('the gate sheet cannot be dismissed', () => {
  // Arrange
  const gate = code(GATE);

  // Act / Assert — no scrim press and no Escape is the requirement. Without
  // `dismissible={false}` the sheet defaults to closable.
  assert.ok(
    /dismissible=\{false\}/.test(gate),
    'the gate sheet is dismissible — the app is reachable without a nickname',
  );
});

test('the gate mounts above the router, so no route can be reached around it', () => {
  // Arrange
  const layout = code('app/_layout.tsx');

  // Act / Assert — a per-screen check is skippable by an invite or deep link.
  assert.ok(/NicknameGate/.test(layout), 'the gate is not mounted in the root layout');
});

test('the gate renders nothing while it is still checking', () => {
  // Arrange
  const gate = code(GATE);

  // Act / Assert — a returning user must not see the gate flash on every launch.
  assert.ok(
    /if \(checking\) return null/.test(gate),
    'the gate renders before it knows whether a nickname exists',
  );
});

test('a failed save still opens the app', () => {
  // Arrange
  const gate = code(GATE);

  // Act — the catch branch must resolve the gate, not leave it pending.
  const catchBlock = /catch\s*\{([\s\S]*?)\n {2}\}/.exec(gate)?.[1] ?? '';

  // Assert — a refused request is not a valid reason to hold someone out of the
  // product, so the typed name is cached and the gate opens.
  assert.ok(catchBlock.length > 0, 'the gate has no failure path at all');
  assert.ok(
    /onResolved\(/.test(catchBlock),
    'a failed save leaves the gate shut — that is a total lockout',
  );
});

test('the typed value is trimmed before it is stored', () => {
  // Arrange
  const profile = code('src/features/profile/services/profile.ts');

  // Act / Assert — a name of only whitespace would render as an empty gap on
  // every proposal card.
  assert.ok(/\.trim\(\)/.test(profile), 'the nickname is never trimmed');
});

test('the field validates the same bounds the server enforces', () => {
  // Arrange
  const profile = code('src/features/profile/services/profile.ts');

  // Act / Assert — 1 and 30, matching `DISPLAY_NAME_MIN`/`MAX` and migration 021.
  assert.ok(/length < 1/.test(profile), 'an empty nickname is not rejected');
  assert.ok(/length > 30/.test(profile), 'an over-long nickname is not rejected');
});
