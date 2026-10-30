/**
 * The static privacy notice, rendered from the markdown source of truth.
 *
 * ★ ONE SOURCE, TWO SURFACES.
 *
 * `assets/privacy/{fa,en}.md` already produces the in-app notice via
 * `npm run gen:privacy-notice`. The web page the stores link to must say the
 * same thing — a second hand-written copy drifts on the first edit, and the
 * drift is invisible until a reviewer compares them. So this renders the same
 * markdown.
 *
 * ★ NO THIRD-PARTY SCRIPTS, NO FONTS FROM A CDN.
 *
 * The page sits on the same origin as the app, whose session token lives in
 * `localStorage`. A CSP of `default-src 'self'` is only honest if the page
 * actually loads nothing external, so the styling is inline and the type stack
 * is the system's (AC-18.6.3).
 *
 * Usage: `npm run gen:web-pages`
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../db/paths';

const SOURCE_DIR = join(PROJECT_ROOT, 'assets', 'privacy');
const OUT_DIR = join(PROJECT_ROOT, 'web', 'privacy');

/** Escapes text for HTML. The markdown is ours, but the rule is the rule. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `**bold**` → `<strong>`. The notice uses no other inline syntax. */
function inline(text: string): string {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Renders the notice's markdown subset.
 *
 * The subset is exactly what `assets/privacy/*.md` uses — headings, paragraphs,
 * bullet lists, pipe tables, horizontal rules. Anything unrecognised becomes a
 * paragraph rather than vanishing, so a stray character can never silently hide
 * a paragraph of a compliance document.
 *
 * ★ EVERY BLOCK CARRIES ITS DOCUMENT'S `dir`.
 *
 * `dir` is inherited, and the browser resolves bidi from the first strong
 * character of each RUN — which is right inside a run and wrong for a whole
 * block. A cell whose English text opens with a Persian venue or provider name
 * therefore laid that paragraph out right-to-left on an English page, reported as
 * "some of the English policy runs the wrong way". Each block states the
 * direction it belongs to, so its alignment and its paragraph direction are the
 * document's; per-run bidi is still the browser's job (see `unicode-bidi:
 * isolate` in the page shell).
 */
export function renderNotice(markdown: string, dir: 'ltr' | 'rtl' = 'ltr'): string {
  const out: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const d = `dir="${dir}"`;

  let index = 0;
  const isTableRow = (line: string) => /^\|.*\|$/.test(line.trim());
  const cells = (line: string) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();

    if (line === '') {
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      out.push('<hr />');
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      out.push(`<h${level} ${d}>${inline(heading[2] ?? '')}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (index < lines.length && isTableRow((lines[index] ?? '').trim())) {
        const row = cells(lines[index] ?? '');
        // The `|---|---|` separator is not data.
        if (!row.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(row);
        index += 1;
      }

      const [header, ...body] = rows;
      if (header) {
        out.push(`<table ${d}><thead><tr>`);
        for (const cell of header) out.push(`<th ${d}>${inline(cell)}</th>`);
        out.push('</tr></thead><tbody>');
        for (const row of body) {
          out.push('<tr>');
          for (const cell of row) out.push(`<td ${d}>${inline(cell)}</td>`);
          out.push('</tr>');
        }
        out.push('</tbody></table>');
      }
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      let current = '';
      while (index < lines.length) {
        const raw = lines[index] ?? '';
        const trimmed = raw.trim();

        if (/^-\s+/.test(trimmed)) {
          if (current) items.push(current);
          current = trimmed.replace(/^-\s+/, '');
          index += 1;
          continue;
        }

        // An indented continuation of the previous bullet.
        if (trimmed !== '' && /^\s{2,}/.test(raw) && !/^[-#|]/.test(trimmed)) {
          current += ` ${trimmed}`;
          index += 1;
          continue;
        }

        break;
      }
      if (current) items.push(current);

      out.push(`<ul ${d}>`);
      for (const item of items) out.push(`<li ${d}>${inline(item)}</li>`);
      out.push('</ul>');
      continue;
    }

    // A paragraph: consecutive non-blank, non-structural lines.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const trimmed = (lines[index] ?? '').trim();
      if (trimmed === '' || /^(#{1,3}\s|-{3,}$|-\s)/.test(trimmed) || isTableRow(trimmed)) break;
      paragraph.push(trimmed);
      index += 1;
    }
    out.push(`<p ${d}>${inline(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
}

/** The page shell. Both languages share it; only `dir`/`lang` and the body differ. */
function page(language: 'fa' | 'en', title: string, markdown: string): string {
  const dir = language === 'fa' ? 'rtl' : 'ltr';

  return `<!doctype html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="icon" href="/icons/favicon.ico" sizes="48x48" />
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />
<meta name="theme-color" content="#170E0A" />
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{
  margin:0;padding:2rem 1.25rem 4rem;
  font-size:16px;line-height:1.75;color:#15171c;background:#fbfbfc;
}
/* ★ THE TYPE STACK FOLLOWS THE DOCUMENT'S DIRECTION.

   It used to be one stack for both languages, with Vazirmatn — a Persian face —
   ahead of the generic fallback. On the ENGLISH page that meant every character
   the system stack could not cover was drawn in a Persian-reading design, and the
   notice read as a Persian document set in Latin. The Latin stack keeps Vazirmatn
   at the END, after the Latin-metric faces, so a stray Persian word still renders
   instead of falling through to a serif default. */
html[dir="ltr"] body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,Vazirmatn,Tahoma,sans-serif;
}
html[dir="rtl"] body{
  font-family:Vazirmatn,-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,sans-serif;
}
/* ★ NO BLOCK GUESSES ITS OWN PARAGRAPH DIRECTION.

   dir is inherited, and the browser resolves per-run bidi from the first strong
   character in each run — which is correct INSIDE a run and wrong for a whole
   block. A table cell whose English text begins with a Persian venue name was
   therefore laid out right-to-left on an English page: "some texts run the wrong
   way". Stating the block direction here (and on every block the renderer emits)
   pins the paragraph and leaves per-run bidi to the browser, which is the only
   place it belongs. */
main{max-width:44rem;margin:0 auto;text-align:start;unicode-bidi:isolate}
h1,h2,h3,p,li,th,td,direction-block{unicode-bidi:isolate;text-align:start}
h1{font-size:1.5rem;line-height:1.35;margin:0 0 1rem}
h2{font-size:1.125rem;margin:2rem 0 .5rem}
p,li{margin:0 0 .75rem}
ul{padding-inline-start:1.25rem}
hr{border:0;border-top:1px solid #e3e5ea;margin:2rem 0}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9375rem}
th,td{border:1px solid #e3e5ea;padding:.5rem .625rem;text-align:start;vertical-align:top}
th{background:#f2f3f6;font-weight:600}
strong{font-weight:600}
a{color:#2f5fd0}
@media (prefers-color-scheme:dark){
  body{color:#e7e9ee;background:#111318}
  hr,th,td{border-color:#2a2e37}
  th{background:#1b1f27}
  a{color:#8fb0f5}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main dir="${dir}">
${renderNotice(markdown, dir)}
</main>
</body>
</html>
`;
}

const TITLES = {
  fa: 'حریم خصوصی — FreeWhen',
  en: 'Privacy notice — FreeWhen',
} as const;

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const language of ['fa', 'en'] as const) {
    const markdown = readFileSync(join(SOURCE_DIR, `${language}.md`), 'utf8');
    writeFileSync(join(OUT_DIR, `${language}.html`), page(language, TITLES[language], markdown), 'utf8');
    console.log(`gen:web-pages: web/privacy/${language}.html`);
  }

  // `/privacy` resolves here, and the page picks the language from the URL's
  // previous choice where it can. A reader who followed a Persian link should
  // not land on English prose they cannot read.
  const fa = readFileSync(join(SOURCE_DIR, 'fa.md'), 'utf8');
  writeFileSync(join(OUT_DIR, 'index.html'), page('fa', TITLES.fa, fa), 'utf8');
  console.log('gen:web-pages: web/privacy/index.html');
}

main();
