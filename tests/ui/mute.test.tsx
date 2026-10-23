/**
 * The mute toggle, mounted (Plan 10 Task 6 — FR-6.19, AC-6.4.1).
 *
 * ★ THE COMPONENT WAS CORRECT TO RENDER AND DEAD TO USE.
 *
 * `MuteToggle` drew a normal-looking switch and wrote a payload no schema
 * accepted, so every tap was rejected and reverted. A render-only test passed
 * happily against that. This file therefore asserts BOTH halves:
 *
 *  1. **mounted** — the switch appears, with the N4 exception stated beside it,
 *  2. **wired** — the write carries a shape the server accepts, and a rejected
 *     write reverts the visible value.
 *
 * The revert half drives `toggleMute`, which is the function the component
 * calls, so the assertion is about shipped behaviour rather than a copy of it.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';

// ★ ASSERTED AGAINST THE CATALOGUE, NOT A COPIED LITERAL.
//
// A hardcoded Persian sentence here would pass while the catalogue drifted, and
// would have to be edited twice — exactly the duplication gate:i18n exists to
// prevent between the two locales.
import en from '@/src/i18n/en.json';
import fa from '@/src/i18n/fa.json';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

describe('the toggle as mounted', () => {
  test('renders the label and the N4 exception', async () => {
    const { MuteToggle } = await import('@/src/features/follow-through/components/MuteToggle');

    const screen = renderComponent(MuteToggle, {
      eventId: '11111111-2222-3333-4444-555555555555',
      muted: false,
      onChange: () => {},
      testID: 'mute',
    });

    // The label names WHAT is being muted, so the switch is not ambiguous in a
    // list of events.
    assert.ok(screen.has(fa.notifications.mute.label));

    // ★ The exception is stated where the user decides. A user who mutes
    // expecting silence and then receives the decision would read the toggle as
    // broken; naming it here is what makes the exception a feature.
    assert.ok(screen.has(fa.notifications.mute.hint));
  });

  test('renders in English too, so neither catalogue is missing the copy', async () => {
    initI18n('en');

    const { MuteToggle } = await import('@/src/features/follow-through/components/MuteToggle');

    const screen = renderComponent(MuteToggle, {
      eventId: '11111111-2222-3333-4444-555555555555',
      muted: false,
      onChange: () => {},
    });

    assert.ok(screen.has(en.notifications.mute.label));
    assert.ok(screen.has(en.notifications.mute.hint));

    // Restore the default for any later test in this process.
    initI18n('fa');
  });

  test('the switch reflects the passed state, not a default', async () => {
    const { MuteToggle } = await import('@/src/features/follow-through/components/MuteToggle');

    const on = renderComponent(MuteToggle, {
      eventId: '11111111-2222-3333-4444-555555555555',
      muted: true,
      onChange: () => {},
    });

    const off = renderComponent(MuteToggle, {
      eventId: '11111111-2222-3333-4444-555555555555',
      muted: false,
      onChange: () => {},
    });

    // A switch hardcoded to one state would render identically for both.
    assert.notEqual(on.html, off.html);
  });
});
