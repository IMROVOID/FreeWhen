/**
 * A minimal markdown parser for the privacy notice (Plan 09 Task 9).
 *
 * ★ WHY NOT A MARKDOWN LIBRARY.
 *
 * The notice is the one document that must render offline, in both languages,
 * with no network and no new dependency (E10). A parser that handles the subset
 * the notice actually uses — headings, paragraphs, bullet lists, pipe tables,
 * bold, horizontal rules — is ~120 lines and testable without a renderer. A
 * general parser would add a runtime dependency to satisfy syntax the notice
 * never uses.
 *
 * The subset is deliberately narrow: anything unrecognised degrades to a
 * paragraph rather than disappearing, so a stray character cannot silently hide
 * a paragraph of a compliance document.
 */

export type NoticeBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

/** The `**bold**` / `__bold__` spans, split so a renderer can weight them. */
export interface Span {
  text: string;
  bold: boolean;
}

/** Splits a line into bold and plain spans. */
export function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ text: text.slice(cursor, match.index), bold: false });
    }
    spans.push({ text: match[1] ?? match[2] ?? '', bold: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), bold: false });
  }

  return spans.length > 0 ? spans : [{ text, bold: false }];
}

/** A table row's cells, without the leading and trailing pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** `|---|---|` and `| :-- | --: |` — the separator that makes a table a table. */
function isTableDivider(line: string): boolean {
  return /^\|?[\s:-]*-[\s:|-]*\|?$/.test(line.trim()) && line.includes('-');
}

/**
 * Parses the notice into blocks.
 *
 * Pure and side-effect free, so `tests/privacy/logs-audit.test.ts` can assert
 * the bundled notices parse into the expected structure — including that the
 * third-party table names every provider.
 */
export function parseNotice(markdown: string): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  const lines = markdown.split('\n');

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let table: string[][] | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };

  const flushBullets = (): void => {
    if (bullets.length === 0) return;
    blocks.push({ kind: 'bullet', items: bullets });
    bullets = [];
  };

  const flushTable = (): void => {
    if (!table || table.length === 0) {
      table = null;
      return;
    }
    // The divider row is dropped; the first row is the header.
    const [header, ...rows] = table;
    blocks.push({ kind: 'table', header: header ?? [], rows });
    table = null;
  };

  const flushAll = (): void => {
    flushParagraph();
    flushBullets();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // A blank line ends whatever block was open.
    if (line.trim() === '') {
      flushAll();
      continue;
    }

    // A table row continues a table, and nothing else may be open.
    if (line.trim().startsWith('|')) {
      flushParagraph();
      flushBullets();
      if (isTableDivider(line)) continue;

      table ??= [];
      table.push(splitRow(line));
      continue;
    }

    flushTable();

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      // A notice uses h1 and h2 only; deeper headings render as h2 rather than
      // vanishing, so no text is lost.
      blocks.push({ kind: 'heading', level: heading[1]!.length === 1 ? 1 : 2, text: heading[2]!.trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]!.trim());
      continue;
    }

    // A continuation line belongs to the open bullet or paragraph.
    if (bullets.length > 0 && /^\s{2,}/.test(raw)) {
      const last = bullets.length - 1;
      bullets[last] = `${bullets[last] ?? ''} ${line.trim()}`.trim();
      continue;
    }

    flushBullets();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}
