/**
 * Back chevrons must point the way the interface reads.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Five screens chose their icon with `I18nManager.isRTL ? CaretRight : CaretLeft`.
 * `react-native-web`'s `I18nManager` reports `isRTL: false` unconditionally —
 * there is no native layout manager to ask — so on the web build every back
 * control drew the LTR arrow inside an `rtl` document. The Persian interface
 * pointed right for "back", which is forwards.
 *
 * ★ WHY THE CHECK IS STRUCTURAL.
 *
 * The failure mode is a screen reaching for `I18nManager.isRTL` again, and that
 * is invisible in a rendered-markup test on a platform where the manager is a
 * stub. So the rule is asserted at the source level: no `app/**` screen may read
 * `I18nManager.isRTL` to pick a direction.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isRtlLayout } from '@/src/platform/layout-direction';

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

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('back-chevron direction', () => {
  test('no screen picks a direction from I18nManager', () => {
    // Arrange
    const offenders = screenFiles().filter((file) => /I18nManager\.isRTL/.test(code(file)));

    // Act / Assert — a stub that is always false cannot decide layout.
    assert.deepEqual(
      offenders,
      [],
      `these screens read I18nManager.isRTL, which is always false on web:\n${offenders.join('\n')}`,
    );
  });

  test('the Persian locale resolves to an RTL layout', () => {
    // Act / Assert — no document in Node, so the locale decides.
    assert.equal(isRtlLayout('fa'), true);
  });

  test('the English locale resolves to an LTR layout', () => {
    // Act / Assert
    assert.equal(isRtlLayout('en'), false);
  });

  test('the LANGUAGE wins over the document, which the static export stamped', () => {
    // Arrange — `app/+html.tsx` runs in Node during `expo export`, with no
    // `localStorage`, so the served document carries the BUILD-time language's
    // `dir`. Letting it out-vote the live catalogue is exactly the bug: the page
    // stayed `dir="rtl"` after switching to English, and every back chevron,
    // segmented pill and switch knob kept RTL geometry on an LTR interface.
    const previous = (globalThis as { document?: unknown }).document;
    const attrs: Record<string, string> = { dir: 'rtl' };
    (globalThis as { document?: unknown }).document = {
      documentElement: { getAttribute: (name: string) => attrs[name] ?? null },
    };

    // Act
    const rtl = isRtlLayout('en');

    // Assert — the live language decides; the document is an OUTPUT of it, which
    // `applyDirection` writes on every switch.
    assert.equal(rtl, false, 'a build-time document stamp overruled the live language');

    (globalThis as { document?: unknown }).document = previous;
  });
});
