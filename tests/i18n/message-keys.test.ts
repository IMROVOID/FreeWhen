/**
 * Every validation message the app can show must actually translate.
 *
 * ★ THE DEFECT THIS REPRODUCES: THE NICKNAME GATE PRINTED A RAW KEY.
 *
 * `validateNickname` returned `'validation.nameRequired'` and
 * `'validation.nameTooLong'`, and both catalogues nest those messages under
 * `events.validation.*`. `t()` therefore found nothing and returned the key
 * verbatim, so a user who opened the app and pressed submit with an empty name was
 * shown the literal string:
 *
 *     validation.nameRequired
 *
 * Sighted on a real device (Android 15, the v0.1.4 draft APK) while verifying the
 * startup crash. It is a small-looking bug with a disproportionate effect: the one
 * message that tells a first-time user what to type is the one message that
 * renders as machine text.
 *
 * ★ WHY IT WAS NOT CAUGHT.
 *
 * Every existing test asserted against the key — `setNameError('...n')` in
 * `profile-nickname.test.tsx`, or the schema's own `VALIDATION` constant — so the
 * tests agreed with the bug. The invariant that matters is not "the key is
 * reported"; it is "the key EXISTS in both catalogues", which is a property of the
 * string, not of the component.
 *
 * The rule is stated generally so a future message with a missing namespace fails
 * here rather than on a device.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { validateNickname } from '@/src/features/profile/services/profile';

function catalogue(language: 'en' | 'fa'): Record<string, unknown> {
  return JSON.parse(readFileSync(`src/i18n/${language}.json`, 'utf8')) as Record<string, unknown>;
}

/** Resolves a dotted key the way i18next does, returning `undefined` when absent. */
function lookup(source: Record<string, unknown>, key: string): unknown {
  let node: unknown = source;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/* ── The specific defect ──────────────────────────────────────────────────── */

test('an empty nickname reports a key that exists in both catalogues', () => {
  // Arrange
  const result = validateNickname('   ');

  // Act
  assert.equal(result.ok, false);
  const key = (result as { messageKey: string }).messageKey;

  // Assert — the key must RESOLVE. This is the assertion that was missing.
  const english = lookup(catalogue('en'), key);
  const persian = lookup(catalogue('fa'), key);

  assert.equal(
    typeof english,
    'string',
    `"${key}" does not resolve in en.json, so t() would render the raw key instead of a message`,
  );
  assert.equal(
    typeof persian,
    'string',
    `"${key}" does not resolve in fa.json, so a Persian user would see the raw key`,
  );
});

test('an over-long nickname reports a key that exists in both catalogues', () => {
  // Arrange
  const result = validateNickname('a'.repeat(31));

  // Act
  assert.equal(result.ok, false);
  const key = (result as { messageKey: string }).messageKey;

  // Assert
  assert.equal(typeof lookup(catalogue('en'), key), 'string', `"${key}" missing from en.json`);
  assert.equal(typeof lookup(catalogue('fa'), key), 'string', `"${key}" missing from fa.json`);
});

/* ── The general rule ─────────────────────────────────────────────────────── */

test('the nickname messages live in the namespace the validators name', () => {
  // Arrange — the mismatch in one line: the validator said `validation.*`, the
  // catalogues say `events.validation.*`.
  const source = readFileSync('src/features/profile/services/profile.ts', 'utf8');

  // Act
  const keys = [...source.matchAll(/messageKey:\s*'([^']+)'/g)].map((match) => match[1]);

  // Assert
  assert.ok(keys.length > 0, 'no message keys found in the nickname validator');
  for (const key of keys) {
    const english = lookup(catalogue('en'), key as string);
    assert.equal(
      typeof english,
      'string',
      `the validator reports "${key}", which is not a key in en.json`,
    );
  }
});

test('no validation message is reachable only as a bare namespace', () => {
  // Arrange — `validation` is not a top-level namespace in either catalogue, so any
  // key starting `validation.` is a namespace mistake rather than a typo.
  for (const language of ['en', 'fa'] as const) {
    const data = catalogue(language);

    // Act / Assert
    assert.equal(
      'validation' in data,
      false,
      `${language}.json has a top-level "validation" namespace, so "validation.*" keys are valid after all`,
    );
  }
});
