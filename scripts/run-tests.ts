/**
 * The test runner.
 *
 * Usage:
 *   npm run test                 — every suite
 *   npm run test -- jalali       — only suites whose path matches "jalali"
 *   npm run test -- redact routing
 *
 * Node's built-in test runner is used, with `tsx` loading the TypeScript
 * sources. No Jest install is needed for the Phase 1 suites (PRD-12 §4).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const TESTS_DIR = 'tests';
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

function collectTestFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      found.push(...collectTestFiles(fullPath));
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry)) {
      found.push(fullPath);
    }
  }

  return found;
}

const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const allFiles = collectTestFiles(TESTS_DIR);

const selected = filters.length
  ? allFiles.filter((file) => {
      const normalised = relative(process.cwd(), file).split(sep).join('/');
      return filters.some((filter) => normalised.toLowerCase().includes(filter.toLowerCase()));
    })
  : allFiles;

if (selected.length === 0) {
  const label = filters.length ? `matching "${filters.join(' ')}"` : 'any';
  console.error(`No test files found ${label}.`);
  console.error(`Known suites:\n${allFiles.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`Running ${selected.length} test file(s):`);
for (const file of selected) {
  console.log(`  ${file}`);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--import', './tests/setup.ts', '--test', ...selected],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
