/**
 * The English privacy notice must read LEFT-TO-RIGHT, and the Persian one right.
 *
 * ★ THE REPORT: "turn the English Privacy Policy text LTR, not RTL".
 *
 * The document direction was already correct — `web/privacy/en.html` carries
 * `<html lang="en" dir="ltr">`, and the deployed copy matched. What was wrong is
 * everything BELOW that attribute:
 *
 *  1. ONE FONT STACK FOR BOTH LANGUAGES, with Vazirmatn — a Persian face — ahead
 *     of the generic fallback. On the English page every character the system
 *     stack could not cover was drawn in a Persian-reading design, so the notice
 *     read as a Persian document set in Latin.
 *  2. NO BLOCK DECLARED ITS PARAGRAPH DIRECTION. `dir` is inherited, and the
 *     browser resolves bidi from the first strong character of each RUN — right
 *     inside a run, wrong for a whole block. An English table cell whose text
 *     opened with a Persian venue or provider name therefore laid that paragraph
 *     out right-to-left, which is why only SOME of the text looked wrong.
 *
 * The renderer therefore emits `dir` on every block it produces, and the page
 * shell keys the type stack off the document's direction.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const EN_PAGE = 'web/privacy/en.html';
const FA_PAGE = 'web/privacy/fa.html';
const INDEX_PAGE = 'web/privacy/index.html';

test('the English page is a left-to-right English document', () => {
  // Arrange
  const page = read(EN_PAGE);

  // Assert
  assert.match(page, /<html lang="en" dir="ltr">/, 'the English page is not lang=en dir=ltr');
  assert.match(page, /<main dir="ltr">/, 'the English content is not pinned to ltr');
});

test('the Persian page is a right-to-left Persian document', () => {
  // Arrange
  const page = read(FA_PAGE);

  // Assert
  assert.match(page, /<html lang="fa" dir="rtl">/, 'the Persian page is not lang=fa dir=rtl');
  assert.match(page, /<main dir="rtl">/, 'the Persian content is not pinned to rtl');
});

test('the type stack follows the document, and Persian is not the English face', () => {
  // Arrange
  const page = read(EN_PAGE);

  // Act — the two stacks, isolated.
  const ltrStack = /html\[dir="ltr"\] body\{([\s\S]*?)\}/.exec(page)?.[1] ?? '';
  const rtlStack = /html\[dir="rtl"\] body\{([\s\S]*?)\}/.exec(page)?.[1] ?? '';

  // Assert — both exist...
  assert.ok(ltrStack.length > 0, 'there is no left-to-right type stack');
  assert.ok(rtlStack.length > 0, 'there is no right-to-left type stack');

  // ...the RTL one is the Persian face...
  assert.match(rtlStack, /font-family:Vazirmatn/, 'the Persian page does not lead with Vazirmatn');

  // ...and the LTR one leads with Latin-metric faces. Vazirmatn survives at the
  // END of the list, so a stray Persian word still renders rather than falling
  // through to a serif default.
  const ltrFirst = ltrStack.match(/font-family:\s*([^;]+);/)?.[1] ?? '';
  assert.ok(ltrFirst.length > 0, 'the left-to-right stack declares no font-family');
  assert.ok(
    !ltrFirst.trim().startsWith('Vazirmatn'),
    `the English page leads with the Persian face: ${ltrFirst}`,
  );
  assert.match(ltrFirst, /Vazirmatn/, 'the English stack dropped the Persian fallback entirely');
});

test('every block the renderer emits carries its document direction', () => {
  // Arrange — the two languages' full text, so every block kind is exercised:
  // headings, paragraphs, bullets, tables and rules.
  for (const [page, dir] of [
    [EN_PAGE, 'ltr'],
    [FA_PAGE, 'rtl'],
  ] as const) {
    const html = read(page);

    // Act — every block element the renderer can produce.
    const blocks = html.match(/<(h1|h2|h3|p|li|td|th|table|ul)\b[^>]*>/g) ?? [];

    // Assert
    assert.ok(blocks.length > 10, `${page}: only ${blocks.length} blocks found`);

    const missing = blocks.filter((tag) => !tag.includes(`dir="${dir}"`));
    assert.equal(
      missing.length,
      0,
      `${page}: ${missing.length} block(s) inherit direction instead of pinning it, first: ${missing[0]}`,
    );
  }
});

test('no block guesses its own paragraph direction', () => {
  // Arrange — `unicode-bidi: isolate` keeps per-run bidi working (so a Persian
  // proper noun inside an English sentence still reads in the right order) while
  // the block's alignment stays the document's.
  const page = read(EN_PAGE);

  // Assert
  assert.match(page, /unicode-bidi:isolate/, 'no block isolates its runs from the paragraph');
  assert.match(page, /text-align:start/, 'no block alignment is declared');
});

test('the renderer takes the direction rather than assuming one', () => {
  // Arrange
  const generator = code('scripts/privacy/gen-web-pages.ts');

  // Assert — the signature, and one shared binding used by every emitter.
  assert.match(
    generator,
    /export function renderNotice\(markdown: string, dir: 'ltr' \| 'rtl' = 'ltr'\)/,
    'renderNotice has no direction parameter',
  );
  assert.match(generator, /const d = `dir="\$\{dir\}"`/, 'the attribute is not built once');
});

test('the default page is the Persian one, and it says so', () => {
  // Arrange — `/privacy` resolves to `index.html`, and a reader who followed a
  // Persian link must not land on English prose.
  const page = read(INDEX_PAGE);

  // Assert
  assert.match(page, /<html lang="fa" dir="rtl">/);
});

test('the in-app notice follows its document, not each string', () => {
  // Arrange — the same class of bug inside the app. `inheritDirection` is what
  // makes a block take the document's direction instead of inferring one from its
  // own content, and the viewer already opts every prose block into it.
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act — every `Text` that renders document prose.
  const proseTexts = (viewer.match(/<Text\b[\s\S]*?>/g) ?? []).filter(
    (tag) => !/align="center"/.test(tag),
  );

  // Assert
  assert.ok(proseTexts.length > 0, 'the viewer renders no prose');
  const missing = proseTexts.filter((tag) => !tag.includes('inheritDirection'));
  assert.equal(
    missing.length,
    0,
    `${missing.length} prose block(s) infer their direction from content, first: ${missing[0]}`,
  );
});
