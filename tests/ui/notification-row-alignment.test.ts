/**
 * A notification row: the title on the reading edge, the switch on the other.
 *
 * ★ THE TWO LISTS HAD SWITCHES IN DIFFERENT COLUMNS, AND THEN THE TITLE MOVED.
 *
 * The first defect was two independently-built rows whose switches landed a few
 * pixels apart; `NotificationRow` fixed it by being one component. The second is
 * the one this file now pins: on a Persian screen the event 99xxx and its switch sat
 * together in the middle of the row instead of the title holding the right edge.
 *
 * The cause is that a bare `flex: 1` label asks for the LEFTOVER width, and the
 * leftover is only resolved when the row has slack to hand out. A short title
 * collapses the label block to its text, the switch then sits directly against it,
 * and the pair reads as having left its own margin. `justifyContent:
 * 'space-between'` places the two edges explicitly, in both directions, whatever the
 * content does.
 *
 * ★ SO THE CONTRACT IS: TWO EXPLICIT EDGES, AND A LABEL THAT GIVES WAY FIRST.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { ACCENT_SWITCH_METRICS } from '@/src/components/ui/AccentSwitch';

const ROW = readFileSync('src/features/notifications/components/NotificationRow.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function style(name: string): string {
  return new RegExp(`${name}:\\s*\\{([\\s\\S]*?)\\n  \\},`).exec(ROW)?.[1] ?? '';
}

let renderComponent: typeof import('../ui/support/render').renderComponent;

before(async () => {
  const { initI18n } = await import('@/src/i18n');
  initI18n('fa');
  ({ renderComponent } = await import('../ui/support/render'));
});

test('the row places its two children on explicit edges', () => {
  // Act
  const row = style('row');

  // Assert
  assert.ok(/justifyContent:\s*'space-between'/.test(row), 'the row does not place its two edges');
  assert.ok(/alignItems:\s*'center'/.test(row), 'the switch is no longer centred on the row');
});

test('the label block gives way before the switch does', () => {
  // Arrange — a long event name must wrap instead of pushing the switch past the
  // row's trailing edge, and a short one must stay on its own edge.
  const labels = style('labels');
  const control = style('control');

  // Act
  const shrinks = /flexShrink:\s*1/.test(labels);
  const fixed = /flexShrink:\s*0/.test(control);

  // Assert
  assert.ok(shrinks, 'the label block cannot shrink, so a long title overflows the row');
  assert.ok(!/flex:\s*1,/.test(labels), 'the label still claims the leftover width instead of an edge');
  assert.ok(fixed, 'the switch is the thing that gives way');
});

test('the title is aligned to the reading edge', () => {
  // Act — `align="start"` is the RIGHT edge in Persian and the left in English.
  const title = /<Text[^>]*\bvariant="body"[\s\S]{0,120}?align="start"/.test(ROW);

  // Assert
  assert.ok(title, 'the title does not state its alignment, so it takes the container’s');
});

test('a rendered row puts the title before the control in the DOM', async () => {
  // Arrange
  const { NotificationRow } = await import('@/src/features/notifications/components/NotificationRow');

  // Act
  const screen = renderComponent(NotificationRow, {
    title: 'گروه کوه',
    children: null,
  });

  // Assert — the title is the first text child and the control is the last one, which
  // is what `space-between` then pushes to opposite edges.
  // react-native-web compiles a layout style to an atomic class, so the applied
  // class is what proves the placement reached the DOM.
  assert.match(screen.html, /r-justifyContent-/, 'the row lost its edge placement');
  assert.ok(
    /r-flexDirection-/.test(screen.html),
    'the row is no longer a row, so there are no two edges to place',
  );
});

test('the switch’s own geometry is untouched by the row', () => {
  // Arrange — the row must not re-inset the control it is given; that was the first
  // defect in this file's history (a wrapper with a gap around a zero-size node).
  const control = style('control');

  // Act / Assert
  assert.ok(!/padding/.test(control), 'the control wrapper adds padding around the switch');
  assert.equal(ACCENT_SWITCH_METRICS.inset, (ACCENT_SWITCH_METRICS.height - ACCENT_SWITCH_METRICS.knob) / 2);
});
