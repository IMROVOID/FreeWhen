/**
 * The project root, resolved from a file's location rather than
 * `process.cwd()`.
 *
 * A script that resolves its paths against the working directory reads a
 * DIFFERENT tree when run from a subdirectory. The release gates already
 * solved this (scripts/gate/shared.ts); the DB scripts use the same rule so
 * a migration never applies to the wrong database by accident.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
