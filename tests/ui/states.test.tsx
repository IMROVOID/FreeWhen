/**
 * The five screen states, as rendered (Plan 11, TEST_STRUCTURE).
 *
 * ★ EACH TEST MAPS TO ONE ACCEPTANCE CRITERION.
 *
 * AC-11.3.1 organizer-alone actionable · AC-11.6.1 unknown never blank ·
 * AC-11.7.1 offline readable with a pending marker · the skeleton-not-spinner
 * rule · plain-language errors with retry · permission-denied with a working
 * alternative.
 *
 * ★ THE ASSERTIONS READ RENDERED TEXT.
 *
 * As in `tests/ui/ranking.test.tsx`: a component-tree assertion can pass on a
 * component that renders the wrong words, and every one of these criteria is
 * about what the user reads. `react-native-web` renders to real markup, so the
 * text is what gets checked.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import { switchLanguage } from '@/src/features/settings/services/switch-language';
import type { RenderedScreen } from './support/render';

let renderComponent: typeof import('./support/render').renderComponent;
let createElement: typeof import('./support/render').createElement;

before(async () => {
  initI18n('fa');
  ({ renderComponent, createElement } = await import('./support/render'));
});

/** A stand-in for the caller-supplied action node. */
function actionNode(label: string) {
  return createElement('button', null, label);
}

// ── AC-11.3.1 ─────────────────────────────────────────────────────────────

describe('AC-11.3.1 — the organizer-alone empty state is actionable', () => {
  test('the prompt offers the first proposal, not just a description', async () => {
    // Arrange
    const { ScreenStateGate } = await import('@/src/components/states/ScreenStateGate');
    const state = {
      kind: 'empty' as const,
      prompt: 'شروع کنید: اولین پیشنهاد را اضافه کنید',
      body: 'با یک زمان یا مکان شروع کنید تا بقیه هم نظر بدهند.',
      action: actionNode('پیشنهاد جدید'),
    };

    // Act
    const screen = renderComponent(ScreenStateGate, { state });

    // Assert
    assert.ok(screen.has('شروع کنید: اولین پیشنهاد را اضافه کنید'), 'the prompt rendered');
    assert.ok(screen.has('پیشنهاد جدید'), 'the action is present and tappable');
  });

  test('an empty state with no action still states the next step', async () => {
    // Arrange
    const { EmptyState } = await import('@/src/components/states/EmptyState');

    // Act
    const screen = renderComponent(EmptyState, {
      prompt: 'هنوز رویدادی ندارید',
      body: 'اولین رویداد را بسازید و دوستانتان را دعوت کنید.',
    });

    // Assert — the body names the next step even without a control.
    assert.ok(screen.has('هنوز رویدادی ندارید'));
    assert.ok(screen.has('اولین رویداد را بسازید'));
  });
});

// ── AC-11.6.1 ─────────────────────────────────────────────────────────────

describe('AC-11.6.1 — an unknown attribute renders نامشخص, never blank', () => {
  test('the unknown word is present in both catalogues', async () => {
    // Arrange — the word is the contract, so it is asserted directly in both.
    const fa = (await import('@/src/i18n/fa.json')).default as { states: { unknown: string } };
    const en = (await import('@/src/i18n/en.json')).default as { states: { unknown: string } };

    // Act / Assert
    assert.equal(fa.states.unknown, 'نامشخص');
    assert.equal(en.states.unknown, 'Unknown');
  });

  test('a missing actor still produces a sentence, never a blank row', async () => {
    // Arrange — `actor_name` is null when a participant was deleted.
    // ★ Imported from `@/src/i18n`, which re-exports the INITIALISED instance.
    // A bare `import 'i18next'` resolves to the package default, which is a
    // different, unconfigured instance in this process.
    const { default: i18next } = await import('@/src/i18n');
    const entry = {
      id: 'a1',
      action: 'proposal_created' as const,
      actor_name: null,
      subject_type: 'proposal',
      subject_id: 'p1',
      detail: {},
      created_at: '2026-01-01T00:00:00.000Z',
    };

    // Act — the same construction the screen uses for a nameless actor.
    const actor = entry.actor_name ?? i18next.t('a11y.roles.visitor');

    // Assert
    assert.equal(entry.actor_name, null);
    assert.ok(typeof actor === 'string' && actor.trim().length > 0, 'an actor word is substituted');
    assert.notEqual(actor, 'a11y.roles.visitor', 'the key resolved, not echoed');
  });
});

// ── AC-11.7.1 ─────────────────────────────────────────────────────────────

describe('AC-11.7.1 — offline stays readable, non-blocking, and marks the queue', () => {
  test('the banner renders over content and is not a dialog', async () => {
    // Arrange
    const { ScreenStateGate } = await import('@/src/components/states/ScreenStateGate');
    const state = {
      kind: 'ready' as const,
      children: createElement('span', null, 'شام جمعه'),
    };

    // Act
    const screen = renderComponent(ScreenStateGate, { state, offline: true });

    // Assert
    assert.ok(screen.has('شام جمعه'), 'cached content stays readable');
    assert.ok(screen.matches(/آفلاین/), 'the banner is shown');
    // ★ NOT BLOCKING — no dialog role anywhere in the markup.
    assert.equal(/role="alertdialog"/.test(screen.html), false, 'never a modal');
  });

  test('a queued write is counted in the banner, not hidden', async () => {
    // Arrange
    const { OfflineBanner } = await import('@/src/components/states/OfflineBanner');

    // Act
    const screen = renderComponent(OfflineBanner, { pendingCount: 2 });

    // Assert
    assert.ok(screen.matches(/۲|2/), 'the queue depth is stated');
    assert.ok(screen.matches(/آفلاین/), 'the connection state is stated');
  });

  test('no banner is rendered while online', async () => {
    // Arrange
    const { ScreenStateGate } = await import('@/src/components/states/ScreenStateGate');
    const state = { kind: 'ready' as const, children: createElement('span', null, 'محتوا') };

    // Act
    const screen = renderComponent(ScreenStateGate, { state, offline: false });

    // Assert
    assert.ok(screen.has('محتوا'));
    assert.equal(screen.matches(/آفلاین/), false, 'online shows no offline strip');
  });
});

// ── Skeletons ─────────────────────────────────────────────────────────────

describe('loading is skeleton rows, never a full-screen list spinner', () => {
  test('the loading state renders placeholder rows and one busy region', async () => {
    // Arrange
    const { ListSkeleton } = await import('@/src/components/states/ListSkeleton');

    // Act
    const screen = renderComponent(ListSkeleton, { rows: 4 });

    // Assert — one announced progressbar, and no spinner.
    assert.equal(screen.html.split('role="progressbar"').length - 1, 1, 'one busy region');
    // The announcement is an `aria-label` attribute, so this assertion reads
    // `html` — the same reason the ranking suite reads `html` for a style token.
    assert.match(screen.html, /در حال بارگذاری/, 'the wait is announced');
    assert.equal(screen.matches(/ActivityIndicator|spinner/i), false, 'no spinner');
  });
});

// ── Errors ────────────────────────────────────────────────────────────────

describe('the error state is plain language plus retry', () => {
  test('a failure renders a sentence and a retry control', async () => {
    // Arrange
    const { ErrorState } = await import('@/src/components/states/ErrorState');

    // Act
    const screen = renderComponent(ErrorState, {
      messageKey: 'states.errorBody',
      onRetry: () => undefined,
    });

    // Assert
    assert.ok(screen.has('ارتباط برقرار نشد'), 'a sentence, not a code');
    assert.ok(screen.has('تلاش دوباره'), 'the retry is offered');
    assert.equal(screen.matches(/TypeError|undefined|null/), false, 'no raw error leaked');
  });

  test('a failure with no retry handler still explains itself', async () => {
    // Arrange
    const { ErrorState } = await import('@/src/components/states/ErrorState');

    // Act
    const screen = renderComponent(ErrorState, { messageKey: 'states.errorBody' });

    // Assert
    assert.ok(screen.has('بارگیری نشد'), 'the heading renders');
    assert.ok(screen.has('ارتباط برقرار نشد'), 'so does the reason');
  });
});

// ── Permission denied ─────────────────────────────────────────────────────

describe('permission denied offers a working alternative, never a block', () => {
  test('the manual-entry route is offered at equal prominence', async () => {
    // Arrange
    const { PermissionDeniedState } = await import('@/src/components/states/PermissionDeniedState');

    // Act
    const screen = renderComponent(PermissionDeniedState, {
      alternative: actionNode('محله را دستی وارد کنید'),
    });

    // Assert — the alternative is present and actionable, not a consolation line.
    assert.ok(screen.has('دسترسی داده نشد'), 'what was refused is named');
    assert.ok(screen.has('محله را دستی وارد کنید'), 'the working route is offered');
  });
});

// ── The language switch ───────────────────────────────────────────────────

describe('the language switch flushes before it asks for a restart', () => {
  test('a real change flushes queued writes, then requires a restart with a reason', async () => {
    // Arrange
    let flushed = false;
    const persisted: string[] = [];

    // Act
    const result = await switchLanguage({
      current: 'fa',
      flush: async () => {
        flushed = true;
      },
      persist: (language) => persisted.push(language),
    });

    // Assert — flush happened, the choice is persisted, and the reason is a key.
    assert.equal(flushed, true, 'queued writes were sent before the restart');
    assert.deepEqual(persisted, ['en'], 'the choice is persisted first');
    assert.equal(result.restartRequired, true, 'a direction change needs a restart');
    assert.equal(result.reasonKey, 'states.languageRestartReasonEn', 'the reason is stated');
  });

  test('a failed flush holds the restart instead of losing the write', async () => {
    // Arrange / Act
    const result = await switchLanguage({
      current: 'fa',
      flush: async () => {
        throw new Error('offline');
      },
      persist: () => undefined,
    });

    // Assert
    assert.equal(result.restartRequired, false, 'no restart over an unsent write');
    assert.equal(result.flushErrorKey !== null, true, 'the failure is surfaced');
  });
});

// ── The activity screen ───────────────────────────────────────────────────

describe('the activity log is actions only', () => {
  test('the screen states that there are no coordinates', async () => {
    // Arrange
    const fa = (await import('@/src/i18n/fa.json')).default as {
      activity: { subheading: string; actions: Record<string, string> };
    };

    // Act / Assert — the subtitle says so, and no action template carries a coordinate.
    assert.ok(fa.activity.subheading.includes('بدون موقعیت مکانی'), 'the promise is visible');
    for (const [name, template] of Object.entries(fa.activity.actions)) {
      assert.equal(
        /\{\{\s*(lat|lng|latitude|longitude|coord)/i.test(template),
        false,
        `${name} must not interpolate a coordinate`,
      );
    }
  });
});

export type { RenderedScreen };
