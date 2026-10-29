/**
 * The web sheet's two gestures, and the direction store behind every mirrored
 * control.
 *
 * ★ THE SHEET COULD ONLY BE CLOSED WITH A MOUSE.
 *
 * A scrim click and Escape are the two dismissals a desktop user has, and a phone
 * has neither. The grabber was `pointerEvents="none"` — pure decoration — so the
 * one affordance that LOOKS draggable did nothing. The rules behind the drag are
 * pure (`sheet-gestures.ts`) precisely so they can be asserted: a one-pixel
 * wobble must not close the sheet, and a fast short flick must.
 *
 * ★ A CAPPLED SHEET SHOULD USE THE ROOM IT HAS.
 *
 * The privacy notice sat in an 85% box with the page dimmed behind it and still
 * made the reader scroll inside a short window. It now grows to the full viewport
 * once the reader scrolls and returns to its ceiling at the top — with
 * hysteresis, because a threshold without it flaps on every frame at the
 * boundary.
 *
 * ★ AND THE DIRECTIONS ARE A SINGLE SOURCE OF TRUTH.
 *
 * `isRtlLayout` used to OR the language with `I18nManager.isRTL` on native and to
 * read the DOCUMENT's `dir` first on web. Both of those disagree with the live
 * catalogue after a runtime switch — which is how English shipped with Persian
 * chevrons, a Persian segmented-control offset and a switch knob outside its
 * track. These assertions pin the new rule: the language decides, nothing else.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  CLOSE_DISTANCE_RATIO,
  CLOSE_VELOCITY,
  EXPAND_THRESHOLD,
  ceilingPercentOf,
  expandedFor,
  releaseTravelFor,
  shouldCloseOnDrag,
} from '@/src/components/ui/sheet-gestures';
import {
  backIconIsRtl,
  directionCode,
  directionSnapshot,
  isRtlLanguage,
  isRtlLayout,
} from '@/src/platform/layout-direction';
import i18next, { initI18n, setLanguage } from '@/src/i18n';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ── The drag ─────────────────────────────────────────────────────────────── */

test('a small slow drag snaps the sheet back', () => {
  // Arrange — 20px on a 700px panel, with no fling.
  const travel = releaseTravelFor(20, 0.05, 700);

  // Assert
  assert.equal(travel, 0, 'a 20px drift closed the sheet');
  assert.equal(shouldCloseOnDrag(20, 0.05, 700), false);
});

test('a drag past a quarter of the panel closes it', () => {
  // Arrange — just over the ratio, at no speed.
  const dy = 700 * CLOSE_DISTANCE_RATIO + 1;

  // Assert
  assert.equal(shouldCloseOnDrag(dy, 0, 700), true);
  assert.ok(releaseTravelFor(dy, 0, 700) >= dy, 'the close travel is shorter than the drag');
});

test('a fast short flick closes it', () => {
  // Arrange — 30px, but flung at twice the threshold speed.
  const vy = CLOSE_VELOCITY * 2;

  // Assert
  assert.equal(shouldCloseOnDrag(30, vy, 700), true);
  assert.ok(
    releaseTravelFor(30, vy, 700) > 30,
    'the exit starts from nowhere and will pop rather than slide',
  );
});

test('an upward drag never closes it', () => {
  // Assert — pulling up is the opposite gesture, even at great speed and length.
  assert.equal(shouldCloseOnDrag(-400, 5, 700), false);
  assert.equal(releaseTravelFor(-400, 5, 700), 0);
});

test('a non-finite drag is ignored rather than closing the sheet', () => {
  assert.equal(shouldCloseOnDrag(Number.NaN, Number.NaN, 700), false);
});

test('a non-dismissible sheet cannot be dragged away', () => {
  // Arrange — the nickname gate owns its own exit.
  const sheet = code('src/components/ui/BottomSheet.web.tsx');

  // Act
  const guarded = /if \(!dismissible\) return;/.test(sheet);
  const escapeGuarded = /if \(!visible \|\| !dismissible \|\| typeof document/.test(sheet);

  // Assert
  assert.ok(guarded, 'the drag starts even when the sheet is a gate');
  assert.ok(escapeGuarded, 'Escape closes a sheet that must not close');
});

test('the grabber is a drag handle, not decoration', () => {
  // Arrange
  const sheet = code('src/components/ui/BottomSheet.web.tsx');

  // Act
  const handlers = /onPointerDown/.test(sheet) && /onPointerMove/.test(sheet) && /onPointerUp/.test(sheet);
  const blocked = /grabberRow[\s\S]{0,400}pointerEvents="none"/.test(sheet);
  const browserYields = /touchAction: 'none'/.test(sheet);

  // Assert
  assert.ok(handlers, 'the grabber has no drag handlers');
  assert.ok(!blocked, 'the grabber still refuses pointer events');
  assert.ok(browserYields, 'the browser owns the vertical gesture and steals the drag');
});

/* ── Expanding while reading ──────────────────────────────────────────────── */

test('scrolling a long sheet past the threshold expands it', () => {
  assert.equal(expandedFor({ offsetY: EXPAND_THRESHOLD + 1, expanded: false }), true);
});

test('a sheet that has not been scrolled is not expanded', () => {
  assert.equal(expandedFor({ offsetY: 0, expanded: false }), false);
});

test('expanding does not flap on a jitter at the boundary', () => {
  // Arrange — the reader is expanded and hovers right at the threshold.
  for (const offsetY of [1, 5, EXPAND_THRESHOLD - 1, EXPAND_THRESHOLD, EXPAND_THRESHOLD + 1]) {
    // Assert — once expanded, only the very top collapses it.
    assert.equal(
      expandedFor({ offsetY, expanded: true }),
      true,
      `offsetY=${offsetY} collapsed the panel while there was still content above`,
    );
  }
});

test('scrolling back to the very top restores the original height', () => {
  assert.equal(expandedFor({ offsetY: 0, expanded: true }), false);
});

test('a sheet with no declared ceiling is never expanded', () => {
  // Arrange — a two-line confirmation has nothing to reveal.
  const sheet = code('src/components/ui/BottomSheet.web.tsx');

  // Assert
  assert.ok(
    /if \(next && snapPoints === undefined\) return;/.test(sheet),
    'a content-sized sheet jumps to full height for no reason',
  );
});

test('the ceiling is read as a percentage of the viewport', () => {
  assert.equal(ceilingPercentOf(['85%']), 85);
  assert.equal(ceilingPercentOf(undefined), 100);
  assert.equal(ceilingPercentOf(['auto']), 100);
});

/* ── Direction ────────────────────────────────────────────────────────────── */

test('the language alone decides the direction', () => {
  // Arrange — Persian is right-to-left; everything else is not.
  initI18n('fa');

  try {
    // Act / Assert
    assert.equal(isRtlLanguage('fa'), true);
    assert.equal(isRtlLanguage('en'), false);
    assert.equal(backIconIsRtl('fa'), true);
    assert.equal(backIconIsRtl('en'), false);
    assert.equal(directionCode('fa'), 'rtl');
    assert.equal(directionCode('en'), 'ltr');
  } finally {
    initI18n('fa');
  }
});

test('switching the language switches the direction, with no reload', () => {
  // Arrange
  initI18n('fa');

  // Act
  setLanguage('en');

  // Assert — the live snapshot follows the catalogue immediately.
  assert.equal(i18next.language, 'en');
  assert.equal(directionSnapshot(), false, 'the direction did not follow the language');
  assert.equal(isRtlLayout(), false, 'a caller reading the live direction still gets RTL');

  // Act — and back, which is the half that used to be dead.
  setLanguage('fa');

  // Assert
  assert.equal(i18next.language, 'fa');
  assert.equal(directionSnapshot(), true, 'switching back to Persian did not restore RTL');
});

test('the direction module consults no platform manager', () => {
  // Arrange — `I18nManager.isRTL` caches at module load and only changes on an OS
  // restart, so a live switch leaves it on the old value; the DOM's `dir` is
  // stamped by the static export from the BUILD-time language. Either being an
  // input is the bug.
  const direction = code('src/platform/layout-direction.ts');

  // Act
  const usesManager = /I18nManager/.test(direction);
  const usesDocument = /documentElement|getAttribute\('dir'\)/.test(direction);

  // Assert
  assert.ok(!usesManager, 'the direction still ORs in I18nManager.isRTL');
  assert.ok(!usesDocument, 'the direction still prefers the document attribute');
});

test('every geometry consumer subscribes instead of reading once', () => {
  // Arrange — a component that reads the direction during render keeps stale
  // geometry after a switch, which is how the pill ended up over the wrong
  // option and the knob outside its track.
  for (const path of [
    'src/components/ui/Chip.tsx',
    'src/components/ui/AccentSwitch.tsx',
    'src/features/events/components/EventContextMenu.tsx',
  ]) {
    // Act
    const source = code(path);

    // Assert
    assert.ok(/useLayoutDirection\(\)/.test(source), `${path} does not subscribe to the direction`);
    assert.ok(
      !/isRtlLayout\(i18n\.language\)/.test(source),
      `${path} still snapshots the direction from the render-time locale`,
    );
  }
});

test('the root layout rebuilds the navigator when the direction changes', () => {
  // Arrange — `I18nManager` cannot reflow a mounted native tree, and the restart
  // prompt that used to cover for it is gone. Keying the stack on the direction
  // is what makes the switch live on native.
  const layout = code('app/_layout.tsx');

  // Act
  const keyed = /key=\{directionKey\}/.test(layout);
  const derived = /const directionKey = rtl \? 'rtl' : 'ltr'/.test(layout);

  // Assert
  assert.ok(derived, 'the layout does not derive a direction key');
  assert.ok(keyed, 'the navigator is not rebuilt on a direction change');
});

test('the restart prompt is gone from the product and from both catalogues', async () => {
  // Arrange
  const service = code('src/features/settings/services/switch-language.ts');
  const { resources } = await import('@/src/i18n');

  // Act / Assert — the control no longer asks anyone to restart.
  assert.ok(!/restartRequired: true/.test(service), 'the service still demands a restart');

  for (const language of ['en', 'fa'] as const) {
    const states = (resources[language].translation as unknown as { states: Record<string, string> })
      .states;

    assert.equal(states.languageRestartReasonEn, undefined, `${language} still carries the restart reason`);
    assert.equal(states.languageRestartReasonFa, undefined, `${language} still carries the restart reason`);
    assert.equal(states.languageRestartAction, undefined, `${language} still carries the restart action`);
    assert.equal(states.languageRestartLater, undefined, `${language} still carries the restart dismissal`);
  }
});

test('the switch reports a real change in both directions', async () => {
  // Arrange
  initI18n('fa');
  const { chooseLanguage } = await import('@/src/features/settings/services/switch-language');
  const persisted: string[] = [];

  // Act — fa → en.
  const toEnglish = await chooseLanguage('en', {
    current: 'fa',
    persist: (language) => persisted.push(language),
  });

  // Assert
  assert.equal(toEnglish.changed, true);
  assert.equal(toEnglish.restartRequired, false);
  assert.equal(i18next.language, 'en');

  // Act — and back, which the old "equals the stored value" guard treated as a
  // no-op and left the button dead.
  const toPersian = await chooseLanguage('fa', {
    current: 'en',
    persist: (language) => persisted.push(language),
  });

  // Assert
  assert.equal(toPersian.changed, true, 'switching back to Persian did nothing');
  assert.equal(i18next.language, 'fa');
  assert.deepEqual(persisted, ['en', 'fa']);
});

test('a rejected flush still switches, and says so', async () => {
  // Arrange
  initI18n('fa');
  const { chooseLanguage } = await import('@/src/features/settings/services/switch-language');

  // Act
  const result = await chooseLanguage('en', {
    current: 'fa',
    persist: () => {},
    flush: () => Promise.reject(new Error('offline')),
  });

  // Assert — the language is the user's choice; the queue is a separate problem.
  assert.equal(result.flushErrorKey, 'errors.unknown');
  assert.equal(i18next.language, 'en');

  initI18n('fa');
});
