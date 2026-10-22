/**
 * The engine test runner.
 *
 * Usage:
 *   npm run test:engine                        — every engine suite
 *   npm run test:engine -- --adapter=straight-line
 *   npm run test:engine -- --adapter=neshan-matrix
 *   npm run test:engine -- --test-name-pattern="TC-18"
 *
 * ★ WHY THE `--adapter` FLAG EXISTS.
 *
 * AC-10.4.1 / AC-12.1.1: the engine suite must pass UNCHANGED when the
 * adapter is swapped. The engine never fetches — it reads already-resolved
 * measurements — so an adapter swap cannot change what it computes. The
 * flag makes that property TESTABLE rather than asserted: the same suite
 * runs against each adapter, and a test whose outcome depends on the
 * adapter fails the gate.
 *
 * The swap is expressed through the ENGINE'S OWN FIXTURE, because that is
 * the only place a measurement enters the engine. The engine module itself
 * is not touched — there is no adapter to swap inside it, and pretending
 * otherwise would test a code path the product does not have.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const TESTS_DIR = 'tests/engine';
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** The adapters the engine suite can be run against. */
const ADAPTERS = ['neshan-matrix', 'ors', 'straight-line'] as const;

/** The adapter in force for this run. */
function selectedAdapter(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith('--adapter=')) {
      const value = arg.slice('--adapter='.length);
      if (!(ADAPTERS as readonly string[]).includes(value)) {
        console.error(
          `Unknown adapter "${value}". Known adapters: ${ADAPTERS.join(', ')}`,
        );
        process.exit(1);
      }
      return value;
    }
  }
  return ADAPTERS[0];
}

function collectTestFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      found.push(...collectTestFiles(fullPath));
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry)) found.push(fullPath);
  }

  return found;
}

const argv = process.argv.slice(2);
const adapter = selectedAdapter(argv);

// The name-pattern flag is passed straight through to node's test runner.
const namePattern = argv
  .filter((arg) => arg.startsWith('--test-name-pattern='))
  .map((arg) => arg.slice('--test-name-pattern='.length));

// The adapter reaches the suites through the environment, so a suite can
// read it without the runner having to rewrite the test files.
process.env.FREEWHEN_TEST_ADAPTER = adapter;

const allFiles = collectTestFiles(TESTS_DIR);
const filters = argv.filter((arg) => !arg.startsWith('-'));

const selected = filters.length
  ? allFiles.filter((file) => {
      const normalised = relative(process.cwd(), file).split(sep).join('/');
      return filters.some((filter) => normalised.toLowerCase().includes(filter.toLowerCase()));
    })
  : allFiles;

if (selected.length === 0) {
  console.error(`No test files found matching "${filters.join(' ')}".`);
  console.error(`Known suites:\n${allFiles.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`Engine suite — adapter: ${adapter}`);
console.log(`Running ${selected.length} test file(s):`);
for (const file of selected) console.log(`  ${file}`);

const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--import',
    './tests/setup.ts',
    '--test',
    ...(namePattern.length ? [`--test-name-pattern=${namePattern.join('|')}`] : []),
    ...selected,
  ],
  { stdio: 'inherit', env: { ...process.env, FREEWHEN_TEST_ADAPTER: adapter } },
);

process.exit(result.status ?? 1);
