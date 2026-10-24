/**
 * The CI workflow invariants.
 *
 * ★ WHY THIS FILE EXISTS: `.github/` IS OUTSIDE EVERY GATE'S SCAN SET.
 *
 * `scripts/gate/secrets.ts` walks `['src', 'app', 'server']`. It has never
 * looked at a workflow file, and it is not going to start: a workflow
 * legitimately contains `${{ secrets.JWT_SECRET }}`, which the name-based rule
 * would flag on every line. So the discipline that keeps the rest of the tree
 * honest does not reach `.github/`, and this test is the substitute.
 *
 * Three kinds of assertion:
 *
 *   1. **Structural** — the orderings and refusals a future edit could quietly
 *      invert. These mirror what `tests/deploy/gates.test.ts` does for
 *      `scripts/deploy/deploy.sh`: the line ordering IS the assertion.
 *   2. **Name checks** — every config key a workflow reads is documented, and
 *      every `FREEWHEN_*` variable a workflow references exists in the README.
 *      A typo in YAML is invisible at runtime; it falls back to a default and
 *      nobody learns the flag did nothing.
 *   3. **Regression pins** — the specific defects a live deploy exposed, so they
 *      cannot come back. Vercel's `/start` swallowing its own rewrite, Netlify's
 *      301, Cloudflare's missing account, the `FlyV1 ` space.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isCredentialLine } from '../../scripts/gate/credential-shapes';

const WORKFLOWS = join('.github', 'workflows');
const SCRIPTS = join('.github', 'scripts');

/** Reads a workflow file, failing loudly rather than skipping. */
function workflow(name: string): string {
  const path = join(WORKFLOWS, name);
  assert.ok(existsSync(path), `${path} is missing`);
  return readFileSync(path, 'utf8');
}

/** Reads a helper script. */
function script(name: string): string {
  const path = join(SCRIPTS, name);
  assert.ok(existsSync(path), `${path} is missing`);
  return readFileSync(path, 'utf8');
}

/** The index of a line matching `pattern`, or -1. Line ordering is the assertion. */
function lineOf(text: string, pattern: RegExp): number {
  // Comment lines are skipped: a comment naming the check it explains would
  // otherwise sort ahead of the code it describes and make an ordering
  // assertion pass for the wrong reason.
  return text
    .split(/\r?\n/)
    .findIndex((line) => !/^\s*#/.test(line) && pattern.test(line));
}

// ──────────────────────────────────────────────────────────────────────────
// The APK pipeline
// ──────────────────────────────────────────────────────────────────────────

test('the APK pipeline guards, resolves, preflights, builds, then publishes', () => {
  // Arrange — an inverted order publishes an unverified artifact, or builds
  // without knowing which ABIs were asked for.
  const text = workflow('release-apk.yml');

  // Act
  const guard = lineOf(text, /^ {2}guard:$/);
  const resolve = lineOf(text, /^ {2}resolve:$/);
  const preflight = lineOf(text, /^ {2}preflight:$/);
  const build = lineOf(text, /^ {2}build:$/);
  const release = lineOf(text, /^ {2}release:$/);

  // Assert
  for (const [name, index] of [
    ['guard', guard],
    ['resolve', resolve],
    ['preflight', preflight],
    ['build', build],
    ['release', release],
  ] as const) {
    assert.ok(index > 0, `no ${name} job`);
  }
  assert.ok(guard < resolve, 'resolve runs before guard');
  assert.ok(resolve < preflight, 'preflight runs before resolve');
  assert.ok(preflight < build, 'build runs before preflight');
  assert.ok(build < release, 'release runs before build');
});

test('the APK pipeline reads its knobs from the shared resolver', () => {
  // Arrange — re-deriving the precedence chain per workflow is how the order
  // drifts between two files that must agree.
  const text = workflow('release-apk.yml');

  // Act / Assert
  assert.match(text, /uses: \.\/\.github\/workflows\/_resolve-config\.yml/, 'release-apk.yml does not use the resolver');
  assert.doesNotMatch(
    text,
    /^\s+VAR_ARCHS:/m,
    'release-apk.yml re-derives the precedence chain instead of using the resolver',
  );
});

test('the APK build never sets SKIP_GRADLE', () => {
  // Arrange — `build-apk.sh` exits 0 with no artifact when SKIP_GRADLE=1, so a
  // workflow that set it reports a successful build that produced nothing.
  const text = workflow('release-apk.yml');

  // Act
  const hits = text
    .split(/\r?\n/)
    .filter((line) => /SKIP_GRADLE/.test(line) && !/^\s*#/.test(line));

  // Assert
  assert.deepEqual(hits, [], `SKIP_GRADLE is set in release-apk.yml:\n  ${hits.join('\n  ')}`);
});

test('the APK is verified before it is published', () => {
  // Arrange
  const text = workflow('release-apk.yml');

  // Act
  const verify = lineOf(text, /bash \.github\/scripts\/validate-apk\.sh/);
  const upload = lineOf(text, /uses: actions\/upload-artifact/);

  // Assert
  assert.ok(verify > 0, 'the APK is never validated');
  assert.ok(upload > verify, 'the artifact is uploaded before it is validated');
});

test('the production gate checks the health body, not just the status', () => {
  // Arrange — `/health` answers 200 whenever the process listens; `db:"up"` is
  // the assertion that distinguishes a working deployment from a booted one.
  const text = workflow('release-apk.yml');

  // Act / Assert
  assert.match(text, /"db":"up"/, 'the production gate does not check the database');
  assert.match(text, /production build cancelled/, 'the refusal message is missing');
});

test('the version is asserted against app.json, not patched', () => {
  // Arrange — rewriting app.json in a scratch commit makes the tag and the
  // artifact agree while leaving the repository behind, and the next build
  // silently reverts.
  const text = workflow('release-apk.yml');

  // Act / Assert
  assert.match(text, /expo\.version/, 'the workflow never reads app.json');
  assert.match(text, /Version mismatch/, 'no refusal names the mismatch');
});

// ──────────────────────────────────────────────────────────────────────────
// validate-apk.sh
// ──────────────────────────────────────────────────────────────────────────

test('validate-apk refuses an APK whose bundle lacks the server URL', () => {
  // Arrange — this is the check that catches a silently empty EXPO_PUBLIC_*
  // value: the build succeeds and the app throws on launch.
  const text = script('validate-apk.sh');

  // Act / Assert
  assert.match(text, /EXPECTED_HOST/, 'no expected-host parameter');
  assert.match(text, /is not in the bundle/, 'a missing server URL is not refused');
});

test('validate-apk refuses a debug-signed APK when a release keystore was supplied', () => {
  // Arrange — a fresh `expo prebuild` re-signs release with the debug key
  // unless `build-apk.sh` rewrites gradle.properties.
  const text = script('validate-apk.sh');

  // Act / Assert
  assert.match(text, /Android Debug/, 'the debug-key guard is missing');
  assert.match(text, /REQUIRE_RELEASE_SIGNING/, 'signing is not required when a keystore exists');
});

test('validate-apk orders readability before size', () => {
  // Arrange — an HTML error page is small, so a size floor first reports
  // "never under 1 MB" for what is really "this is not an APK".
  const text = script('validate-apk.sh');

  // Act
  const readable = lineOf(text, /is not a readable zip archive/);
  const sizeFloor = lineOf(text, /never under 1 MB/);

  // Assert
  assert.ok(readable > 0, 'no readability check');
  assert.ok(sizeFloor > 0, 'no size floor');
  assert.ok(readable < sizeFloor, 'the size floor fires before the archive is read');
});

test('validate-apk checks the ABI before the universal size floor', () => {
  // Arrange — a universal APK missing three ABIs is both "too small" and
  // "wrong contents"; the contents name what to fix.
  const text = script('validate-apk.sh');

  // Act
  const abiCheck = lineOf(text, /contains no lib\//);
  const universalSize = lineOf(text, /a four-ABI build is never under 8MB/);

  // Assert
  assert.ok(abiCheck > 0, 'no per-ABI check');
  assert.ok(universalSize > abiCheck, 'the universal size floor fires before the ABI check');
});

test('validate-apk falls back to python3 when unzip is absent', () => {
  // Arrange — Git Bash on Windows has no `unzip`, and the script is meant to be
  // runnable on a developer's machine so the checks are proven there.
  const text = script('validate-apk.sh');

  // Act / Assert
  assert.match(text, /python3/, 'no python3 fallback');
});

// ──────────────────────────────────────────────────────────────────────────
// The deploy fan-out
// ──────────────────────────────────────────────────────────────────────────

test('deploy resolves, validates, migrates, deploys, then verifies', () => {
  // Arrange — verifying before deploying checks the previous build; migrating
  // after deploying serves requests against a schema that does not exist yet.
  const text = workflow('deploy.yml');

  // Act
  const resolve = lineOf(text, /^ {2}resolve:$/);
  const validate = lineOf(text, /^ {2}validate:$/);
  const migrate = lineOf(text, /^ {2}migrate:$/);
  const deploy = lineOf(text, /^ {2}deploy:$/);
  const verify = lineOf(text, /^ {2}verify:$/);

  // Assert
  assert.ok(resolve > 0 && validate > 0 && migrate > 0 && deploy > 0 && verify > 0, 'a job is missing');
  assert.ok(resolve < validate, 'validate runs before resolve');
  assert.ok(validate < migrate, 'migrate runs before validate');
  assert.ok(migrate < deploy, 'deploy runs before migrate');
  assert.ok(deploy < verify, 'verify runs before deploy');
});

test('deploy is dispatch-only', () => {
  // Arrange — a push that deploys is a blast radius a commit flag should not
  // be able to open.
  const text = workflow('deploy.yml');

  // Act
  const triggers = text.slice(0, text.indexOf('concurrency:'));

  // Assert
  assert.match(triggers, /workflow_dispatch/, 'no dispatch trigger');
  assert.doesNotMatch(triggers, /^\s+push:/m, 'deploy.yml also triggers on push');
});

test('Koyeb is refused by name, not silently dropped', () => {
  // Arrange — a target removed from the case list would report "unknown
  // target", which reads as a typo rather than a deprecation.
  const text = workflow('deploy.yml');

  // Act / Assert
  assert.match(text, /koyeb\)/, 'no explicit koyeb case');
  assert.match(text, /Koyeb is deprecated/, 'the deprecation is not explained');
});

test('every offered target has a validator branch and a host branch', () => {
  // Arrange — a target in the `options:` list with no branch behind it is a
  // dispatch that silently does nothing.
  const deploy = workflow('deploy.yml');
  const host = script('host-platform.sh');

  const optionsBlock = deploy.slice(
    deploy.indexOf("description: 'vps |"),
    deploy.indexOf('mode:', deploy.indexOf("description: 'vps |")),
  );
  // The description lists the legal targets; they are the contract.
  const targets = [...optionsBlock.matchAll(/\b(vps|vercel|netlify|cloudflare|railway|render|fly|koyeb)\b/g)].map(
    (m) => m[1]!,
  );
  const unique = [...new Set(targets)].filter((t) => t !== 'koyeb');

  // Assert
  assert.ok(unique.length >= 6, `expected at least 6 targets, found ${unique.length}`);
  for (const target of unique) {
    assert.ok(
      new RegExp(`^\\s+${target}\\)`, 'm').test(deploy),
      `target '${target}' has no validator branch`,
    );
    assert.ok(
      new RegExp(`^\\s+${target}\\)`, 'm').test(host),
      `target '${target}' has no branch in host-platform.sh`,
    );
  }
});

test('deploy refuses an edge target without the REST database transport', () => {
  // Arrange — a Workers runtime has no TCP socket, so the `pg` transport
  // deploys successfully and then 500s on the first query.
  const text = workflow('deploy.yml');

  // Act / Assert
  assert.match(text, /supabase_rest/, 'deploy.yml does not name the REST transport');
  assert.match(text, /cannot open a TCP Postgres socket/, 'the reason is not stated');
});

test('the VPS branch pins the host key', () => {
  // Arrange — `ssh-keyscan` populates known_hosts from whatever answers. Only
  // the fingerprint comparison makes it a verification.
  const text = script('host-platform.sh');

  // Act / Assert
  assert.match(text, /VPS_SSH_HOST_FINGERPRINT/, 'no pinned fingerprint variable');
  assert.match(text, /Host key mismatch/, 'a mismatch is not refused');
  assert.doesNotMatch(text, /StrictHostKeyChecking=no/, 'StrictHostKeyChecking=no disables the check');
});

// ──────────────────────────────────────────────────────────────────────────
// Regression pins for defects the live deploys exposed
// ──────────────────────────────────────────────────────────────────────────

test('the Vercel branch disables deployment protection', () => {
  // Arrange — a fresh project answers every URL with 200 and a ~330 KB login
  // wall. A status-only smoke test calls that success.
  const text = script('host-platform.sh');

  // Act / Assert
  assert.match(text, /ssoProtection/, 'deployment protection is not disabled');
});

test('the Vercel branch aliases the production domain', () => {
  // Arrange — creating a deployment does not move the project's domain; every
  // later deploy sat on a hashed preview URL and looked like a no-op.
  const text = script('host-platform.sh');

  // Act / Assert
  assert.match(text, /aliases/, 'the deployment is never aliased');
  assert.match(text, /deployments\/\$DEPLOY_ID\/aliases/, 'the alias endpoint is not called');
});

test('the Vercel branch uses cleanUrls so /start reaches start.html', () => {
  // Arrange — expo emits one `.html` per route. Without `cleanUrls` (or a
  // filesystem handle) a catch-all rewrite served the home page for `/start`,
  // and the deploy still answered 200.
  const text = script('host-platform.sh');

  // Act / Assert
  assert.match(text, /"cleanUrls":\s*true/, 'cleanUrls is not set in the generated vercel.json');
});

test('verify-deployment compares page bodies, not only status codes', () => {
  // Arrange — the Vercel defect produced a 200 with the wrong page. No status
  // check can see that.
  const text = script('verify-deployment.sh');

  // Act / Assert
  assert.match(text, /cmp -s/, 'pages are never compared');
  assert.match(text, /byte-identical/, 'a swallowed route is not reported as such');
});

test('verify-deployment follows redirects', () => {
  // Arrange — Netlify's pretty URLs turn `/privacy` into a 301 on a correct
  // deploy; a check that refuses 301 reports a false negative.
  const text = script('verify-deployment.sh');

  // Act / Assert
  assert.match(text, /curl -sSL|curl -fsSL|--location/, 'curl does not follow redirects');
});

test('verify-deployment detects a deployment-protection login wall', () => {
  // Arrange — a 200 with a 330 KB body is a login page, not a page.
  const text = script('verify-deployment.sh');

  // Act / Assert
  assert.match(text, /200000|login wall/i, 'no body-size guard for a protection wall');
});

test('verify-deployment asserts the refusals', () => {
  // Arrange — a refused path answering 200 is the direction nobody notices.
  const text = script('verify-deployment.sh');

  // Act / Assert
  for (const path of ['/studio', '/storage/v1/object/x', '/functions/v1/x']) {
    assert.ok(text.includes(path), `the refused path ${path} is not asserted`);
  }
});

test('verify-deployment asserts RTL in the served markup', () => {
  // Arrange — direction must be in the HTML, before any JavaScript runs
  // (AC-18.7.1). A runtime toggle is a flash of wrong direction.
  const text = script('verify-deployment.sh');

  // Act / Assert
  assert.match(text, /dir="rtl"/, 'direction is not asserted');
});

test('compose-static copies web/ last so a hand-written page wins', () => {
  // Arrange — `dist/` and `web/` are two roots behind Caddy so the app router
  // cannot shadow `/dl/` and `/privacy`. A single-root host has no such
  // mechanism, so the merge order is the mechanism.
  const text = script('compose-static.sh');

  // Act
  const distCopy = lineOf(text, /cp -R "\$DIST"/);
  const webCopy = lineOf(text, /cp -R "\$WEB"/);

  // Assert
  assert.ok(distCopy > 0 && webCopy > 0, 'one of the roots is not copied');
  assert.ok(webCopy > distCopy, 'web/ is copied before dist/, so dist/ can overwrite a hand-written page');
});

test('compose-static fails when a required page is missing', () => {
  // Arrange — a merge that silently produces neither root's page would publish
  // a site that 404s the page a store listing links to.
  const text = script('compose-static.sh');

  // Act / Assert
  for (const page of ['index.html', 'start.html', 'privacy/index.html', 'dl/index.html']) {
    assert.ok(text.includes(page), `${page} is not required`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Review-the-diff checks
// ──────────────────────────────────────────────────────────────────────────

test('no workflow or script contains a credential-shaped literal', () => {
  // Arrange — `.github/` is outside `gate:secrets`, so this is the only scan it
  // receives. `credential-shapes.ts` matches SHAPES rather than names, which is
  // what makes it useful: `${{ secrets.JWT_SECRET }}` is a reference, not a
  // credential, and only a shape rule can tell them apart.
  const hits: string[] = [];

  // ★ ONE DOCUMENTED EXCEPTION, AND IT IS NARROW.
  //
  // `ci.yml` runs a `postgres:15-alpine` service whose password must be
  // *something*, reachable only on the runner's loopback for one job. It is the
  // ephemeral database's own bootstrap value, not a credential for anything.
  const ALLOWED = new Map<string, RegExp>([['ci.yml', /^\s+POSTGRES_PASSWORD: postgres$/]]);

  // Act
  for (const dir of [WORKFLOWS, SCRIPTS]) {
    for (const name of readdirSync(dir)) {
      if (!/\.(yml|sh)$/.test(name)) continue;
      const allow = ALLOWED.get(name);
      const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (allow?.test(line)) return;
        // A `${{ secrets.X }}` or `$VAR` reference is expected; strip it first.
        const withoutRefs = line.replace(/\$\{\{[^}]*\}\}/g, '').replace(/\$\{?[A-Z_][A-Z0-9_]*\}?/g, '');
        const credential = isCredentialLine(withoutRefs, { includeOpaqueRun: false });
        if (credential) hits.push(`${name}:${index + 1} looks like a ${credential.name}`);
      });
    }
  }

  // Assert
  assert.deepEqual(hits, [], `a credential literal reached .github/:\n  ${hits.join('\n  ')}`);
});

test('every FREEWHEN_ variable a workflow reads is documented', () => {
  // Arrange — a typo'd variable name falls back to its default at runtime and
  // nobody reads the log that would have said so.
  const referenced = new Set<string>();

  // Act
  for (const name of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))) {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8');
    for (const match of text.matchAll(/vars\.(FREEWHEN_[A-Z0-9_]+)/g)) referenced.add(match[1]!);
    for (const match of text.matchAll(/^\s+(FREEWHEN_[A-Z0-9_]+):/gm)) referenced.add(match[1]!);
  }

  // Assert
  const readme = readFileSync(join(WORKFLOWS, 'README.md'), 'utf8');
  const undocumented = [...referenced].filter((name) => !readme.includes(name));
  assert.deepEqual(
    undocumented,
    [],
    `.github/workflows/README.md does not document:\n  ${undocumented.join('\n  ')}`,
  );
});

test('the client-inlined variable names match what the app actually reads', () => {
  // Arrange — a workflow exporting `EXPO_PUBLIC_APP_URL` while the app reads
  // `EXPO_PUBLIC_APP_BASE_URL` produces a bundle with the wrong origin inlined,
  // and nothing fails.
  const source = readFileSync(join('src', 'lib', 'api-base-url.ts'), 'utf8');
  const deploy = workflow('deploy.yml');

  // Act / Assert
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_APP_BASE_URL']) {
    assert.ok(source.includes(name), `api-base-url.ts no longer reads ${name}`);
  }
  assert.match(deploy, /EXPO_PUBLIC_APP_BASE_URL/, 'deploy.yml never sets EXPO_PUBLIC_APP_BASE_URL');
});

test('ci.yml exports before it gates, because gate:web needs dist/', () => {
  // Arrange — `gate:all` exits non-zero when `dist/` is absent, printing
  // SKIPPED — NOT CHECKED. Gating first fails for the wrong reason.
  const text = workflow('ci.yml');

  // Act
  const exportLine = lineOf(text, /run: npm run export:web/);
  const gateLine = lineOf(text, /run: npm run gate:all/);

  // Assert
  assert.ok(exportLine > 0, 'ci.yml never exports');
  assert.ok(gateLine > exportLine, 'gate:all runs before the export in ci.yml');
});


