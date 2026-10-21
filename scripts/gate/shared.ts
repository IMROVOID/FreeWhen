/**
 * Shared helpers for the release gates.
 *
 * Every gate exits non-zero with a NAMED failure (Plan 01, Task 7).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The project root, derived from this file's location rather than
 * `process.cwd()`.
 *
 * A gate that resolves its paths against the working directory scans a
 * DIFFERENT tree when it is run from a subdirectory — and `gate:location` and
 * `gate:engine-purity` then report "clean" having scanned nothing. A green
 * gate that scanned nothing is a false all-clear.
 */
function findProjectRoot(startDir: string): string {
  let dir = startDir;

  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export const PROJECT_ROOT = findProjectRoot(dirname(fileURLToPath(import.meta.url)));

/** The directories the gates scan. */
export const SOURCE_DIRS = ['src', 'app', 'server', 'scripts'] as const;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.expo', 'android', 'ios', 'coverage']);

/** Every file under the given directories, recursively. */
export function collectFiles(dirs: readonly string[] = SOURCE_DIRS): string[] {
  const found: string[] = [];

  for (const dir of dirs) {
    const root = join(PROJECT_ROOT, dir);
    if (!exists(root)) continue;
    walk(root, found);
  }

  return found;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
}

export function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}

/** A path relative to the project root, with forward slashes. */
export function relativePath(path: string): string {
  return relative(PROJECT_ROOT, path).split(sep).join('/');
}

/** The files whose extension is worth scanning as text. */
export function isTextSource(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|html|css|map)$/.test(path);
}

/**
 * Prints the failures and exits non-zero. Every gate uses this, so a failure
 * always names itself.
 */
export function fail(gateName: string, failures: readonly string[]): never {
  console.error(`${gateName} FAILED`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

/**
 * Prints the success line and exits zero.
 *
 * `scannedCount` is the number of files the gate actually inspected. A gate
 * that scanned nothing must FAIL, not pass — "clean" and "did not look" are
 * different outcomes, and only one of them is a green light.
 */
export function pass(gateName: string, detail?: string, scannedCount?: number): never {
  if (scannedCount === 0) {
    fail(gateName, ['scanned 0 files — a gate that inspected nothing cannot pass']);
  }
  console.log(detail ? `${gateName}: ${detail}` : `${gateName}: clean`);
  process.exit(0);
}
