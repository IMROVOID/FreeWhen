/**
 * The toggle switch belongs to the product, not to the platform.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Settings rendered react-native's own `<Switch>`. That control is the
 * OPERATING SYSTEM's switch: on Android it is a Material pill in the platform's
 * teal, on iOS it is an Apple switch, and on web react-native-web falls back to
 * a checkbox. None of the three follows the theme, none of them follows the
 * accent, and none of them mirrors for RTL — so the one control the user
 * touches most in Settings was the only control on the screen that did not look
 * like the app.
 *
 * ★ IT MUST STILL BE A REAL SWITCH TO A SCREEN READER.
 *
 * The visual is the easy part. A hand-drawn pill is worthless if it loses
 * `role="switch"` and `aria-checked`, so those are asserted on the markup
 * rather than assumed from the animation.
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

/**
 * The `rgba()` form react-native-web emits for a hex token.
 *
 * The rendered style is a CSS declaration, not the token, so a hex comparison
 * would report a correct component as broken.
 */
function rgba(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},1.00)`;
}

describe('the toggle switch is themed', () => {
  test('★ a shared switch component exists, so no screen reaches for the platform one', async () => {
    // Arrange / Act
    const module = await import('@/src/components/ui/AccentSwitch');

    // Assert
    assert.equal(typeof module.AccentSwitch, 'function', 'there is no shared accent switch');
  });

  test('the switch reports itself as a switch, with its checked state', async () => {
    // Arrange
    const { AccentSwitch } = await import('@/src/components/ui/AccentSwitch');

    // Act
    const screen = renderComponent(AccentSwitch, {
      value: true,
      onValueChange: () => undefined,
      accessibilityLabel: 'بی‌صدا',
    });

    // Assert — an animated pill without these is invisible to assistive tech.
    assert.match(screen.html, /role="switch"/, 'the switch has no switch role');
    assert.match(screen.html, /aria-checked="true"/, 'the checked state is not exposed');
  });

  test('an off switch reports itself as unchecked', async () => {
    // Arrange
    const { AccentSwitch } = await import('@/src/components/ui/AccentSwitch');

    // Act
    const screen = renderComponent(AccentSwitch, {
      value: false,
      onValueChange: () => undefined,
      accessibilityLabel: 'بی‌صدا',
    });

    // Assert
    assert.match(screen.html, /aria-checked="false"/, 'the unchecked state is not exposed');
  });

  test('the switch paints the accent when on and a neutral surface when off', async () => {
    // Arrange
    const { AccentSwitch } = await import('@/src/components/ui/AccentSwitch');
    const { themes } = await import('@/src/theme/tokens');
    const { applyDeviceAccent } = await import('@/src/theme/monet');

    // ★ THE RESOLVED THEME, NOT THE RAW TOKEN FILE.
    //
    // `useTheme` runs `applyDeviceAccent`, which can swap `primary` and
    // `surface3` for Android's Material You values. That helper returns the
    // theme untouched anywhere Monet is unavailable — which is every platform
    // this suite runs on — so resolving it the same way is what keeps the
    // assertion honest if the accent ever starts moving on a real device.
    const theme = applyDeviceAccent(themes.dark, 'dark', true);

    // Act
    const on = renderComponent(AccentSwitch, {
      value: true,
      onValueChange: () => undefined,
      accessibilityLabel: 'x',
    });
    const off = renderComponent(AccentSwitch, {
      value: false,
      onValueChange: () => undefined,
      accessibilityLabel: 'x',
    });

    // Assert — react-native-web COMPILES a colour to `rgba()`, so the token is
    // converted before comparing. A hex compare would fail on a correct
    // component, which is a false negative worth avoiding here.
    assert.ok(
      on.html.toLowerCase().includes(rgba(theme.primary)),
      `the switch does not paint the accent (${theme.primary}) when it is on`,
    );
    assert.ok(
      off.html.toLowerCase().includes(rgba(theme.surface3)),
      `the switch does not paint a neutral track (${theme.surface3}) when it is off`,
    );
  });

  test('★ the mute toggle stopped using the platform switch', () => {
    // Arrange
    const mute = code('src/features/follow-through/components/MuteToggle.tsx');

    // Act / Assert — `<Switch>` from `react-native` is the OS control.
    assert.ok(
      !/<Switch\b/.test(mute),
      'the mute toggle still renders the platform switch',
    );
  });

  test('no component outside the shared switch imports the platform switch', () => {
    // Arrange — a screen could import `Switch` directly and bypass the rule.
    const offenders = [
      ...tsxFiles('src/components'),
      ...tsxFiles('src/features'),
      ...tsxFiles('app'),
    ].filter((file) => /\bSwitch\b/.test(code(file)) && !file.endsWith('AccentSwitch.tsx'));

    // Assert
    assert.deepEqual(
      offenders,
      [],
      `these files still use the platform switch:\n${offenders.join('\n')}`,
    );
  });
});

/** Every `.tsx` under a directory, recursively. */
function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) found.push(full.split('\\').join('/'));
  }
  return found;
}
