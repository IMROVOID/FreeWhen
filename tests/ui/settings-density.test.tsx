/**
 * Settings is a settings screen, not a notice board.
 *
 * ★ THE DEFECTS THIS PINS.
 *
 * Five separate complaints about the same screen, all of them the same shape: text
 * that restated something the layout already said, or that belonged in a
 * store-review note rather than under a toggle.
 *
 *  1. «این نسخه احراز هویت مهمان، مسدود کردن کاربر و محافظت از عکس صفحه ندارد.»
 *     — a limitations paragraph as the LAST thing on the screen, under Account.
 *  2. «این متن همراه برنامه نصب می‌شود و بدون اینترنت هم باز می‌شود.» — a footnote
 *     under the privacy button explaining that the notice opens offline.
 *  3. «انتخاب کنید کدام رویدادها می‌توانند به شما اطلاع دهند.» — a hint above a list
 *     whose rows are event names with a switch beside each one.
 *  4. Every notification row also rendered its own label AND subtitle, so with five
 *     events that pair repeated five times and each row stood three lines tall.
 *  5. The sections were separated only by whitespace, so five groups read as one
 *     long column.
 *
 * The sentences are still reachable — the mute semantics survive as the switch's
 * accessible name and hint — which is why this asserts on the RENDER, not on the
 * catalogue.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { resources } from '@/src/i18n';
import { initI18n } from '@/src/i18n';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const REMOVED_FA = {
  knownGaps: 'این نسخه احراز هویت مهمان',
  noticeFootnote: 'همراه برنامه نصب می',
  muteHint: 'کدام رویدادها می‌توانند',
} as const;

before(() => {
  initI18n('fa');
});

test('none of the removed sentences appear in the Persian catalogue render path', () => {
  // Arrange — the keys survive so the i18n parity gate keeps passing, but nothing
  // that renders Settings may reference them.
  const settings = code('app/settings/index.tsx');
  const muteList = code('src/features/follow-through/components/MuteList.tsx');

  // Assert
  assert.ok(
    !/knownGapsBody/.test(settings),
    'the limitations paragraph is still rendered on Settings',
  );
  assert.ok(
    !/noticeFootnote/.test(settings),
    'the "opens without internet" footnote is still rendered under the privacy button',
  );
  assert.ok(
    !/muteList\.hint/.test(muteList),
    'the "choose which events" hint is still rendered above the event rows',
  );
});

test('an event row is a name and a switch, with no per-row copy', () => {
  // Arrange — `MuteToggle` is the row's only control. Its label and hint must be
  // announced without occupying layout: the label is the switch's accessible name,
  // and the hint rides on a visually-hidden node the switch describes.
  const toggle = code('src/features/follow-through/components/MuteToggle.tsx');

  // Act — a visible text node is one whose surrounding `<Text>` has no zero-size
  // wrapper style.
  const visibleLabel = /<Text[\s>][^<]{0,200}?notifications\.mute\.label/.test(toggle);

  // Assert
  assert.ok(!visibleLabel, 'the mute label is still rendered as a visible Text');
  assert.ok(
    /styles\.srOnly[\s\S]{0,400}?notifications\.mute\.hint/.test(toggle),
    'the hint is rendered as ordinary text rather than in the hidden description node',
  );
  assert.ok(
    /srOnly:\s*\{[^}]*(width:\s*0|height:\s*0)/.test(toggle),
    'the description node has no zero-size style, so it occupies layout',
  );
  assert.ok(
    /accessibilityLabel=\{t\('notifications\.mute\.label'\)\}/.test(toggle),
    'the switch lost its accessible name',
  );
  assert.ok(
    /describedBy=\{descriptionId\}/.test(toggle),
    'the switch does not point at its description, so the N4 exception is silent on web',
  );
});

test('the removed sentences still exist in both catalogues, unused', () => {
  // Arrange — deleting the keys outright would fail the i18n parity gate, and the
  // English catalogue is a shipping mode rather than a fallback.
  type Catalogue = { privacy: { knownGapsBody?: string; noticeFootnote?: string } };

  const en = resources.en.translation as unknown as Catalogue;
  const fa = resources.fa.translation as unknown as Catalogue;

  // Assert
  assert.equal(typeof en.privacy.knownGapsBody, 'string');
  assert.equal(typeof fa.privacy.knownGapsBody, 'string');
  assert.ok(fa.privacy.knownGapsBody?.includes(REMOVED_FA.knownGaps));
});

test('sections are spaced further apart than the old uniform gap', async () => {
  // Arrange
  const { space } = await import('@/src/theme/tokens');
  const settings = code('app/settings/index.tsx');

  // Act — `content` is the scroll container's containerStyle.
  const content = /content:\s*\{[^}]*gap:\s*space\[(\d+)\][^}]*\}/.exec(settings);
  const section = /section:\s*\{[^}]*gap:\s*space\[(\d+)\][^}]*\}/.exec(settings);

  // Assert
  assert.ok(content, 'the content container declares no gap');
  assert.ok(section, 'a section declares no gap');
  assert.ok(
    Number(content[1]) > 5,
    `sections are ${content[1]} apart, which is the old uniform step`,
  );
  assert.ok(Number(section[1]) >= 4, `a section's own rows are only ${section[1]} apart`);
  assert.ok(space[8] > space[5], 'space[8] is not larger than space[5]');
});

test('sections are separated by space, not by a rule', () => {
  // Arrange — the sections carried a `line` hairline above each one. Six of them
  // drew a table around a settings page, and the request was to take them out.
  // The `content` gap is what separates the groups now.
  const settings = code('app/settings/index.tsx');

  // Act
  const section = /section:\s*\{([^}]*)\}/.exec(settings)?.[1] ?? '';

  // Assert
  assert.ok(section.length > 0, 'the section style is missing');
  assert.ok(!/borderTopWidth/.test(section), 'the section still draws a separating rule');
  assert.ok(/gap:\s*space\[4\]/.test(section), 'the section lost its internal rhythm too');
});

test('the privacy button is not painted the colour of the card behind it', () => {
  // Arrange — `secondary` fills with `surface2`, and this card is `raised`, which is
  // ALSO `surface2`. The two were identical, so the button had no visible surface.
  const settings = code('app/settings/index.tsx');

  // Act
  const noticeButton =
    /settings-notice-open[\s\S]{0,400}/.test(settings)
      ? /<Button[\s\S]{0,300}?testID="settings-notice-open"/.exec(settings)?.[0] ?? ''
      : '';

  // Assert
  assert.ok(noticeButton.length > 0, 'the notice button was not found');
  assert.ok(
    !/variant="secondary"/.test(noticeButton),
    'the notice button is `secondary`, which is the same fill as the raised card',
  );
  assert.ok(
    /variant="(outline|primary|brand)"/.test(noticeButton),
    'the notice button has no fill or edge that contrasts with the card',
  );
});
