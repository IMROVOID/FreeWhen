/**
 * gate:design — no hardcoded colour, radius, spacing, duration or font name
 * in `app/**` or `src/**` (Style Guide §0, §15, PRD-10 D18).
 *
 * The token files are the only place a value like this may appear. The gate
 * excludes them, and excludes the theme module, so the tokens themselves are
 * not flagged.
 */

import { collectFiles, fail, isTextSource, pass, readFile, relativePath } from './shared';

const GATE = 'gate:design';

/** The files that are ALLOWED to hold literal values. */
const ALLOWED_FILES = [
  'src/theme/tokens.ts',
  'src/theme/motion.ts',
  'src/theme/fonts.ts',
];

const failures: string[] = [];

/** A hex colour: `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

/** An `rgb()` / `rgba()` / `hsl()` colour function. */
const COLOUR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;

/** A millisecond duration literal. */
const DURATION_LITERAL = /\b\d{2,4}\s*ms\b/;

/** A hardcoded font family name. */
const FONT_NAME = /['"](?:Vazirmatn|PlusJakarta)[A-Za-z0-9_-]*['"]/;

/** The token names that make a value a design token rather than a literal. */
const TOKEN_PROPERTY = /\b(?:bg|surface\d?|line|text|textMuted|textFaint|primary|onPrimary|brand|onBrand|danger|onDanger|success|warning|info)\b/;

for (const file of collectFiles(['src', 'app'])) {
  if (!isTextSource(file)) continue;

  const relative = relativePath(file);
  if (ALLOWED_FILES.includes(relative)) continue;

  const content = readFile(file);
  const lines = content.split(/\r?\n/);

  // Track whether the current line is inside a block comment.
  let inBlockComment = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // A comment may quote the token's own value; that is documentation, not
    // a hardcoded literal.
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    const location = `${relative}:${index + 1}`;

    if (HEX_COLOUR.test(line) || COLOUR_FUNCTION.test(line)) {
      failures.push(`${location} hardcodes a colour — read it from the theme tokens`);
    }

    if (DURATION_LITERAL.test(line)) {
      failures.push(`${location} hardcodes a duration — read it from \`src/theme/motion.ts\``);
    }

    if (FONT_NAME.test(line)) {
      failures.push(`${location} hardcodes a font name — read it from \`src/theme/fonts.ts\``);
    }

    // A numeric radius or spacing literal in a style object. Zero is the
    // absence of a value, not a hardcoded one.
    if (
      /(?:borderRadius|padding|margin|gap|width|height)\s*:\s*(\d+)/.test(line) &&
      !TOKEN_PROPERTY.test(line)
    ) {
      const literal = Number(line.match(/(?:borderRadius|padding|margin|gap|width|height)\s*:\s*(\d+)/)?.[1]);
      if (literal !== 0) {
        failures.push(`${location} hardcodes a spacing or radius value — read it from the tokens`);
      }
    }
  });
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, 'no hardcoded colour, radius, spacing, duration or font name');
