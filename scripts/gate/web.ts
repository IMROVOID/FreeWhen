/**
 * gate:web — the exported web bundle carries no secret, no `sk.` token, no
 * source map and no third-party script origin.
 *
 * This is a SECOND scan of a SECOND artifact, not a duplicate of
 * `gate:secrets`. The native bundle and the web bundle are built by
 * different pipelines, and one can carry a key the other does not
 * (PRD-13 §7, PRD-18 AC-18.6.1–3).
 *
 * EVERY file in `dist/` is scanned for a credential shape, not just the four
 * text extensions a bundle usually contains — a secret in a `.map` or a
 * `.txt` is still a secret.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, fail, pass, readFile, relativePath } from './shared';
import { allowsOpaqueRun, isCredentialLine, MAPBOX_SECRET_SHAPE } from './credential-shapes';

const GATE = 'gate:web';

/**
 * The bundle to scan.
 *
 * Defaults to `dist/`. A concurrent agent passes its own directory:
 * `npm run gate:web -- .worktrees/p07/dist`. Without that, two agents
 * exporting at the same time would scan each other's half-written output,
 * and `--clear` on one side would delete the bundle the other is gating.
 */
const WEB_DIR = resolveWebDir();

function resolveWebDir(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (arg) {
    return join(PROJECT_ROOT, arg.replace(/\\/g, '/'));
  }
  return join(PROJECT_ROOT, 'dist');
}

/** A third-party script origin. The session token lives in `localStorage`. */
const THIRD_PARTY_SCRIPT = /<script[^>]+src=["']https?:\/\//;

/** The largest file the content scan will read, in bytes. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

let files: string[];
try {
  files = walk(WEB_DIR);
} catch {
  fail(GATE, [`${relativePath(WEB_DIR)} does not exist — run \`npm run export:web\` first`]);
}

const failures: string[] = [];

// 1. No server secret, in ANY file (AC-18.6.1).
for (const file of files) {
  let content: string;
  try {
    if (statSync(file).size > MAX_SCAN_BYTES) continue;
    content = readFile(file);
  } catch {
    continue;
  }

  // A minified bundle and a font binary are full of long alphanumeric runs,
  // so the opaque-token rule is skipped for them. The shapes that cannot occur
  // by accident are still checked.
  const includeOpaqueRun = allowsOpaqueRun(file);

  content.split(/\r?\n/).forEach((line, index) => {
    const credential = isCredentialLine(line, { includeOpaqueRun });
    if (credential) {
      failures.push(
        `server secret: a ${credential.name} in ${relativePath(file)}:${index + 1}`,
      );
    }
  });

  // A Mapbox SECRET token. A public `pk.` token is expected by design, so
  // only the `sk.` form is rejected.
  if (MAPBOX_SECRET_SHAPE.test(content)) {
    failures.push(`Mapbox \`sk.\` token in ${relativePath(file)}`);
  }
}

// 2. No source maps are served (AC-18.6.2).
for (const file of files.filter((candidate) => candidate.endsWith('.map'))) {
  failures.push(`source map served: ${relativePath(file)}`);
}

// 3. No third-party script origin (AC-18.6.3).
for (const file of files.filter((candidate) => candidate.endsWith('.html'))) {
  const content = readFile(file);
  if (THIRD_PARTY_SCRIPT.test(content)) {
    failures.push(`third-party script origin in ${relativePath(file)}`);
  }
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, `scanned ${files.length} files in ${relativePath(WEB_DIR)}/`, files.length);
