/**
 * gate:secrets — no credential is written down in the source or the built
 * bundle.
 *
 * The rule matches the credential SHAPE, not the variable name. A gate that
 * matches `NESHAN_API_KEY` detects the harmless reference
 * `process.env.NESHAN_API_KEY` and misses the actual key — so a renamed,
 * inlined or concatenated credential walks straight through.
 *
 * The shape rules are ported from `scripts/spike/gate-secrets.sh`, which the
 * project already shipped with a self-test suite.
 */

import { join } from 'node:path';

import {
  PROJECT_ROOT,
  collectFiles,
  exists,
  fail,
  isTextSource,
  pass,
  readFile,
  relativePath,
} from './shared';
import { allowsOpaqueRun, isCredentialLine } from './credential-shapes';

const GATE = 'gate:secrets';

/**
 * The server-only variable NAMES.
 *
 * A reference to one of these is worth flagging in the source tree, because
 * a server-only variable must never be reachable from client code.
 */
const SECRET_NAMES = [
  'SUPABASE_SECRET_KEY',
  'service_role',
  'JWT_SECRET',
  'POSTGRES_PASSWORD',
  'NESHAN_API_KEY',
  'ORS_API_KEY',
  'AI_PROVIDER_KEY',
] as const;

const failures: string[] = [];

/** Reports a failure without echoing the matched value. */
function report(location: string, detail: string): void {
  failures.push(`${location} — ${detail}`);
}

// 1. The source tree: a credential value must never be written down.
for (const file of collectFiles(['src', 'app', 'server'])) {
  if (!isTextSource(file)) continue;

  const relative = relativePath(file);
  const content = readFile(file);

  content.split(/\r?\n/).forEach((line, index) => {
    const credential = isCredentialLine(line, { includeOpaqueRun: allowsOpaqueRun(file) });
    if (credential) {
      report(`${relative}:${index + 1}`, `looks like a ${credential.name}`);
    }
  });
}

// 2. A server-only variable name must not appear in client code.
for (const file of collectFiles(['src', 'app'])) {
  if (!isTextSource(file)) continue;

  const relative = relativePath(file);
  const content = readFile(file);

  for (const name of SECRET_NAMES) {
    if (content.includes(name)) {
      report(relative, `references the server secret \`${name}\``);
    }
  }
}

// 3. The built bundle, when one exists. A key can enter through a transitive
// dependency or a `.env` inlined by the bundler.
const distDir = join(PROJECT_ROOT, 'dist');
if (exists(distDir)) {
  for (const file of collectFiles(['dist'])) {
    if (!isTextSource(file)) continue;

    const relative = relativePath(file);
    const content = readFile(file);

    content.split(/\r?\n/).forEach((line, index) => {
      const credential = isCredentialLine(line, { includeOpaqueRun: allowsOpaqueRun(file) });
      if (credential) {
        report(`${relative}:${index + 1}`, `looks like a ${credential.name}`);
      }
    });
  }
}

// 4. `.env` must be gitignored.
const gitignorePath = join(PROJECT_ROOT, '.gitignore');
if (!exists(gitignorePath)) {
  failures.push('.gitignore is missing, so `.env` could be committed');
} else {
  const gitignore = readFile(gitignorePath);
  const ignoresEnv = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === '.env' || line === '.env.*' || line === '*.env');
  if (!ignoresEnv) {
    failures.push('.gitignore does not ignore `.env`');
  }
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, 'no credential in the source or the bundle; `.env` is gitignored');
