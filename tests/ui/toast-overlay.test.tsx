/**
 * The copied/success toast is an OVERLAY, not an inline row.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `Toast` used to be rendered inside the card that owns the copy action, so it
 * took part in the page flow: on the invite screen it appeared BETWEEN the URL
 * card and the "go to the event" button, pushing them apart, and it stayed
 * there until its timer fired. A confirmation that reflows the page it is
 * confirming is worse than no confirmation.
 *
 * The contract asserted here:
 *
 *  1. it is positioned absolutely (out of flow), anchored to the bottom;
 *  2. it does not consume touches meant for the page behind it;
 *  3. the tone is carried by an ICON, not by a bare coloured dot;
 *  4. it disappears on its own.
 *
 * Assertions are on rendered markup, because that is what the user's eye and a
 * screen reader both consume.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';

type RenderComponent = typeof import('./support/render').renderComponent;

let renderComponent: RenderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

/**
 * The attributes of the outermost element.
 *
 * `react-native-web` compiles static styles from `StyleSheet.create` into
 * atomic CSS CLASSES, not inline declarations, so an assertion about
 * `position: absolute` has to look at the class list. Inline `style` only ever
 * carries values computed at render time (theme colours, animated transforms).
 */
function outerElement(html: string): { className: string; style: string } {
  const match = /^<div([^>]*)>/.exec(html);
  const attrs = match?.[1] ?? '';
  const classMatch = /class="([^"]*)"/.exec(attrs);
  const styleMatch = /style="([^"]*)"/.exec(attrs);
  return { className: classMatch?.[1] ?? '', style: styleMatch?.[1] ?? '' };
}

describe('OverlayToast', () => {
  test('is positioned out of the page flow and anchored to the bottom', async () => {
    // Arrange
    const { OverlayToast } = await import('@/src/components/ui/OverlayToast');

    // Act
    const screen = renderComponent(OverlayToast, {
      message: 'کد رویداد کپی شد',
      visible: true,
      onDismiss: () => {},
    });

    // Assert — absolute (not static) puts it out of flow, so it cannot push the
    // page around; `bottom` anchors it where a thumb can dismiss it. Position
    // arrives as an atomic class and the offset as an inline style, so both are
    // checked on the node that actually carries them.
    const { className, style } = outerElement(screen.html);

    assert.match(className, /r-position-/, 'the toast layer must declare a position');
    assert.match(style, /bottom:\d+px/, 'the toast layer must be anchored to the bottom');
  });

  test('lets touches through to the page behind it, while staying swipeable', async () => {
    // Arrange
    const { OverlayToast } = await import('@/src/components/ui/OverlayToast');

    // Act
    const screen = renderComponent(OverlayToast, {
      message: 'رونوشت شد',
      visible: true,
      onDismiss: () => {},
    });

    // Assert — `box-none`, not `none`: the empty area passes touches through to
    // the page, but the pill itself stays a hit target so the dismiss gesture
    // exists. `none` on the layer would have disabled the gesture entirely.
    const { className } = outerElement(screen.html);
    assert.match(
      className,
      /r-pointerEvents-/,
      'the overlay must not block touches aimed at the page',
    );
    assert.equal(
      /pointer-events:none/.test(screen.html),
      false,
      'pointer-events:none would also make the swipe unreachable',
    );
  });

  test('marks the tone with an icon rather than a bare colour dot', async () => {
    // Arrange
    const { OverlayToast } = await import('@/src/components/ui/OverlayToast');

    // Act
    const screen = renderComponent(OverlayToast, {
      message: 'رونوشت شد',
      visible: true,
      onDismiss: () => {},
      tone: 'success',
    });

    // Assert — an <svg> means a real icon. The old pill drew a plain View dot,
    // which reads as a stray bullet and carries no meaning for a colour-blind
    // reader on its own.
    assert.match(screen.html, /<svg/, 'the toast must render an icon, not a coloured dot');
  });

  test('renders nothing when it is not visible', async () => {
    // Arrange
    const { OverlayToast } = await import('@/src/components/ui/OverlayToast');

    // Act
    const screen = renderComponent(OverlayToast, {
      message: 'رونوشت شد',
      visible: false,
      onDismiss: () => {},
    });

    // Assert — a hidden overlay must contribute no node at all.
    assert.equal(screen.html, '');
  });

  test('announces itself politely so it does not interrupt the reader', async () => {
    // Arrange
    const { OverlayToast } = await import('@/src/components/ui/OverlayToast');

    // Act
    const screen = renderComponent(OverlayToast, {
      message: 'رونوشت شد',
      visible: true,
      onDismiss: () => {},
    });

    // Assert
    assert.match(screen.html, /aria-live="polite"|role="status"/, 'the toast is not announced');
  });
});
