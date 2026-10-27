/**
 * Settings: language and theme are segmented controls, and the choice sticks.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * Language was two `Button`s in a row. `variant="primary"` for the current one and
 * `secondary` for the other meant switching was an instant repaint of both, with
 * no cause — and since the layout direction cannot change under a live view tree,
 * the control looked like it had done nothing at all. It is the same control as
 * the List/Grid switch on "Suggested times", so it gets the same slider.
 *
 * ★ AND THERE WAS NO THEME CONTROL AT ALL.
 *
 * `useAppearanceStore` already had `themePreference` with a `'system'` default and
 * `useTheme` already resolved it — but nothing in the product ever wrote it, so
 * the store field was dead and every user was stuck on whatever their OS said.
 * The switch belongs under Language, with Auto in the MIDDLE, because Auto is the
 * default and a three-way control reads middle-out.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { initI18n } from '@/src/i18n';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('en');
  ({ renderComponent } = await import('./support/render'));
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the language control is the shared segmented control, not two buttons', () => {
  // Arrange
  const toggle = code('src/features/settings/components/LanguageToggle.tsx');

  // Act / Assert — two `Button`s cannot slide.
  assert.ok(/SegmentedControl/.test(toggle), 'the language control is not segmented');
  assert.ok(
    !/<Button\b[\s\S]{0,120}language-option-/.test(toggle),
    'the language options are still standalone buttons',
  );
});

test('the language control keeps its restart prompt and its test IDs', () => {
  // Arrange — the restart contract is a signed-off behaviour; only the picker
  // changed.
  const toggle = code('src/features/settings/components/LanguageToggle.tsx');

  // Act / Assert
  assert.ok(/language-restart-prompt/.test(toggle), 'the restart prompt is gone');
  assert.ok(/language-restart-instruction/.test(toggle), 'the restart instruction is gone');
  assert.ok(/language-flush-error/.test(toggle), 'the failed-flush path is gone');
  // The screen passes `testID="settings-language"`, and the option IDs must stay
  // `${testID}-option-${lang}` so existing keying keeps working.
  assert.ok(/testID=\{testID \?\? 'language-toggle'\}/.test(toggle), 'the toggle lost its testID');
  assert.ok(/testIDPrefix=\{`/.test(toggle), 'the option IDs lost their prefix');
});

test('the theme control offers Light, Auto and Dark with Auto in the middle', async () => {
  // Arrange
  const { ThemeControl } = await import('@/src/features/settings/components/ThemeControl');

  // Act
  const screen = renderComponent(ThemeControl, { testID: 'settings-theme' });

  // Assert — order is the contract: a three-way switch reads middle-out, and the
  // default (Auto) is the middle.
  assert.match(screen.html, /data-testid="settings-theme-light"/, 'Light is missing');
  assert.match(screen.html, /data-testid="settings-theme-system"/, 'Auto is missing');
  assert.match(screen.html, /data-testid="settings-theme-dark"/, 'Dark is missing');

  const order = ['light', 'system', 'dark'].map(
    (value) => screen.html.indexOf(`data-testid="settings-theme-${value}"`),
  ).slice(0, 3);
  const [lightAt = -1, systemAt = -1, darkAt = -1] = order;
  assert.ok(lightAt < systemAt && systemAt < darkAt, `the order is ${order.join(', ')}`);
});

test('the theme control reports the three choices to a screen reader', async () => {
  // Arrange — the store default is `system`, so that is the checked one.
  // `Chip.tsx` passes `accessibilityState`, which is the only form
  // react-native-web will read for a switch-like role; the checked state has to
  // survive that mapping.
  const { ThemeControl } = await import('@/src/features/settings/components/ThemeControl');

  // Act
  const screen = renderComponent(ThemeControl, { testID: 'settings-theme' });
  const checked = /role="radio"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="radio"/.test(
    screen.html,
  );

  // Assert
  assert.match(screen.html, /role="radiogroup"/, 'the control is not a radiogroup');
  assert.match(screen.html, /role="radio"/, 'the options are not radios');
  assert.ok(checked, 'no segment reports itself as selected on mount');
});

test('the icon segments keep a real accessible name in both languages', async () => {
  // Arrange — an icon-only segment with no label is invisible to a screen reader.
  const { ThemeControl } = await import('@/src/features/settings/components/ThemeControl');
  const { initI18n } = await import('@/src/i18n');

  for (const language of ['en', 'fa'] as const) {
    // Act
    initI18n(language);
    const screen = renderComponent(ThemeControl, { testID: 'settings-theme' });
    const labels = [...screen.html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] ?? '');

    // Assert — a dotted key rendered verbatim means the translation is missing.
    assert.equal(labels.length, 3, `${language}: expected 3 labels, got ${labels.length}`);
    for (const label of labels) {
      assert.ok(label.length > 0 && !label.includes('.'), `${language}: missing name for "${label}"`);
    }
  }

  initI18n('en');
});

test('the theme control paints an icon, not a word, for each choice', async () => {
  // Arrange
  const { ThemeControl } = await import('@/src/features/settings/components/ThemeControl');

  // Act
  const screen = renderComponent(ThemeControl, { testID: 'settings-theme' });
  const svgCount = (screen.html.match(/<svg/g) ?? []).length;
  const valueLabels = ['Light', 'Auto', 'Dark'].filter((word) => screen.has(word));

  // Assert — three icons, no words on the rail; the words are the aria-labels.
  assert.equal(svgCount, 3, `the control renders ${svgCount} icons, expected 3`);
  assert.deepEqual(valueLabels, [], `the rail still renders ${valueLabels.join(', ')} as text`);
});

test('the theme control writes the store the theme hook already reads', async () => {
  // Arrange
  const { useAppearanceStore } = await import('@/src/theme/appearance-store');
  const control = code('src/features/settings/components/ThemeControl.tsx');

  // Act
  const storeDefault = useAppearanceStore.getState().themePreference;

  // Assert — the field existed with no writer, which is why it was dead.
  assert.equal(storeDefault, 'system', `the store default is ${storeDefault}, expected system (Auto)`);
  assert.ok(/useAppearanceStore/.test(control), 'the theme control does not touch the store');
  assert.ok(/setThemePreference/.test(control), 'the theme control never writes the preference');
});

test('Settings renders the theme control below the language control', () => {
  // Arrange
  const settings = code('app/settings/index.tsx');

  // Act
  const languageAt = settings.indexOf('LanguageToggle');
  const themeAt = settings.indexOf('ThemeControl');

  // Assert
  assert.ok(languageAt > -1, 'Settings no longer renders the language control');
  assert.ok(themeAt > -1, 'Settings does not render a theme control');
  assert.ok(themeAt > languageAt, 'the theme control is not below the language control');
});
