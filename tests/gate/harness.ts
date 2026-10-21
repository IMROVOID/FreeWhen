/**
 * The gate self-test harness.
 *
 * A gate that only ever reports "clean" is a gate nobody can trust. Each
 * case here asserts that a gate FAILS on a known-bad input, and that it PASSES
 * on a known-good one.
 *
 * The gates are run as child processes against the real repository, so what is
 * tested is exactly what runs in `npm run gate:all`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The repository root, resolved from this file's location. */
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

export interface GateResult {
  exitCode: number;
  output: string;
  /** Whether the gate reported success. */
  passed: boolean;
}

/**
 * Runs a gate script and returns its exit code and output.
 *
 * The gate is run with the repository as its working directory, so it sees
 * the real tree.
 */
export function runGate(script: string): GateResult {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join('scripts', 'gate', script)],
    { cwd: REPO_ROOT, encoding: 'utf8', shell: false },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    exitCode: result.status ?? 1,
    output,
    passed: result.status === 0,
  };
}

/**
 * Creates a temporary file inside a directory the gate scans, runs the gate,
 * and removes the file again.
 *
 * The file AND any directory created for it are always removed, even when the
 * assertion fails, so a failing test cannot leave the tree dirty — a
 * leftover empty `src/engine/` would change what `gate:engine-purity` does.
 */
export function withProbeFile(
  relativePath: string,
  content: string,
  run: () => GateResult,
): GateResult {
  const target = join(REPO_ROOT, relativePath);
  const parent = dirname(target);
  const parentExisted = existsSync(parent);

  if (!parentExisted) mkdirSync(parent, { recursive: true });
  writeFileSync(target, content, 'utf8');

  try {
    return run();
  } finally {
    try {
      unlinkSync(target);
    } catch {
      // The file was never created.
    }

    // Remove the directory if this test created it, and it is now empty.
    if (!parentExisted) {
      try {
        if (readdirSync(parent).length === 0) rmdirSync(parent);
      } catch {
        // The directory is not empty, or was already removed.
      }
    }
  }
}
