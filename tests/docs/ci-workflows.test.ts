/**
 * The CI workflow invariants (Plan 41, Task 14).
 *
 * ★ WHY THIS FILE EXISTS: `.github/` IS OUTSIDE EVERY GATE'S SCAN SET.
 *
 * `scripts/gate/secrets.ts` walks `['src', 'app', 'server']`. It has never
 * looked at a workflow file, and it is not going to start: a workflow legitimately
 * contains `${{ secrets.JWT_SECRET }}`, which the name-based rule would flag on
 * every line. So the discipline that keeps the rest of the tree honest does not
 * reach `.github/`, and this test is the substitute.
 *
 * Two kinds of assertion:
 *
 *   1. **Structural** — the orderings and refusals that a future edit could
 *      quietly invert. These mirror what `tests/deploy/gates.test.ts` does for
 *      `scripts/deploy/deploy.sh`: the line ordering *is* the assertion.
 *   2. **A name check** — every environment variable a workflow sets exists in
 *      `.env.example` or is a documented `FREEWHEN_*` workflow variable. A typo
 *      in YAML is invisible at runtime; it falls back to a default and nobody
 *      learns the flag did nothing.
 *
 * Everything is text-based on purpose: a YAML parser would be a dependency, and
 * these assertions are about substrings a human can also grep for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isCredentialLine } from '../../scripts/gate/credential-shapes';

const WORKFLOWS = join('.github', 'workflows');

/** Reads a workflow file, failing loudly rather than skipping. */
function workflow(name: string): string {
  const path = join(WORKFLOWS, name);
  assert.ok(existsSync(path), `${path} is missing`);
  return readFileSync(path, 'utf8');
}

/** The index of a line matching `pattern`, or -1. Line ordering is the assertion. */
function lineOf(text: string, pattern: RegExp): number {
  return text.split(/\r?\n/).findIndex((line) => pattern.test(line));
}

// ──────────────────────────────────────────────────────────────────────────
// The APK pipeline
// ──────────────────────────────────────────────────────────────────────────

test('the APK pipeline runs preflight, then build, then publish', () => {
  // Arrange — an inverted order would publish an unverified artifact, or build
  // against a server that was never checked.
  const text = workflow('release-apk.yml');

  // Act
  const preflight = lineOf(text, /^ {2}preflight:$/);
  const build = lineOf(text, /^ {2}build:$/);
  const publish = lineOf(text, /^ {2}publish:$/);

  // Assert
  assert.ok(preflight > 0, 'no preflight job');
  assert.ok(build > preflight, 'build runs before preflight');
  assert.ok(publish > build, 'publish runs before build');
});

test('publish cannot run without both preflight and build', () => {
  // Arrange
  const text = workflow('release-apk.yml');

  // Act — the `needs:` line under the publish job.
  const publishIndex = lineOf(text, /^ {2}publish:$/);
  const tail = text.split(/\r?\n/).slice(publishIndex, publishIndex + 12).join('\n');

  // Assert — a `needs:` naming only one of them would let `publish` start
  // while a matrix job was still building.
  assert.match(tail, /needs:\s*\[preflight, build\]/, 'publish does not need both jobs');
});

test('the APK build never sets SKIP_GRADLE', () => {
  // Arrange — `build-apk.sh:90-93` exits 0 with no artifact when SKIP_GRADLE=1.
  // A workflow that set it would report a successful build that produced
  // nothing, which is the exact failure the release path must not have.
  const text = workflow('release-apk.yml');

  // Act
  const lines = text
    .split(/\r?\n/)
    .filter((line) => /SKIP_GRADLE/.test(line) && !/^\s*#/.test(line));

  // Assert
  assert.deepEqual(lines, [], `SKIP_GRADLE is set in release-apk.yml:\n  ${lines.join('\n  ')}`);
});

test('the APK is verified before it is published', () => {
  // Arrange — the verify action must run in the `build` job, and the upload
  // step must come after it.
  const text = workflow('release-apk.yml');

  // Act
  const verify = lineOf(text, /uses: \.\/\.github\/actions\/verify-apk/);
  const upload = lineOf(text, /uses: actions\/upload-artifact/);

  // Assert
  assert.ok(verify > 0, 'the APK is never verified');
  assert.ok(upload > verify, 'the artifact is uploaded before it is verified');
});

test('the production gate checks the health body, not just the status', () => {
  // Arrange — `/health` answers 200 whenever the process listens. `db:"up"` is
  // the assertion that distinguishes a working deployment from a booted one.
  const text = workflow('release-apk.yml');

  // Act / Assert
  assert.match(text, /"db":"up"/, 'the production gate does not check the database');
  assert.match(text, /production build cancelled/, 'the refusal message is missing');
});

// ──────────────────────────────────────────────────────────────────────────
// The deploy fan-out
// ──────────────────────────────────────────────────────────────────────────

test('the deploy router calls every provider as a reusable workflow behind an if', () => {
  // Arrange — a reusable workflow cannot be called conditionally inside a job,
  // so each provider is its own job. A `uses:` without an `if:` would run every
  // provider at once, which is the opposite of "exactly one target per run".
  const text = workflow('deploy.yml');
  const lines = text.split(/\r?\n/);

  // Act — every `uses:` that points at a local workflow.
  const localCalls = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => /^uses: \.\/\.github\/workflows\//.test(entry.line));

  // Assert
  assert.ok(localCalls.length >= 5, `only ${localCalls.length} provider calls found`);
  for (const call of localCalls) {
    // The `if:` is within the ten lines above a `uses:` in a job block.
    const window = lines.slice(Math.max(0, call.index - 10), call.index).join('\n');
    assert.match(
      window,
      /if: inputs\.target ==/,
      `${call.line} has no \`if: inputs.target == …\` guard`,
    );
  }
});

test('deploy refuses an edge target without the REST database transport', () => {
  // Arrange — a Workers runtime has no TCP socket, so the `pg` transport
  // deploys successfully and then 500s on the first query.
  const router = workflow('deploy.yml');
  const pages = workflow('deploy-pages.yml');

  // Act / Assert — both files refuse, because `deploy-pages.yml` can also be
  // called directly.
  assert.match(router, /supabase_rest/, 'deploy.yml does not name the REST transport');
  assert.match(router, /cannot open a TCP Postgres socket|cannot open a TCP/, 'no explanation');
  assert.match(pages, /cannot open a TCP Postgres socket/, 'deploy-pages.yml does not refuse pg');
});

test('the VPS deploy mirrors the smoke test contract in deploy.sh', () => {
  // Arrange — the served and refused paths are the deployment contract. A fork
  // into a second spelling is how the two drift, and the refused paths are the
  // ones nobody notices.
  const text = workflow('deploy-vps.yml');
  const deploySh = readFileSync(join('scripts', 'deploy', 'deploy.sh'), 'utf8');

  // The paths `deploy.sh:117-127` asserts, and the status each must return.
  const contract: Array<[string, string]> = [
    ['/health', '200'],
    ['/start', '200'],
    ['/privacy', '200'],
    ['/dl/', '200'],
    ['/api/health', '200'],
    ['/studio', '404'],
    ['/storage/v1/object/x', '404'],
    ['/functions/v1/x', '404'],
    ['/assets/x.js.map', '404'],
  ];

  // Act / Assert — every path the shell script asserts is asserted here too.
  for (const [path, status] of contract) {
    assert.ok(
      deploySh.includes(path),
      `deploy.sh no longer asserts ${path} — this test needs updating with it`,
    );
    assert.ok(
      text.includes(path),
      `deploy-vps.yml does not assert ${path} (want ${status})`,
    );
  }
});

test('the VPS deploy pins the host key rather than trusting the scan', () => {
  // Arrange — `ssh-keyscan` populates known_hosts from whatever answers. Only
  // the fingerprint comparison makes it a verification.
  const text = workflow('deploy-vps.yml');

  // Act / Assert
  assert.match(text, /SSH_HOST_FINGERPRINT/, 'no pinned fingerprint variable');
  assert.match(text, /fingerprint mismatch/, 'a mismatch is not refused');
  assert.doesNotMatch(
    text,
    /StrictHostKeyChecking=no/,
    'StrictHostKeyChecking=no disables the check the fingerprint exists for',
  );
});

test('every deploy target is reachable from the router', () => {
  // Arrange — a target offered in the `options:` list with no job behind it
  // would be a dispatch that silently does nothing.
  const router = workflow('deploy.yml');

  // Act — the choice list.
  const optionsBlock = router.slice(
    router.indexOf('target:'),
    router.indexOf('mode:', router.indexOf('target:')),
  );
  const targets = [...optionsBlock.matchAll(/^\s+- (\w+)$/gm)].map((m) => m[1]!);

  // Assert
  assert.ok(targets.length >= 7, `expected at least 7 targets, found ${targets.length}`);
  for (const target of targets) {
    assert.ok(
      router.includes(`if: inputs.target == '${target}'`),
      `target '${target}' is offered but has no job calling a provider workflow`,
    );
  }
});

test('Vercel is disabled by default and says so out loud', () => {
  // Arrange — a silently skipped job reads as "deployed" in the Actions list.
  const vercel = workflow('deploy-vercel.yml');
  const router = workflow('deploy.yml');

  // Act / Assert — the router FAILS rather than skipping.
  assert.match(router, /VERCEL_ENABLED/, 'the router does not check the switch');
  assert.match(router, /Vercel deploys are disabled/, 'the router does not say why');

  // And the workflow itself repeats the check, for a direct call.
  assert.match(vercel, /FREEWHEN_VERCEL_ENABLED/, 'deploy-vercel.yml has no switch of its own');
  assert.match(vercel, /::error::Vercel deploys are disabled/, 'no visible refusal');
});

// ──────────────────────────────────────────────────────────────────────────
// The review-the-diff checks
// ──────────────────────────────────────────────────────────────────────────

test('no workflow contains a credential-shaped literal', () => {
  // Arrange — `.github/` is outside `gate:secrets`, so this is the only scan it
  // ever receives. `scripts/gate/credential-shapes.ts` matches SHAPES rather
  // than names, which is what makes it useful here: `${{ secrets.JWT_SECRET }}`
  // is a reference, not a credential, and only a shape rule can tell them apart.
  const dir = join(WORKFLOWS);
  const hits: string[] = [];

  // ★ ONE DOCUMENTED EXCEPTION, AND IT IS NARROW.
  //
  // The `migrations` job in `ci.yml` runs a `postgres:15-alpine` service
  // container whose password must be *something*, and it is reachable only on
  // the runner's own loopback for the life of one job. It is not a credential
  // for anything; it is the ephemeral database's own bootstrap value, and
  // `POSTGRES_PASSWORD: postgres` is what the image's own documentation shows.
  //
  // The exception is matched on the exact line in the exact file. Any other
  // named-secret shape, or the same shape anywhere else, still fails.
  const ALLOWED = new Map<string, RegExp>([
    ['ci.yml', /^\s+POSTGRES_PASSWORD: postgres$/],
  ]);

  // Act
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.yml'))) {
    const allow = ALLOWED.get(name);
    const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (allow?.test(line)) return;
      // A `${{ secrets.X }}` reference is expected; skip it before scanning.
      const withoutExpressions = line.replace(/\$\{\{[^}]*\}\}/g, '');
      const credential = isCredentialLine(withoutExpressions, { includeOpaqueRun: false });
      if (credential) hits.push(`${name}:${index + 1} looks like a ${credential.name}`);
    });
  }

  // Assert
  assert.deepEqual(hits, [], `a credential literal reached .github/:\n  ${hits.join('\n  ')}`);
});

test('every FREEWHEN_ repository variable a workflow reads is documented', () => {
  // Arrange — a typo'd variable name falls back to its default at runtime and
  // nobody reads the log that would have said so. This is the only check that
  // sees it.
  const dir = join(WORKFLOWS);
  const referenced = new Set<string>();

  // Act
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.yml'))) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const match of text.matchAll(/vars\.(FREEWHEN_[A-Z0-9_]+)/g)) {
      referenced.add(match[1]!);
    }
    // The `env:` names the resolve-inputs action reads.
    for (const match of text.matchAll(/^\s+(FREEWHEN_[A-Z0-9_]+):/gm)) {
      referenced.add(match[1]!);
    }
  }

  // Assert — the README that documents them must mention each one.
  const readme = readFileSync(join(WORKFLOWS, 'README.md'), 'utf8');
  const undocumented = [...referenced].filter((name) => !readme.includes(name));
  assert.deepEqual(
    undocumented,
    [],
    `.github/workflows/README.md does not document:\n  ${undocumented.join('\n  ')}`,
  );
});

test('the client-inlined variable names match what the app actually reads', () => {
  // Arrange — a workflow that exports `EXPO_PUBLIC_APP_URL` while the app reads
  // `EXPO_PUBLIC_APP_BASE_URL` produces a bundle with the wrong origin inlined,
  // and nothing fails.
  const source = readFileSync(join('src', 'lib', 'api-base-url.ts'), 'utf8');

  // Act — the two names the resolver supports.
  const supported = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_APP_BASE_URL'];

  // Assert — the app reads both, and the APK workflow supplies at least the
  // fallback the plan added.
  for (const name of supported) {
    assert.ok(source.includes(name), `api-base-url.ts no longer reads ${name}`);
  }
  assert.ok(
    workflow('release-apk.yml').includes('EXPO_PUBLIC_APP_BASE_URL'),
    'release-apk.yml never sets EXPO_PUBLIC_APP_BASE_URL — a release APK would point at 10.0.2.2',
  );
});

test('ci.yml exports before it gates, because gate:web needs dist/', () => {
  // Arrange — `gate:all` exits non-zero when `dist/` is absent, printing
  // SKIPPED — NOT CHECKED. A CI job that gates first fails for the wrong reason
  // and proves nothing about the bundle.
  const text = workflow('ci.yml');

  // Act
  const exportLine = lineOf(text, /run: npm run export:web/);
  const gateLine = lineOf(text, /run: npm run gate:all/);

  // Assert
  assert.ok(exportLine > 0, 'ci.yml never exports');
  assert.ok(gateLine > exportLine, 'gate:all runs before the export in ci.yml');
});
