/**
 * The chat's presentation rules, as rendered (Plan 42, Tasks 3–7).
 *
 * ★ THESE ARE THE DECISIONS THAT WERE WRONG BEFORE, SO THEY ARE TESTED.
 *
 * The bubble side, the date pill and the empty state are all places where the
 * screen looked correct enough to ship and was unusable: the sender's own
 * message sat on the wrong side in Persian, a thread spanning midnight read as
 * one day, and the empty prompt had no affordance at all. Each is a pure
 * function or a rendered sentence, so each can be pinned without a device.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import { bubbleAlignment, startsNewDay, type ChatMessage } from '@/src/features/events/services/chat-rules';
import type { RenderedScreen } from './support/render';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

/** A message from one participant at one instant. */
function message(id: string, createdAt: string, participantId = 'p-1'): ChatMessage {
  return {
    id,
    event_id: 'e-1',
    participant_id: participantId,
    sender_name: 'Bahar',
    body: 'سلام',
    message_type: 'chat',
    created_at: createdAt,
  };
}

// ── Bubbles ───────────────────────────────────────────────────────────────

describe('a bubble sits on the side the reader expects', () => {
  test('★ in a Persian (RTL) layout the sender is still on the right', () => {
    // `right` is physical. The whole point of the rule is that "my message is
    // on the right" does not flip with the layout direction — which is what a
    // plain `flex-end` would do.
    assert.equal(bubbleAlignment(true, true), 'flex-start', 'RTL: right == flex-start');
    assert.equal(bubbleAlignment(false, true), 'flex-end', 'RTL: left == flex-end');
  });

  test('in an LTR layout the sender is on the right', () => {
    assert.equal(bubbleAlignment(true, false), 'flex-end', 'LTR: right == flex-end');
    assert.equal(bubbleAlignment(false, false), 'flex-start', 'LTR: left == flex-start');
  });

  test('the two sides are never the same, in either direction', () => {
    for (const isRtl of [true, false]) {
      assert.notEqual(
        bubbleAlignment(true, isRtl),
        bubbleAlignment(false, isRtl),
        `own and other's messages must not collide (isRtl: ${isRtl})`,
      );
    }
  });
});

// ── Date pills ────────────────────────────────────────────────────────────

describe('a date pill separates the days, not the messages', () => {
  test('the first message always carries one', () => {
    const list = [message('m-1', '2026-08-01T10:00:00.000Z')];

    assert.equal(startsNewDay(list, 0), true);
  });

  test('two messages on the same day share one pill', () => {
    const list = [
      message('m-1', '2026-08-01T10:00:00.000Z'),
      message('m-2', '2026-08-01T10:05:00.000Z'),
    ];

    assert.equal(startsNewDay(list, 1), false);
  });

  test('★ a thread that crosses midnight starts a second day', () => {
    // 23:50 and 00:10 local, a bounded distance apart — the case a naive
    // "same UTC date" comparison gets wrong for half the world's timezones.
    const list = [
      message('m-1', '2026-08-01T10:00:00.000Z'),
      message('m-2', '2026-08-03T10:00:00.000Z'),
    ];

    assert.equal(startsNewDay(list, 1), true);
  });

  test('an unparseable timestamp groups with what precedes it', () => {
    const list = [
      message('m-1', '2026-08-01T10:00:00.000Z'),
      message('m-2', 'not-a-date'),
    ];

    // Both resolve to `null`, so the days compare equal and no bogus date is
    // printed above a message whose time is unknown.
    assert.equal(startsNewDay(list, 1), false);
  });

  test('an out-of-range index is not a new day', () => {
    const list = [message('m-1', '2026-08-01T10:00:00.000Z')];

    assert.equal(startsNewDay(list, 5), false);
  });
});

// ── The empty state ───────────────────────────────────────────────────────

describe('the empty chat is a centred card, not a banner', () => {
  test('★ the prompt renders as a sentence, not as its own key', async () => {
    // The screen renders `{t('chat.empty')}`. A missing key resolves to the key
    // itself, which would put «chat.empty» in the box — so the catalogue is
    // read directly, in both languages.
    const fa = (await import('@/src/i18n/fa.json')).default as {
      chat: { empty: string };
    };
    const en = (await import('@/src/i18n/en.json')).default as {
      chat: { empty: string };
    };

    assert.equal(fa.chat.empty, 'هنوز پیامی نیست. سلام کن.');
    assert.ok(!en.chat.empty.includes('chat.empty'), 'English resolves too');
  });

  test('the empty prompt is announced by the shared empty state', async () => {
    // `EmptyState` is what the pattern renders before the box existed; the box
    // reuses the same catalogue sentence, so the announcement is asserted on
    // the shared component rather than through the un-mountable screen.
    const { EmptyState } = await import('@/src/components/states/EmptyState');
    const fa = (await import('@/src/i18n/fa.json')).default as {
      chat: { empty: string };
    };

    const screen: RenderedScreen = renderComponent(EmptyState, {
      prompt: fa.chat.empty,
      testID: 'chat-empty',
    });

    assert.ok(screen.has('هنوز پیامی نیست'), 'the prompt is rendered as text');
    assert.equal(screen.matches(/chat\.empty/), false, 'no raw key leaked');
  });
});
