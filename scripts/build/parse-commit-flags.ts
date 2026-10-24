/**
 * Commit flags — `[fw:key=value]` tokens in a commit message or PR title.
 *
 * Usage:
 *   npx tsx scripts/build/parse-commit-flags.ts "[fw:apk] [fw:archs=arm64-v8a]"
 *   npx tsx scripts/build/parse-commit-flags.ts --self-test
 *
 * ★ FLAGS SET PARAMETERS. THEY NEVER TRIGGER A DEPLOY.
 *
 * A commit flag chooses an APK's ABIs, its release mode, its version and its
 * build mode. It cannot make a workflow publish or deploy anything: both of
 * those are `workflow_dispatch` only, because a push that silently reaches a
 * public host is a blast radius no flag should be able to open. The parser
 * therefore has no `publish` or `deploy-now` key, and a commit message
 * containing one gets a warning rather than an effect.
 *
 * ★ AN UNKNOWN KEY IS A WARNING, NOT A SILENT IGNORE.
 *
 * `[fw:archs=arm64-v8b]` is a typo whose failure mode is invisible: the
 * workflow falls back to the default and nobody learns the flag did nothing.
 * Every token the grammar does not recognise is collected into `warnings[]`
 * and printed, so the mistake surfaces in the run log rather than in a
 * release that shipped the wrong thing.
 *
 * ★ PARSED IN NODE, NEVER IN YAML.
 *
 * Commit messages arrive through `github.event.head_commit.message` and
 * `github.event.pull_request.title`, and both may contain `]`, quotes and
 * newlines. Interpolating either into a `run:` block is a shell-injection
 * surface; passing it through an `env:` var and parsing it here is not,
 * because nothing here ever reaches a shell.
 */

import { fileURLToPath } from 'node:url';

/** A `[fw:…]` token, anywhere in the text. */
const FLAG_PATTERN = /\[fw:([a-z0-9-]+)(?:=([^\]]*))?\]/g;

/** The flags that take no value. A value on one of them is a warning. */
const BOOLEAN_FLAGS = ['apk', 'universal', 'web'] as const;

/** The flags that require a value. */
const VALUE_FLAGS = ['archs', 'mode', 'release_mode', 'version', 'target'] as const;

/** Every key the grammar accepts, for the "did you mean" list in a warning. */
const KNOWN_KEYS: readonly string[] = [...BOOLEAN_FLAGS, ...VALUE_FLAGS];

/** The parsed result. Absent keys are `undefined`, never a default. */
export interface CommitFlags {
  /** `[fw:apk]` — build the APK pipeline at all. */
  apk?: boolean;
  /** `[fw:universal]` — also build the universal APK. */
  universal?: boolean;
  /** `[fw:web]` — build the static web export too. */
  web?: boolean;
  /** `[fw:archs=arm64-v8a,x86_64]` — the ABI list, already split. */
  archs?: string[];
  /** `[fw:mode=production]` — the build mode. */
  mode?: string;
  /** `[fw:release_mode=draft]` — draft or publish. */
  release_mode?: string;
  /** `[fw:version=1.2.3]` — the release version. */
  version?: string;
  /** `[fw:target=vps]` — the deploy target. */
  target?: string;
  /** Tokens the grammar did not recognise, or a value on a boolean flag. */
  warnings: string[];
}

/** Every flag this parser understands, for a caller that wants to print it. */
export const ACCEPTED_KEYS = KNOWN_KEYS;

/**
 * Reads `[fw:…]` tokens out of a commit message, a PR title, or any text.
 *
 * Returns only what was written: a caller merging this with repo variables is
 * the layer that decides precedence, and a default invented here would be
 * indistinguishable from a flag the author actually wrote.
 */
export function parseCommitFlags(text: string | null | undefined): CommitFlags {
  const flags: CommitFlags = { warnings: [] };
  if (!text) return flags;

  for (const match of text.matchAll(FLAG_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined) continue;

    if ((BOOLEAN_FLAGS as readonly string[]).includes(key)) {
      if (value !== undefined) {
        flags.warnings.push(`[fw:${key}] takes no value (got "${value}") — ignored the value`);
        continue;
      }
      flags[key as (typeof BOOLEAN_FLAGS)[number]] = true;
      continue;
    }

    if (!(VALUE_FLAGS as readonly string[]).includes(key)) {
      flags.warnings.push(
        `unknown flag [fw:${key}] — accepted keys are: ${KNOWN_KEYS.join(', ')}`,
      );
      continue;
    }

    if (value === undefined || value.trim() === '') {
      flags.warnings.push(`[fw:${key}] needs a value, e.g. [fw:${key}=…] — ignored`);
      continue;
    }

    const trimmed = value.trim();

    if (key === 'archs') {
      // Split here rather than at the call site: two call sites splitting a
      // comma list differently is how `arm64-v8a, x86` becomes one bogus ABI.
      const archs = trimmed
        .split(',')
        .map((arch) => arch.trim())
        .filter((arch) => arch !== '');
      if (archs.length === 0) {
        flags.warnings.push('[fw:archs] listed no architectures — ignored');
        continue;
      }
      flags.archs = archs;
      continue;
    }

    flags[key as Exclude<(typeof VALUE_FLAGS)[number], 'archs'>] = trimmed;
  }

  return flags;
}

/** A one-line summary for a run log. Never prints a secret — there are none here. */
export function summariseFlags(flags: CommitFlags): string {
  const parts = Object.entries(flags)
    .filter(([key]) => key !== 'warnings')
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`);

  if (parts.length === 0) return 'no commit flags';

  const warnings = flags.warnings.length > 0 ? ` (${flags.warnings.length} warning(s))` : '';
  return `${parts.join(' ')}${warnings}`;
}

/** The self-test. Every case here is a shape a real commit message produced. */
function selfTest(): number {
  const cases: Array<{ input: string; expect: (flags: CommitFlags) => string | null }> = [
    {
      input: '[fw:apk] [fw:archs=arm64-v8a]',
      expect: (f) =>
        f.apk === true && f.archs?.length === 1 && f.archs[0] === 'arm64-v8a'
          ? null
          : 'apk + single arch',
    },
    {
      input: 'feat: ship it [fw:apk] [fw:archs=arm64-v8a, x86_64] [fw:universal]',
      expect: (f) =>
        f.archs?.length === 2 && f.archs[1] === 'x86_64' && f.universal === true
          ? null
          : 'comma list is trimmed and split',
    },
    {
      input: '[fw:version=1.2.3]',
      expect: (f) => (f.version === '1.2.3' ? null : 'version value'),
    },
    {
      input: '[fw:apk]',
      expect: (f) => (f.warnings.length === 0 ? null : 'a clean message must not warn'),
    },
    {
      input: '',
      expect: (f) =>
        Object.keys(f).length === 1 && f.warnings.length === 0
          ? null
          : 'an empty message yields only the warnings array',
    },
    {
      input: '[fw:archs]',
      expect: (f) => (f.warnings.length === 1 && f.archs === undefined ? null : 'missing value'),
    },
    {
      input: '[fw:deploy]',
      expect: (f) =>
        f.warnings.length === 1 && f.warnings[0]?.includes('unknown flag')
          ? null
          : 'an unknown key warns rather than applying',
    },
    {
      input: '[fw:apk=1]',
      expect: (f) => (f.warnings.length === 1 && f.apk === undefined ? null : 'value on boolean'),
    },
    {
      input: '[FW:APK]',
      expect: (f) => (Object.keys(f).length === 1 ? null : 'the grammar is lowercase-only'),
    },
    {
      // A `]` inside the text after a token must not swallow the next token.
      input: '[fw:apk] see [important] note',
      expect: (f) => (f.apk === true && f.warnings.length === 0 ? null : 'stray brackets'),
    },
  ];

  let failed = 0;
  for (const { input, expect } of cases) {
    const flags = parseCommitFlags(input);
    const problem = expect(flags);
    if (problem) {
      failed += 1;
      process.stderr.write(`FAIL  ${JSON.stringify(input)} — ${problem}\n`);
      process.stderr.write(`      got ${JSON.stringify(flags)}\n`);
    }
  }

  if (failed > 0) {
    process.stderr.write(`\nparse-commit-flags self-test: ${failed} of ${cases.length} failed\n`);
    return 1;
  }

  process.stdout.write(`parse-commit-flags self-test: ${cases.length}/${cases.length} passed\n`);
  return 0;
}

/** The CLI: `"<text>"`, `--self-test`, or nothing (reads stdin). */
function main(argv: string[]): number {
  if (argv.includes('--self-test')) return selfTest();

  const text = argv.find((arg) => !arg.startsWith('-')) ?? '';
  const flags = parseCommitFlags(text);

  for (const warning of flags.warnings) process.stderr.write(`warning: ${warning}\n`);
  process.stdout.write(`${JSON.stringify(flags, null, 2)}\n`);

  // A warning is not a failure: the run must still be able to use the flags it
  // did understand. The summary is what a `::warning::` annotation consumes.
  process.stdout.write(`summary: ${summariseFlags(flags)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
