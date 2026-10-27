/**
 * Text entered by the reader runs right-to-left in a Persian interface.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Every text field decided its writing direction from its VALUE
 * (`isPersian(value || label)`). An empty field therefore had no Persian
 * character to find, so it fell back to LTR: the caret sat on the wrong side
 * and the placeholder was pinned left until the user typed enough Persian for
 * the guess to flip. The invite-address box («کد یا نشانی دعوت») is the visible
 * case — it is empty by definition when the user arrives.
 *
 * ★ WHY THE ASSERTION IS STRUCTURAL AS WELL AS RENDERED.
 *
 * A rendered-markup test on an empty field cannot tell `dir="auto"` from a
 * correct `rtl`, because react-native-web emits `dir="auto"` for both. So the
 * source rule is asserted too: no shared field may derive direction from its
 * own content.
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

describe('a Persian interface types right-to-left', () => {
  test('★ an EMPTY field is already rtl, before anything is typed', async () => {
    // Arrange
    const { Input } = await import('@/src/components/ui/Input');

    // Act — an empty invite-code field in the Persian app.
    const screen = renderComponent(Input, {
      value: '',
      onChangeText: () => undefined,
      label: 'کد یا نشانی دعوت',
    });

    // Assert — the rendered textarea/input must declare rtl. `dir="auto"` on an
    // empty control resolves to ltr in every browser, which is the left caret
    // and the left-aligned placeholder the user reported.
    assert.match(
      screen.html,
      /dir="rtl"/,
      'an empty field in a Persian interface is not rtl',
    );
  });

  test('an empty field is ltr in the English interface', async () => {
    // Arrange — the inverse case, so the fix cannot be "always rtl".
    initI18n('en');
    const { Input } = await import('@/src/components/ui/Input');

    // Act
    const screen = renderComponent(Input, {
      value: '',
      onChangeText: () => undefined,
      label: 'Invite code',
    });

    // Assert
    assert.match(screen.html, /dir="ltr"/, 'an empty field in an English interface is not ltr');

    initI18n('fa');
  });

  test('no shared field derives its direction from its own content', () => {
    // Arrange — the defect is the DERIVATION, not the missing attribute: a
    // field that guesses from its value is right only once enough of the value
    // exists to guess from.
    const input = code('src/components/ui/Input.tsx');

    // Act / Assert
    assert.ok(
      !/isPersian\s*\(/.test(input),
      'Input still guesses its direction from the value, so an empty field is ltr',
    );
  });

  test('a literal writingDirection is never hardcoded for text fields', () => {
    // Arrange — the chat composer hardcoded `'rtl'`, which broke an English
    // session, and `Input` hardcoded a guess, which broke an empty Persian one.
    const files = ['src/components/ui/Input.tsx', 'app/event/[id]/chat.tsx'];

    // Act / Assert
    for (const file of files) {
      const source = code(file);
      assert.ok(
        !/writingDirection:\s*'(rtl|ltr)'/.test(source),
        `${file} hardcodes a writing direction instead of reading the locale`,
      );
    }
  });
});
