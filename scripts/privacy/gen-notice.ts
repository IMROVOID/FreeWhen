/**
 * Generates the bundled privacy-notice modules from `assets/privacy/*.md`.
 *
 * ★ WHY A GENERATOR AND NOT AN IMPORT.
 *
 * The notice must render with no network (E10) and in both languages
 * (PRD-08 §12). The natural expression is `import NOTICE_FA from
 * '@/assets/privacy/fa.md'` — but this project has no Metro/Babel markdown
 * loader, and a `.md` import would typecheck as a module while failing at
 * runtime with an unresolved module. Rather than add a bundler plugin (which
 * would put a build-tool concern in front of a platform requirement), the
 * markdown stays the human source of truth and this script emits a plain TS
 * string constant that every bundler already handles.
 *
 * The generated files are committed, so a checkout builds without running this.
 * `tests/privacy/logs-audit.test.ts` asserts the generated copy still matches
 * its markdown source, which is what keeps the two from drifting.
 *
 * Usage: `npm run gen:privacy-notice`
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../db/paths';

/** The languages the notice ships in. Both are bundled, always. */
const LANGUAGES = ['fa', 'en'] as const;

const SOURCE_DIR = join(PROJECT_ROOT, 'assets', 'privacy');
const OUTPUT_DIR = join(PROJECT_ROOT, 'src', 'features', 'privacy', 'content');

/** The module body for one language. */
function moduleFor(language: string, markdown: string): string {
  const name = `NOTICE_${language.toUpperCase()}`;

  return [
    `// GENERATED from assets/privacy/${language}.md by npm run gen:privacy-notice.`,
    '// Do not edit by hand — edit the markdown and regenerate.',
    '',
    `export const ${name} = ${JSON.stringify(markdown)};`,
    '',
  ].join('\n');
}

function generate(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const language of LANGUAGES) {
    const markdown = readFileSync(join(SOURCE_DIR, `${language}.md`), 'utf8');
    writeFileSync(join(OUTPUT_DIR, `notice-${language}.ts`), moduleFor(language, markdown), 'utf8');
    console.log(`gen:privacy-notice: notice-${language}.ts (${markdown.length} chars)`);
  }
}

generate();
