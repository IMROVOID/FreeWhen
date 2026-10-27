/**
 * No `t()` call may carry an Arabic-script default literal.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `t(key, 'فارسی')` passes the Persian string as i18next's DEFAULT VALUE. When
 * the key exists it is ignored; when the key is missing it is what renders. Ten
 * keys were missing from BOTH catalogues, so English mode showed Persian in the
 * location picker, the time wheel and the date component — "زمان انتخاب شده",
 * "مکان انتخابی روی نقشه", "حذف مکان" and their neighbours.
 *
 * `gate:i18n` could not see any of it: it checks key parity between the two
 * catalogues and namespace ownership, and never looks inside `.tsx`. A missing
 * key plus a Persian fallback is invisible to every rule it has.
 *
 * ★ WHY THE DEFAULT IS BANNED RATHER THAN TRANSLATED.
 *
 * Keeping the literal means the bug returns with the next missing key, silently.
 * Banning it means a missing key renders as the key name — ugly, obvious, and
 * impossible to ship by accident — and this test fails first.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Arabic-script codepoints, which cover Persian. */
const ARABIC_SCRIPT = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const SOURCE_ROOTS = ['src', 'app'];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) found.push(full);
  }

  return found;
}

function allSources(): string[] {
  return SOURCE_ROOTS.flatMap((root) => sourceFiles(root));
}

/**
 * `t('key', 'default')` where the default contains Arabic script.
 *
 * Deliberately matched against the source text, because the whole point is to
 * catch what ships — a runtime assertion would only catch the keys a test
 * happens to render.
 */
function persianDefaults(source: string): string[] {
  const offenders: string[] = [];
  const call = /\bt\(\s*('[^']*'|"[^"]*")\s*,\s*('([^']*)'|"([^"]*)"|`([^`]*)`)/g;

  for (const match of source.matchAll(call)) {
    const key = match[1];
    const fallback = match[3] ?? match[4] ?? match[5] ?? '';
    if (ARABIC_SCRIPT.test(fallback)) {
      offenders.push(`${key} -> ${fallback}`);
    }
  }

  return offenders;
}

test('no t() call passes a Persian string as its default value', () => {
  // Arrange
  const offenders: string[] = [];

  // Act
  for (const file of allSources()) {
    const source = readFileSync(file, 'utf8');
    for (const hit of persianDefaults(source)) offenders.push(`${file}: ${hit}`);
  }

  // Assert — an empty list. A single hit is a screen that shows Persian in
  // English mode as soon as its key goes missing.
  assert.deepEqual(offenders, [], `Persian default literals found:\n${offenders.join('\n')}`);
});

test('the location picker keys exist in both catalogues', () => {
  // Arrange
  const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8')) as Record<string, unknown>;
  const fa = JSON.parse(readFileSync('src/i18n/fa.json', 'utf8')) as Record<string, unknown>;

  const required = [
    ['proposals', 'place', 'customPin'],
    ['proposals', 'place', 'confirmLocation'],
    ['proposals', 'place', 'searchPlaceholder'],
    ['location', 'currentPosition'],
    ['map', 'zoomIn'],
    ['map', 'zoomOut'],
    ['slots', 'am'],
    ['slots', 'pm'],
    ['slots', 'chosenTime'],
    ['slots', 'chosenDate'],
  ];

  const missing: string[] = [];
  const has = (catalogue: Record<string, unknown>, path: string[]): boolean => {
    let node: unknown = catalogue;
    for (const part of path) {
      if (typeof node !== 'object' || node === null) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
  };

  // Act
  for (const path of required) {
    const name = path.join('.');
    if (!has(en, path)) missing.push(`en: ${name}`);
    if (!has(fa, path)) missing.push(`fa: ${name}`);
  }

  // Assert
  assert.deepEqual(missing, [], `missing keys:\n${missing.join('\n')}`);
});
