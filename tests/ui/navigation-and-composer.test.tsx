/**
 * The last two interface-level defects from the review.
 *
 * ★ 1. NAVIGATION WAS INSTANT.
 *
 * `expo-router`'s native stack has a platform transition; the web build's
 * `<Stack>` defaults to none, so a route change on the web app swapped the
 * whole page in a single frame with no sense of having gone anywhere. Screens
 * also mounted their skeletons and their content with no entrance of their own,
 * so even a fast navigation had no motion to read as "this is new".
 *
 * ★ 2. THE CHAT COMPOSER WAS A BOX, NOT A LINE.
 *
 * On the web build the composer reserved height for several lines from the
 * moment the screen opened, so an empty room showed a tall empty field with the
 * send control floating beside it. On the app it is one line tall and grows
 * only as text wraps. The difference is `minHeight` versus `maxHeight`: the web
 * layout gave the field `flex: 1` inside a stretch container, so the surface
 * took every pixel the row offered.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { initI18n } from '@/src/i18n';

before(async () => {
  initI18n('fa');
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ── Navigation transition ────────────────────────────────────────────────

describe('a navigation is a transition, not a swap', () => {
  test('★ the root stack declares an animation', () => {
    // Arrange
    const layout = code('app/_layout.tsx');

    // Act / Assert — `animation` is what makes a push slide instead of cut.
    // The VALUE lives in the shared helper, so the layout is checked for the
    // wiring and the helper for the direction.
    assert.match(layout, /animation\s*:/, 'the root stack declares no transition');
    assert.match(layout, /useStackTransition/, 'the transition is not the shared one');
  });

  test('the slide direction is chosen per reading direction', () => {
    // Arrange — a hardcoded `slide_from_right` enters from the physical right,
    // which is the LEADING edge in Persian and the TRAILING edge in English.
    const transition = code('src/platform/stack-transition.ts');

    // Act / Assert
    assert.match(transition, /slide_from_right/, 'there is no slide');
    assert.match(transition, /slide_from_left/, 'the slide does not mirror for RTL');
    assert.match(
      transition,
      /isRtlLayout|I18nManager|dir/i,
      'the slide direction is hardcoded to one reading direction',
    );
  });

  test('a reduced-motion user gets a fade instead of a slide', () => {
    // Arrange
    const transition = code('src/platform/stack-transition.ts');

    // Act / Assert — Style Guide §7.7: a full-screen horizontal slide is exactly
    // the travel that triggers motion sensitivity.
    assert.match(transition, /useMotion|reduce/, 'the transition ignores reduce-motion');
    assert.match(transition, /'fade'/, 'there is no reduced-motion alternative');
  });

  test('the event subtree declares the same transition', () => {
    // Arrange
    const layout = code('app/event/[id]/_layout.tsx');

    // Act / Assert — a nested stack without it would cut even when the root
    // slides, which reads as a second, inconsistent navigation.
    assert.match(layout, /animation(Entering)?\s*:/, 'the nested stack declares no transition');
    assert.match(layout, /useStackTransition/, 'the nested stack diverges from the root');
  });
});

// ── The composer height ──────────────────────────────────────────────────

describe('the message composer starts as one line', () => {
  test('★ the text field is one line tall at rest', () => {
    // Arrange
    const chat = code('app/event/[id]/chat.tsx');

    // Act
    const field = /textInput:\s*\{([\s\S]*?)\n {2}\},/.exec(chat)?.[1] ?? '';

    // Assert — `flex: 1` inside a stretch row let the surface take the whole
    // row height, which is the tall empty box on the web build.
    assert.ok(!/flex:\s*1/.test(field), 'the composer field still stretches to fill the row');
    assert.match(field, /minHeight/, 'the field declares no resting height');
    assert.match(field, /maxHeight/, 'the field declares no growth ceiling');
  });

  test('the resting height is a single text line, not a paragraph', () => {
    // Arrange
    const chat = code('app/event/[id]/chat.tsx');

    // Act
    const field = /textInput:\s*\{([\s\S]*?)\n {2}\},/.exec(chat)?.[1] ?? '';
    const minHeight = /minHeight:\s*(\d+)/.exec(field);

    // Assert — 15px type on a 22px line plus the field's own padding.
    assert.ok(minHeight, 'the field declares no resting height');
    assert.ok(
      Number(minHeight[1]) <= 44,
      `the composer rests at ${minHeight[1]}px, which is more than one line`,
    );
  });

  test('the row aligns to the bottom, so the send control follows a growing field', () => {
    // Arrange
    const chat = code('app/event/[id]/chat.tsx');

    // Act
    const row = /inputRow:\s*\{([\s\S]*?)\n {2}\},/.exec(chat)?.[1] ?? '';

    // Assert
    assert.match(row, /alignItems:\s*'flex-end'/, 'the composer row does not bottom-align');
  });
});
