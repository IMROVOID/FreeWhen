/**
 * Accessibility, as rendered and as measured (Plan 11 Task 10, Task 2).
 *
 * ★ CONTRAST IS COMPUTED HERE, NOT TRUSTED.
 *
 * `src/theme/tokens.ts` documents a ratio next to each token, but a comment
 * cannot fail a build. These tests recompute the WCAG relative-luminance ratio
 * from the token values and assert the bar — so a future palette edit that
 * pushes body text under 4.5:1 fails the suite instead of shipping.
 *
 * ★ LABELS ARE ASSERTED ON THE MARKUP.
 *
 * `accessibilityLabel` reaches `react-native-web` as `aria-label`, so the test
 * reads the attribute. A control with a role but no label is unusable with a
 * screen reader, which is the omission this catches.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import { themes } from '@/src/theme/tokens';

let renderComponent: typeof import('./support/render').renderComponent;
let createElement: typeof import('./support/render').createElement;

before(async () => {
  initI18n('fa');
  ({ renderComponent, createElement } = await import('./support/render'));
});

// ── WCAG contrast ─────────────────────────────────────────────────────────

function channels(hex: string): [number, number, number] {
  const digits = hex.replace('#', '');
  const pairs = digits.match(/.{2}/g) ?? [];
  return pairs.length === 3
    ? (pairs.map((pair) => parseInt(pair, 16) / 255) as [number, number, number])
    : [0, 0, 0];
}

function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2.1 contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const BODY_MINIMUM = 4.5;
const UI_MINIMUM = 3;

describe('contrast — body text is at least 4.5:1, measured', () => {
  for (const name of ['dark', 'light'] as const) {
    const theme = themes[name];

    test(`${name}: text on every surface clears 4.5:1`, () => {
      for (const surface of ['bg', 'surface1', 'surface2', 'surface3'] as const) {
        const measured = contrast(theme.text, theme[surface]);
        assert.ok(
          measured >= BODY_MINIMUM,
          `${name} text on ${surface} measured ${measured.toFixed(2)}:1, under ${BODY_MINIMUM}:1`,
        );
      }
    });

    test(`${name}: muted text on every surface clears 4.5:1`, () => {
      for (const surface of ['bg', 'surface1', 'surface2', 'surface3'] as const) {
        const measured = contrast(theme.textMuted, theme[surface]);
        assert.ok(
          measured >= BODY_MINIMUM,
          `${name} textMuted on ${surface} measured ${measured.toFixed(2)}:1`,
        );
      }
    });

    test(`${name}: the primary label is readable on the primary fill`, () => {
      const measured = contrast(theme.onPrimary, theme.primary);
      assert.ok(measured >= BODY_MINIMUM, `onPrimary measured ${measured.toFixed(2)}:1`);
    });

    test(`${name}: the brand label is readable on the brand fill`, () => {
      const measured = contrast(theme.onBrand, theme.brand);
      assert.ok(measured >= BODY_MINIMUM, `onBrand measured ${measured.toFixed(2)}:1`);
    });
  }
});

describe('contrast — UI boundaries are at least 3:1', () => {
  for (const name of ['dark', 'light'] as const) {
    const theme = themes[name];

    test(`${name}: the line token clears 3:1 on every surface it borders`, () => {
      for (const surface of ['bg', 'surface1', 'surface2', 'surface3'] as const) {
        const measured = contrast(theme.line, theme[surface]);
        assert.ok(
          measured >= UI_MINIMUM,
          `${name} line on ${surface} measured ${measured.toFixed(2)}:1, under ${UI_MINIMUM}:1`,
        );
      }
    });
  }

  test('large text may sit at the 3:1 bar, and faint text clears it everywhere', () => {
    for (const name of ['dark', 'light'] as const) {
      const theme = themes[name];
      for (const surface of ['bg', 'surface1', 'surface2', 'surface3'] as const) {
        const measured = contrast(theme.textFaint, theme[surface]);
        assert.ok(
          measured >= UI_MINIMUM,
          `${name} textFaint on ${surface} measured ${measured.toFixed(2)}:1`,
        );
      }
    }
  });
});

// ── Labels and roles ──────────────────────────────────────────────────────

describe('every interactive control carries a role and a label', () => {
  test('the retry control in an error state is labelled and is a button', async () => {
    // Arrange
    const { ErrorState } = await import('@/src/components/states/ErrorState');

    // Act
    const screen = renderComponent(ErrorState, {
      messageKey: 'states.errorBody',
      onRetry: () => undefined,
    });

    // Assert
    assert.match(screen.html, /role="button"/, 'the retry has a button role');
    assert.match(screen.html, /aria-label="[^"]+"/, 'the retry has a label');
  });

  test('the vote control exposes its selected option to a screen reader', async () => {
    // Arrange
    const { VoteControl } = await import('@/src/features/voting/components/VoteControl');

    // Act
    const screen = renderComponent(VoteControl, {
      current: 'yes',
      onVote: () => undefined,
    });

    // Assert — all three are labelled with words, not icons, and one is selected.
    for (const word of ['موافقم', 'شاید', 'مخالفم']) {
      assert.ok(screen.has(word), `${word} is named`);
    }
    assert.match(screen.html, /aria-checked="true"|aria-selected="true"/, 'the selection is exposed');
  });

  test('an icon-only visitor label still announces the role and the name', async () => {
    // Arrange
    const { VisitorLabel } = await import('@/src/components/a11y/VisitorLabel');

    // Act
    const screen = renderComponent(VisitorLabel, {
      name: 'علی',
      role: 'organizer' as const,
      children: createElement('span', null, 'علی'),
    });

    // Assert — the label names both, so the dot carries no meaning alone.
    assert.match(screen.html, /aria-label="[^"]*علی[^"]*"/, 'the name is in the label');
    assert.match(screen.html, /aria-label="[^"]*میزبان[^"]*"/, 'the role is in the label');
  });

  test('the offline banner is announced politely, not as a blocking alert', async () => {
    // Arrange
    const { OfflineBanner } = await import('@/src/components/states/OfflineBanner');

    // Act
    const screen = renderComponent(OfflineBanner, { pendingCount: 1 });

    // Assert
    assert.match(screen.html, /aria-live="polite"/, 'announced without stealing focus');
    assert.equal(/role="alertdialog"/.test(screen.html), false, 'never a modal');
  });

  test('the language options are labelled in both languages', async () => {
    // Arrange
    const { LanguageToggle } = await import('@/src/features/settings/components/LanguageToggle');

    // Act
    const screen = renderComponent(LanguageToggle, { current: 'fa' as const });

    // Assert
    assert.ok(screen.has('فارسی'), 'Persian is offered');
    assert.ok(screen.has('English'), 'English is offered');
    assert.match(screen.html, /role="radiogroup"/, 'the pair is a choice group');
  });
});

// ── Touch targets ─────────────────────────────────────────────────────────

describe('touch targets meet the 48pt minimum', () => {
  test('the button heights are at or above 48 for the two touch sizes', async () => {
    // Arrange
    const { size } = await import('@/src/theme/tokens');

    // Act / Assert — `small` is 40 but is only used with `hitSlop` padding.
    assert.ok(size.buttonLarge >= 48, `large measured ${size.buttonLarge}`);
    assert.ok(size.buttonMedium >= 48, `medium measured ${size.buttonMedium}`);
    assert.ok(size.buttonSmall + 8 >= 48, 'small plus hit-slop clears 48');
  });
});

// ── No colour-only encoding ───────────────────────────────────────────────

describe('no state is encoded by colour alone', () => {
  test('an empty state names the situation in words', async () => {
    // Arrange
    const { EmptyState } = await import('@/src/components/states/EmptyState');

    // Act
    const screen = renderComponent(EmptyState, {
      prompt: 'هنوز مکانی برای مقایسه نیست',
    });

    // Assert
    assert.ok(screen.has('هنوز مکانی برای مقایسه نیست'), 'the words carry the meaning');
  });

  test('a permission state names the alternative rather than colouring it', async () => {
    // Arrange
    const { PermissionDeniedState } = await import('@/src/components/states/PermissionDeniedState');

    // Act
    const screen = renderComponent(PermissionDeniedState, {
      alternative: createElement('button', null, 'محله را دستی وارد کنید'),
    });

    // Assert
    assert.ok(screen.has('محله را دستی وارد کنید'), 'the route is labelled in words');
  });
});
