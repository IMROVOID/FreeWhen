/**
 * Every event screen has a way back.
 *
 * ★ THE GAP THIS CLOSES.
 *
 * `app/event/[id]/_layout.tsx` sets `headerShown: false` and puts nothing in its
 * place. On the event home and the other tabs there was no back control at all —
 * the only exit was the operating system's gesture, which does not exist on a
 * desktop web build and is not discoverable on Android.
 *
 * `activity.tsx` had already worked out the right shape: a circular, bordered
 * back disc beside the title. That is the pattern promoted here so every event
 * screen gets the same control instead of one screen owning the only instance.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

describe('ScreenHeader', () => {
  test('renders a labelled back control', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تست',
      onBack: () => {},
    });

    // Assert — the label is what a screen reader announces; a bare icon disc
    // would be an unlabelled button. Asserted on the attribute, because the
    // accessible name lives in `aria-label` and never in the text content.
    assert.match(screen.html, /role="button"/, 'the back control is not exposed as a button');
    assert.match(screen.html, /aria-label="بازگشت"/, 'the back control has no accessible name');
  });

  test('shows the title alongside the back control', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تصمیم نهایی',
      onBack: () => {},
    });

    // Assert
    assert.ok(screen.has('تصمیم نهایی'), 'the header does not render its title');
  });

  test('renders an optional subtitle when given one', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تست',
      subtitle: 'زمان',
      onBack: () => {},
    });

    // Assert
    assert.ok(screen.has('زمان'), 'the subtitle is dropped');
  });

  test('applies the top safe-area inset in the rendered markup', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تست',
      onBack: () => {},
    });

    // Assert — asserted on the RENDERED padding, not on the source file. The
    // stub's inset is 47 and the header adds its own rhythm on top, so the
    // value must EXCEED the bare inset; a header that forgot it renders
    // `padding-top:0` and fails here. A source grep would pass on a component
    // that imported the hook and never used the value.
    const padding = /padding-top:(\d+)px/.exec(screen.html);
    assert.ok(padding, 'the header renders no padding-top at all');
    assert.ok(
      Number(padding[1]) > 47,
      `the header's padding (${padding[1]}px) does not include the 47px top inset`,
    );
  });
});
