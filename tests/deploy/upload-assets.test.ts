/**
 * The deploy artifacts must survive the upload to a single-root host.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `.gitignore` excludes `static/` and `dist/` because both are generated at
 * deploy time. Vercel's CLI falls back to `.gitignore` when a project has no
 * `.vercelignore`, so the entire composed tree — including every font file
 * under `static/assets/` — was filtered out of the UPLOAD while the HTML
 * survived.
 *
 * The symptom presented as a typography bug: the page rendered, but all 24
 * `PlusJakartaSans`/`Vazirmatn` files 404'd, so English text fell back to a
 * system face and the Persian face never loaded either. Nothing in the app code
 * was wrong, which is exactly why this needs a test at the DEPLOY boundary
 * rather than a test of `Text`.
 *
 * These assertions are cheap and they fail loudly the moment someone re-adds a
 * broad ignore rule.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const VERCELIGNORE = '.vercelignore';

function vercelIgnore(): string {
  return readFileSync(VERCELIGNORE, 'utf8');
}

/** The non-comment, non-blank lines of a file. */
function rules(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

test('a .vercelignore exists so the host does not inherit .gitignore', () => {
  // Arrange / Act / Assert — without this file Vercel applies `.gitignore`,
  // which excludes the generated deploy tree.
  assert.ok(existsSync(VERCELIGNORE), `${VERCELIGNORE} is missing — the host will apply .gitignore`);
});

test('the composed static tree is re-included for upload', () => {
  // Arrange
  const all = rules(vercelIgnore());

  // Act / Assert — a bare `!static/` re-includes the DIRECTORY entry but not
  // its children once an outer rule matched, so the recursive form is required.
  assert.ok(all.includes('!static/'), 'static/ is not re-included');
  assert.ok(all.includes('!static/**'), 'static/ re-inclusion must be recursive');
});

test('the raw export is re-included, so the merge never depends on a stale copy', () => {
  // Arrange
  const all = rules(vercelIgnore());

  // Act / Assert
  assert.ok(all.includes('!dist/'), 'dist/ is not re-included');
  assert.ok(all.includes('!dist/**'), 'dist/ re-inclusion must be recursive');
});

test('the font payload the app actually requests is covered by the rules', () => {
  // Arrange — the exact directory shape `expo export` writes, which is what the
  // browser asked for when it 404'd.
  const fontDir = 'static/assets/node_modules/@expo-google-fonts/plus-jakarta-sans/600SemiBold';
  const all = rules(vercelIgnore());

  // Act — `!static/**` is what makes a nested asset directory uploadable.
  const covered = all.includes('!static/**');

  // Assert
  assert.ok(covered, `${fontDir} would be filtered out of the upload`);
});

test('.gitignore still ignores the generated trees (the fix is host-side only)', () => {
  // Arrange
  const ignored = readFileSync('.gitignore', 'utf8');

  // Act / Assert — the repository must NOT start tracking build output; only
  // the upload is widened. Deleting these would put megabytes of generated
  // files in every commit.
  assert.match(ignored, /^\/static\/$/m, 'generated static/ should stay out of git');
  assert.match(ignored, /^dist\/$/m, 'generated dist/ should stay out of git');
});
