/**
 * The invite screen must not show a second name prompt.
 *
 * ★ TWO PROMPTS STACKED, AND THE SECOND ONE COULD NOT BE COMPLETED.
 *
 * The nickname gate mounts above the router so no deep link can skip it — but
 * `/e/[token]` is exactly such a route, and `JoinForm` there has its own "اسم شما"
 * field. A guest arriving from an invite link therefore saw the join form AND the
 * gate sheet on top of it.
 *
 * Worse, the gate's save could not succeed: `/api/profile` answers 403 (later
 * `null`) for a caller with no identity, and no identity exists until the join
 * mints one. So the guest answered the first prompt and got stuck behind a second
 * they had no way to finish — with a 500 from the join in the console on top.
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

test('the gate can be suspended while another screen asks for a name', () => {
  // Arrange
  const gate = code('src/features/profile/components/NicknameGate.tsx');

  // Act / Assert
  assert.ok(/suspended/.test(gate), 'the gate has no way to stand down');
  assert.ok(
    /if \(suspended \|\| checking\) return null/.test(gate),
    'a suspended gate still renders',
  );
});

test('the root layout suspends the gate on the invite route', () => {
  // Arrange
  const layout = code('app/_layout.tsx');

  // Act / Assert
  assert.ok(/useSegments/.test(layout), 'the layout does not read the current route');
  assert.ok(/suspended=\{onInviteRoute\}/.test(layout), 'the gate is not suspended on /e/');
  assert.ok(
    /segments\[0\] === 'e'/.test(layout),
    'the invite route is not the one being detected',
  );
});

test('the invite screen records the joined name as the nickname', () => {
  // Arrange
  const joinScreen = code('app/e/[token].tsx');

  // Act / Assert — the gate stood down, so this is the only place the answer is
  // kept. Without it the app has no identity until the next launch asks again.
  assert.ok(
    /saveNicknameOptimistically/.test(joinScreen),
    'the joined name is discarded, so the gate asks a second time next launch',
  );
});

test('a profile read for an identity-less caller is not an error', () => {
  // Arrange
  const profile = code('server/routes/profile.ts');

  // Act — the GET branch.
  const getHandler = /export async function getProfileHandler[\s\S]*?\n\}/.exec(profile)?.[0] ?? '';

  // Assert — a first launch has no identity yet, and the gate is about to ask.
  assert.ok(getHandler.length > 0, 'the GET handler is no longer findable');
  assert.ok(
    !/wireError\('NOT_PARTICIPANT'\)/.test(getHandler),
    'a caller with no identity is refused instead of told they have no nickname',
  );
});

test('a nickname lookup can never fail the join that called it', () => {
  // Arrange
  const profile = code('server/routes/profile.ts');

  // Act
  const lookup = /export async function nicknameFor[\s\S]*?\n\}/.exec(profile)?.[0] ?? '';

  // Assert — a lookup that throws turns a good invite redemption into a 500.
  assert.ok(lookup.length > 0, 'nicknameFor is no longer findable');
  assert.ok(/try\s*\{/.test(lookup) && /catch/.test(lookup), 'nicknameFor can still throw');
});
