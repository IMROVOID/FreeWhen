/**
 * Every page announces itself the same way.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Screen titles were aligned by whichever screen happened to own them. The
 * event home used `align="start"`, Settings inherited that from `ScreenHeader`,
 * the chat screen centred its title, and `/start` used the `Text` default. In a
 * Persian layout `start` is the RIGHT edge and in English it is the LEFT edge,
 * so the same screen read "right aligned" to a Persian reviewer and "left
 * aligned" to an English one — which is exactly the inconsistency reported.
 *
 * ★ TWO RULES, AND THEY ARE DIFFERENT RULES.
 *
 *  1. Every page title except the home page is CENTRED on the screen's axis.
 *  2. A list-row title stays on the LEADING edge, because a row is a document
 *     of its own: its title starts where its language starts.
 *
 * Rule 2 is the one that was reported backwards — the event titles on the home
 * page needed to move to the right in a Persian interface, which is what
 * `align="start"` already means. The bug was the title claiming `flex: 1`
 * while the status chip beside it did not, so the title filled the row and
 * pushed the chip into the middle.
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

describe('a page title is centred on every page but home', () => {
  test('★ ScreenHeader centres its title', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تصمیم نهایی',
      onBack: () => undefined,
    });

    // Assert
    assert.match(screen.html, /text-align:\s*center/, 'the page title is not centred');
  });

  test('the header keeps its back control at the leading edge', async () => {
    // Arrange
    const { ScreenHeader } = await import('@/src/components/ui/ScreenHeader');

    // Act
    const screen = renderComponent(ScreenHeader, {
      title: 'تصمیم نهایی',
      onBack: () => undefined,
    });

    // Assert — centring the title must not move the exit control. The back disc
    // is the first thing in the row, so it stays on the leading edge in both
    // directions without a conditional style.
    assert.match(screen.html, /aria-label="بازگشت"/, 'the back control disappeared');
    const firstButton = screen.html.indexOf('aria-label="بازگشت"');
    const title = screen.html.indexOf('تصمیم نهایی');
    assert.ok(firstButton >= 0 && firstButton < title, 'the back control is no longer first');
  });

  test('the chat title and the start-page title share the header contract', () => {
    // Arrange — these two screens draw their own headers rather than using
    // `ScreenHeader`, which is how they drifted apart in the first place.
    const chat = code('app/event/[id]/chat.tsx');
    const start = code('app/start.tsx');

    // Act / Assert — the chat already centres; `/start` was the odd one out.
    assert.match(chat, /align="center"/, 'the chat title is not centred');
    assert.match(
      start,
      /variant="h1"[^>]*align="center"|align="center"[^>]*variant="h1"/,
      'the start page title is not centred',
    );
  });
});

describe('a list-row title stays on the leading edge', () => {
  test('★ the event title is a leading-aligned start of the row', async () => {
    // Arrange
    const { EventRow } = await import('@/src/features/events/components/EventRow');

    // Act
    const screen = renderComponent(EventRow, {
      event: {
        id: 'e-1',
        title: 'شام پنجشنبه',
        status: 'OPEN',
        participant_count: 4,
        has_pending_vote: false,
      } as never,
      onPress: () => undefined,
    });

    // Assert — `start` is the right edge in a Persian layout, and
    // react-native-web COMPILES it to a physical side, so the DOM says
    // `text-align:right`. A `center` or a `left` here would put the title on the
    // wrong edge, which is the report.
    assert.ok(screen.has('شام پنجشنبه'), 'the event title is missing');
    const titleBlock = /<[^>]*>شام پنجشنبه/.exec(screen.html)?.[0] ?? '';
    assert.match(
      titleBlock,
      /text-align:\s*right/,
      'the event title is not on the leading (right) edge of a Persian row',
    );
  });

  test('the same row title is on the left edge in English', async () => {
    // Arrange — the inverse case, so the fix cannot be "always right".
    initI18n('en');
    const { EventRow } = await import('@/src/features/events/components/EventRow');

    // Act
    const screen = renderComponent(EventRow, {
      event: {
        id: 'e-1',
        title: 'Thursday dinner',
        status: 'OPEN',
        participant_count: 4,
        has_pending_vote: false,
      } as never,
      onPress: () => undefined,
    });

    // Assert
    const titleBlock = /<[^>]*>Thursday dinner/.exec(screen.html)?.[0] ?? '';
    assert.match(
      titleBlock,
      /text-align:\s*left/,
      'the event title is not on the leading (left) edge of an English row',
    );

    initI18n('fa');
  });

  test('the title no longer stretches the row away from its status chip', () => {
    // Arrange — `flex: 1` on the title was what pushed the status chip off the
    // trailing edge and made the title look like it owned the whole row.
    const row = code('src/features/events/components/EventRow.tsx');

    // Act
    const titleBlock = /title:\s*\{([\s\S]*?)\n {2}\},/.exec(row)?.[1] ?? '';

    // Assert — the title may shrink and wrap, but it must not claim the row.
    assert.ok(
      !/flex:\s*1/.test(titleBlock),
      'the row title claims the whole row, so the status chip is not on the trailing edge',
    );
    assert.match(titleBlock, /flexShrink|flexBasis/, 'the title cannot shrink beside the chip');
  });
});
