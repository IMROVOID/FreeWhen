/**
 * No back control wears a filled circle.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `ScreenHeader` drew its back chevron inside a 44pt disc filled with
 * `surface2` and outlined with `line`. On a screen whose background is `bg`,
 * that disc reads as a raised button — a second, louder control competing with
 * the page title that sits right next to it, and the loudest thing on an
 * otherwise quiet header.
 *
 * The chat screen had already worked out the right shape: a bare chevron on the
 * page background, no fill and no border. This promotes that shape to the
 * shared header so no screen can reintroduce the disc.
 *
 * ★ WHY THE CHECK IS STRUCTURAL.
 *
 * The chevron is drawn by an icon library, so a rendered-markup assertion can
 * only see the wrapper. The rule is therefore asserted on the shared component
 * and on the screens that draw their own header: no `ScreenHeader`-shaped back
 * control may paint a background or a border behind the icon.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/** Every `.tsx` under `app/`, recursively. */
function screenFiles(dir = 'app'): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...screenFiles(full));
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

describe('the back control is a bare chevron', () => {
  test('★ the shared header paints no surface behind the icon', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تست',
      onBack: () => undefined,
    });

    // Assert — a `background-color` on the back wrapper is the filled disc. The
    // only fill the header may paint is none at all.
    const backWrapper = /<[^>]*aria-label="بازگشت"[^>]*>/.exec(screen.html)?.[0] ?? '';
    assert.ok(backWrapper !== '', 'the back control is missing');
    assert.ok(
      !/background-color/.test(backWrapper),
      'the back control paints a filled disc again',
    );
  });

  test('the shared header declares no radius or border for the back control', () => {
    // Arrange
    const header = code('src/components/ui/ScreenHeader.tsx');

    // Act
    const block = /backCircle:\s*\{([\s\S]*?)\n {2}\},/.exec(header)?.[1] ?? '';

    // Assert — radius + border + fill together are what made the disc read as a
    // button. Any one of them alone would be invisible; all three was the bug.
    assert.ok(!/borderRadius/.test(block), 'the back control is still a disc');
    assert.ok(!/borderWidth/.test(block), 'the back control still draws a border');
    assert.ok(!/backgroundColor/.test(block), 'the back control still paints a fill');
  });

  test('no screen reintroduces a circled back control', () => {
    // Arrange — a screen that draws its own header could add the disc back
    // without touching the shared component.
    const offenders = screenFiles().filter((file) => {
      const source = code(file);
      return /backCircle|backDisc|backCircleButton/.test(source);
    });

    // Act / Assert
    assert.deepEqual(offenders, [], `these screens draw a circled back control:\n${offenders.join('\n')}`);
  });
});
