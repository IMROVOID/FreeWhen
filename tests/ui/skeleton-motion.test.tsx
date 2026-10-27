/**
 * A loading skeleton breathes.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Every loading state in the product is `ListSkeleton`, and every placeholder
 * bar in it was a flat, static rectangle at a single colour. A static skeleton
 * is indistinguishable from content that failed to render: the screen looks
 * finished and empty rather than busy, and on a slow connection the user has no
 * evidence the app is doing anything at all.
 *
 * ★ THE SHIMMER MUST BE ONE ANIMATION, NOT ONE PER BAR.
 *
 * `rows` is 3–4 and each row has three bars, so a per-bar loop drives a dozen
 * independent animations to convey one fact. The sweep is a single shared
 * value rendered once per skeleton, and the bars read from it — which is also
 * what makes the sweep continuous across rows instead of twelve unrelated
 * pulses.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { initI18n } from '@/src/i18n';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the list skeleton shimmers', () => {
  test('★ the skeleton drives an animation rather than painting a still frame', () => {
    // Arrange
    const skeleton = code('src/components/states/ListSkeleton.tsx');

    // Act / Assert — a shared value plus an animated style is the only thing
    // that distinguishes "loading" from "rendered and empty" on screen.
    assert.match(skeleton, /useSharedValue/, 'the skeleton has no animated value');
    assert.match(skeleton, /useAnimatedStyle/, 'the skeleton has no animated style');
    assert.match(skeleton, /withRepeat/, 'the animation does not loop');
  });

  test('the sweep is a single animation shared by every bar', () => {
    // Arrange
    const skeleton = code('src/components/states/ListSkeleton.tsx');

    // Act — one `useSharedValue` call in the file, whatever the row count.
    const sharedValues = skeleton.match(/useSharedValue\s*\(/g) ?? [];

    // Assert
    assert.equal(
      sharedValues.length,
      1,
      `expected one shared value driving the whole skeleton, found ${sharedValues.length}`,
    );
  });

  test('the skeleton honours reduce-motion instead of pulsing regardless', () => {
    // Arrange
    const skeleton = code('src/components/states/ListSkeleton.tsx');

    // Act / Assert — Style Guide §7.7: an infinite animation is the single
    // most likely thing to trigger motion sensitivity.
    assert.match(
      skeleton,
      /useMotion|useReducedMotion/,
      'the skeleton animates even for a user who asked for reduced motion',
    );
  });

  test('the placeholder keeps its accessible name while it animates', async () => {
    // Arrange
    const { ListSkeleton } = await import('@/src/components/states/ListSkeleton');

    // Act
    const screen = renderComponent(ListSkeleton, { rows: 2 });

    // Assert — an animation must not cost the region its announcement.
    assert.match(screen.html, /aria-label="[^"]+"/, 'the skeleton lost its label');
    assert.match(screen.html, /aria-live="polite"/, 'the skeleton is no longer announced politely');
  });
});
