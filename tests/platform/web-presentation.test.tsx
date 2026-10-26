/**
 * The web build's presentation contract.
 *
 * ★ EVERY ASSERTION HERE CORRESPONDS TO A BUG SEEN IN A BROWSER, NOT A THEORY.
 *
 * Four of these share one root cause: `react-native-web` does not translate the
 * props the way native does. Specifically:
 *
 *  - it ignores `writingDirection` in a STYLE and reads `dir` from a PROP, so
 *    setting the style left every container `dir="auto"` and RTL text laid out
 *    left-to-right;
 *  - it leaves the browser's default focus outline in place on a focused
 *    `<button>`/`<input>`, which drew a second ring around controls that already
 *    draw their own;
 *  - and the `expo-reset` stylesheet sets `height:100%` on `body` but no
 *    background, so the page underneath the app was white.
 *
 * The tests read source and rendered markup, because that is the only way to
 * catch a prop that is valid in TypeScript but dropped by the renderer.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { initI18n } from '@/src/i18n';

let renderComponent: typeof import('../ui/support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('../ui/support/render'));
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('document background', () => {
  test('the root document paints the theme background, not white', () => {
    // Arrange
    const html = code('app/+html.tsx');

    // Act / Assert — `ScrollViewStyleReset` sets no background, so the document
    // stayed white wherever app content did not reach.
    assert.match(html, /background/i, 'the root document declares no background colour');
  });

  test('the document background follows the active theme', () => {
    // Arrange
    const html = code('app/+html.tsx');

    // Act / Assert — a hardcoded colour would be wrong in the other theme.
    assert.match(html, /resolveTheme|themeName|palette/, 'the background is not derived from the theme');
  });
});

describe('text direction', () => {
  test('Text passes `dir` as a prop, which react-native-web actually honours', () => {
    // Arrange
    const text = code('src/components/ui/Text.tsx');

    // Act / Assert — RNW reads `props.dir`; a `writingDirection` style is
    // silently discarded and the container falls back to `dir="auto"`.
    assert.match(text, /\bdir=/, 'Text does not pass a `dir` prop');
  });

  test('a Persian string renders inside an rtl container', async () => {
    // Arrange
    const { Text } = await import('@/src/components/ui/Text');

    // Act
    const screen = renderComponent(Text, { children: 'گروه' });

    // Assert — the container must declare rtl explicitly; `auto` lets the
    // browser guess, and it guesses wrong for a single word inside an LTR page.
    assert.match(screen.html, /dir="rtl"/, 'the Persian text container is not rtl');
  });

  test('a Latin string renders inside an ltr container', async () => {
    // Arrange
    const { Text } = await import('@/src/components/ui/Text');

    // Act
    const screen = renderComponent(Text, { children: 'FreeWhen' });

    // Assert — the inverse case, so the fix cannot be "always rtl".
    assert.match(screen.html, /dir="ltr"/, 'the Latin text container is not ltr');
  });
});

describe('focus rings', () => {
  test('buttons suppress the browser outline in favour of their own styling', () => {
    // Arrange
    const pressy = code('src/components/ui/Pressy.tsx');

    // Act / Assert — the extra ring was the UA default on a focused button.
    assert.match(pressy, /outlineStyle|outlineWidth/, 'Pressy does not control the focus outline');
  });

  test('inputs suppress the UA outline so only the styled border shows', () => {
    // Arrange
    const input = code('src/components/ui/Input.tsx');

    // Act / Assert — two rings appeared: the UA default and the component's own
    // 2px border.
    assert.match(input, /outlineStyle|outlineWidth/, 'Input does not control the focus outline');
  });

  test('the outline override uses the longhand react-native-web accepts', () => {
    // Arrange — `outline` is an INVALID shortform in RNW's style validator and
    // is dropped, so a test that only sees the word "outline" would pass on
    // code that does nothing.
    const files = ['src/components/ui/Pressy.tsx', 'src/components/ui/Input.tsx'];

    // Act / Assert
    for (const file of files) {
      const source = code(file);
      assert.ok(
        !/\boutline:\s*/.test(source),
        `${file} uses the shorthand, which react-native-web silently drops`,
      );
    }
  });
});
