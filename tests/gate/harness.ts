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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
 * the real tree, unless `root` overrides PROBE ROOT resolution.
 */
export function runGate(script: string, root?: string): GateResult {
  const args = ['--import', 'tsx', join('scripts', 'gate', script)];
  if (root) args.push('--root', root);

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    exitCode: result.status ?? 1,
    output,
    passed: result.status === 0,
  };
}

/** A per-call counter, so two concurrent suites never choose the same path. */
let probeSequence = 0;

/**
 * Puts the probe under `.probe/`, which the gates do NOT scan.
 *
 * ★ A PROBE MUST BE INVISIBLE TO EVERY SCAN BUT ITS OWN.
 *
 * `npm test` runs one process per file, all in parallel. `self-test` writes a
 * file containing exactly the sensitive key a gate looks for, then runs that
 * gate; a second scan starting in the same window sees the file, and the
 * failure is reported against the gate rather than against the probe. That is
 * not hypothetical — it is why `gate:all` failed intermittently and why the
 * first fix (a unique name inside `src/`) was not enough: a unique name makes
 * the probe VISIBLY foreign, not invisible.
 *
 * So the probe lives OUTSIDE every scanned directory, and each gate is invoked
 * with `--root` pointing at it. The gate then scans exactly the tree the test
 * intended it to scan, and no concurrent run can see it at all.
 */
export const PROBE_ROOT = join(REPO_ROOT, '.probe');

/**
 * The files a gate READS rather than scans.
 *
 * A gate run against the probe root must still find the real `app.json`,
 * catalogues and `src/lib/redact.ts`, or it fails for a reason the test did not
 * intend. These are copied from the repository on demand, synchronously and
 * idempotently, so the probe tree is a complete-enough tree for every gate.
 */
const BASE_FILES = [
  'app.json',
  'package.json',
  '.gitignore',
  'src/lib/redact.ts',
  'src/i18n/fa.json',
  'src/i18n/en.json',
] as const;

/** The directories the probe tree needs to exist, so a copy has a parent. */
const BASE_DIRS = ['src', 'src/lib', 'src/i18n', 'src/features', 'app', 'server'] as const;

function ensureProbeTree(): void {
  for (const dir of BASE_DIRS) {
    mkdirSync(join(PROBE_ROOT, dir), { recursive: true });
  }

  for (const relative of BASE_FILES) {
    const source = join(REPO_ROOT, relative);
    if (!existsSync(source)) continue;

    const target = join(PROBE_ROOT, relative);
    mkdirSync(dirname(target), { recursive: true });

    // COPIED ONLY WHEN ABSENT, never over an existing file: a case that edits
    // the probe catalogue before calling the gate must not have its edit
    // reverted by this function. The tree is deleted by the suite's teardown.
    if (!existsSync(target)) copyFileSync(source, target);
  }

  // `gate:web` scans `dist/`; a probe tree with no export would fail with
  // "dist/ does not exist" rather than reporting what it found.
  const dist = join(PROBE_ROOT, 'dist');
  mkdirSync(dist, { recursive: true });

  for (const page of ['index.html', '_sitemap.html']) {
    const target = join(dist, page);
    if (existsSync(target)) continue;
    writeFileSync(
      target,
      '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8" /></head><body></body></html>\n',
      'utf8',
    );
  }
}

/**
 * Runs a gate against the probe tree.
 *
 * ★ THE ROOT OVERRIDE IS WHAT MAKES THE ASSERTION TRUE.
 *
 * Without it the gate scans the real repository and the probe is a no-op that
 * always passes. With it the gate sees exactly one tree: the probe's.
 */
/**
 * Rewrites a probe path so it sits under `.probe/`.
 *
 * `src/engine/__gate_probe__.ts` becomes `.probe/src/engine/__gate_probe__.ts`:
 * the original relative path is preserved underneath, so a gate's own
 * directory rules (`src/engine/`, catalogues, `app/`) still apply to it.
 */
function probePath(relativePath: string): string {
  probeSequence += 1;
  const unique = relativePath.replace(
    '__gate_probe__',
    `__gate_probe_${process.pid}_${probeSequence}__`,
  );
  return join(PROBE_ROOT, unique);
}

/**
 * Runs a gate against the probe tree.
 *
 * The root override is what makes the assertion true: without it the gate would
 * scan the real repository and the probe would be a no-op that always passes.
 */
export function runGateOnProbe(script: string): GateResult {
  ensureProbeTree();
  return runGate(script, PROBE_ROOT);
}

/**
 * Removes the probe tree. Called once, when the suite has finished.
 *
 * The tree is a real directory inside the repo so the gates can walk it, which
 * means it also has to be deleted — a leftover `.probe/` would be a second
 * checkout of `app.json` and the catalogues sitting in the working tree.
 */
export function removeProbeTree(): void {
  try {
    rmSync(PROBE_ROOT, { recursive: true, force: true });
  } catch {
    // A Windows handle can survive the last read; the tree is disposable.
  }
}

/**
 * Proves the PROBE TREE is complete before a "passes on a clean tree" case is
 * allowed to assert.
 *
 * ★ A MISSING VALUE IS NOT A CLEAN VALUE.
 *
 * `.probe/` starts empty. `gate:secrets` requires a `.gitignore` that ignores
 * `.env`, and `gate:web` requires a `dist/`. The real tree has both, so the
 * probe tree must too — otherwise those two gates fail for a reason that has
 * nothing to do with the case, and a "passes on a clean tree" assertion
 * reports a real failure as a false alarm.
 *
 * Returns the names of the missing inputs, so a caller can assert on them.
 */
export function probeTreeMissing(): string[] {
  ensureProbeTree();

  const required = ['.gitignore', 'dist/index.html', 'dist/_sitemap.html'] as const;
  return required.filter((relative) => !existsSync(join(PROBE_ROOT, relative)));
}

/**
 * Runs `fn` with a probe file present, and removes it again.
 *
 * The file AND any directory created for it are always removed, even when the
 * assertion fails, so a failing test cannot leave the tree dirty.
 */
export function withProbeFile(
  relativePath: string,
  content: string,
  run: () => GateResult,
): GateResult {
  const target = probePath(relativePath);
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
