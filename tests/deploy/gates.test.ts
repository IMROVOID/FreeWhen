/**
 * The release gates (PRD-13 §7, AC-13.3.1, AC-18.6.1–3).
 *
 * ★ THESE SCAN THE ARTIFACT, NOT THE SOURCE.
 *
 * The failure this suite exists to catch is a credential that entered through
 * the BUILDER — an `EXPO_PUBLIC_*` value inlined from a `.env`, a key pulled in
 * by a transitive dependency, a `.map` emitted because someone changed a build
 * flag. None of those appear in `src/`, so a source scan passes while the
 * bundle ships a secret.
 *
 * ★ A MISSING ARTIFACT FAILS, IT DOES NOT SKIP.
 *
 * A skipped bundle test is a green run that proved nothing, and "the export
 * broke" is exactly the condition under which someone would rather see a green
 * tick. `dist/` is built by `npm run export:web`; the deploy script builds it
 * before this suite runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { GATE_NAMES } from '../../scripts/gate/all';

const DIST = 'dist';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function bundle(): string[] {
  assert.ok(existsSync(DIST), 'dist/ is missing — run `npm run export:web` first');
  return walk(DIST);
}

/** Concatenated text of every HTML file in the export. */
function htmlText(): string {
  return bundle()
    .filter((file) => file.endsWith('.html'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// The gate runner
// ──────────────────────────────────────────────────────────────────────────

test('the runner covers all seven gates, in the documented order', () => {
  // Arrange — PRD-13 §7 numbers them, and the order is what makes the first
  // failure the interesting one.
  const expected = [
    'gate:secrets',
    'gate:location',
    'gate:engine-purity',
    'gate:logs',
    'gate:design',
    'gate:i18n',
    'gate:web',
  ];

  // Act / Assert
  assert.deepEqual([...GATE_NAMES], expected);
});

test('every gate the runner names has a script that exists', () => {
  // Arrange — a renamed gate script would make `gate:all` fail at spawn time
  // with a confusing module error rather than a missing-check message.
  const scripts: Record<string, string> = {
    'gate:secrets': 'secrets.ts',
    'gate:location': 'location.ts',
    'gate:engine-purity': 'engine-purity.ts',
    'gate:logs': 'logs.ts',
    'gate:design': 'design.ts',
    'gate:i18n': 'i18n.ts',
    'gate:web': 'web.ts',
  };

  // Act / Assert
  for (const name of GATE_NAMES) {
    const script = scripts[name];
    assert.ok(script, `${name} has no script mapping in this test`);
    assert.ok(existsSync(join('scripts', 'gate', script)), `scripts/gate/${script} is missing`);
  }
});

test('the runner passes on this tree', () => {
  // Arrange — ★ THIS SPAWNS THE RUNNER, WHICH IS THE POINT.
  //
  // An earlier version of this suite only read `GATE_NAMES` and the scripts'
  // text, and it passed while `gate:all` was actually broken: the gate
  // self-test wrote probe files into `src/` to prove each gate can fail, and a
  // concurrently running scan read a probe's PATH before its content and then
  // crashed on the already-deleted file. The bug lived in the CONCURRENCY, so
  // only running the thing catches it. (The probes now live in `.probe/` and
  // each gate is run with `--root`, which is what removes the race.)
  //
  // The runner is the deploy's first step; a version that cannot run it must
  // not be the version that ships.
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/gate/all.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  // Act
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  // Assert
  assert.equal(result.status, 0, `gate:all exited ${result.status}:\n${output}`);
  assert.match(output, /gate:all: all 7 gates passed/, output);
});

// ──────────────────────────────────────────────────────────────────────────
// AC-13.3.1 / AC-18.6.1 — no secret in either artifact
// ──────────────────────────────────────────────────────────────────────────

test('AC-13.3.1: the web bundle contains no server key', () => {
  // Arrange — the shapes that cannot occur by accident, plus the names.
  const serverSecrets = [
    'SUPABASE_SECRET_KEY',
    'service_role',
    'NESHAN_API_KEY',
    'NESHAN_MATRIX_API_KEY',
    'NESHAN_DIRECTION_API_KEY',
    'ORS_API_KEY',
    'AI_PROVIDER_KEY',
    'POSTGRES_PASSWORD',
  ];

  // Act
  const hits = bundle()
    .filter((file) => /\.(js|html|json|css|txt)$/.test(file))
    .flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return serverSecrets
        .filter((name) => content.includes(name))
        .map((name) => `${file}: ${name}`);
    });

  // Assert — a leaked service-role key bypasses every RLS policy (AC-8.6.1).
  assert.deepEqual(hits, [], `a server secret reached the web bundle:\n  ${hits.join('\n  ')}`);
});

test('AC-18.6.1: the bundle carries a public Mapbox token at most, never an sk. one', () => {
  // Arrange — a `pk.` token is expected by design (PRD-10 §8). Only `sk.` is a
  // leak, and a blanket `/MAPBOX_/` exemption would pass the secret form.
  const SECRET_TOKEN = /(?:^|[^A-Za-z0-9._-])sk\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/;

  // Act
  const hits = bundle()
    .filter((file) => /\.(js|html|json|css|txt)$/.test(file))
    .filter((file) => SECRET_TOKEN.test(readFileSync(file, 'utf8')));

  // Assert
  assert.deepEqual(hits, [], `a Mapbox secret token reached the bundle: ${hits.join(', ')}`);
});

test('no JWT or OpenAI-shaped key reached the web bundle', () => {
  // Arrange
  const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/;
  const OPENAI = /\bsk-[A-Za-z0-9_-]{16,}/;

  // Act
  const hits = bundle()
    .filter((file) => /\.(js|html|json|css|txt)$/.test(file))
    .flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const found: string[] = [];
      if (JWT.test(content)) found.push(`${file}: JWT`);
      if (OPENAI.test(content)) found.push(`${file}: OpenAI-style key`);
      return found;
    });

  // Assert
  assert.deepEqual(hits, []);
});

// ──────────────────────────────────────────────────────────────────────────
// AC-18.6.2 / AC-18.6.3 — the artifact's other two promises
// ──────────────────────────────────────────────────────────────────────────

test('AC-18.6.2: the export emits no source maps', () => {
  // Act
  const maps = bundle().filter((file) => file.endsWith('.map'));

  // Assert — a `.map` publishes the whole route structure.
  assert.deepEqual(maps, [], `source maps in the export: ${maps.join(', ')}`);
});

test('AC-18.6.3: no page references a third-party script origin', () => {
  // Arrange — the session token lives in `localStorage` on this origin, so the
  // CSP is `default-src 'self'` and it is only honest if nothing external loads.
  const THIRD_PARTY = /<script[^>]+src=["']https?:\/\//;

  // Act
  const hits = bundle()
    .filter((file) => file.endsWith('.html'))
    .filter((file) => THIRD_PARTY.test(readFileSync(file, 'utf8')));

  // Assert
  assert.deepEqual(hits, [], `third-party script origin in: ${hits.join(', ')}`);
});

test('every page is served with Persian direction in the markup (AC-18.7.1)', () => {
  // Arrange — the direction must be in the SERVED document, not written by
  // script after first paint.
  const pages = bundle().filter((file) => file.endsWith('.html'));

  // Act
  const offenders = pages.filter((file) => {
    const tag = /<html[^>]*>/.exec(readFileSync(file, 'utf8'))?.[0] ?? '';
    return !/dir="rtl"/.test(tag) || !/lang="fa"/.test(tag);
  });

  // Assert
  assert.deepEqual(offenders, [], `no dir="rtl" lang="fa" in: ${offenders.join(', ')}`);
});

// ──────────────────────────────────────────────────────────────────────────
// The static roots — no second frontend
// ──────────────────────────────────────────────────────────────────────────

test('web/ contains only the two hand-written pages', () => {
  // Arrange — PRD-18 D18-1: `/start` and `/e/<token>` are app routes, so a
  // `web/start/` or `web/e/` directory here would be a second frontend that
  // drifts from the export on the first edit.
  const expected = ['dl', 'privacy'];

  // Act
  const actual = readdirSync('web', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  // Assert
  assert.deepEqual(actual, expected);
});

test('the download page names the Play Protect prompt and links the browser path', () => {
  // Arrange — the most likely place a reviewer stalls, and the path that means
  // they never have to (PRD-13 §5, §6.2).
  const fa = readFileSync(join('web', 'dl', 'index.html'), 'utf8');
  const en = readFileSync(join('web', 'dl', 'en.html'), 'utf8');

  // Act / Assert
  for (const html of [fa, en]) {
    assert.match(html, /Play Protect/, 'the Play Protect prompt is not explained');
    assert.match(html, /href="\/dl\/freewhen\.apk"/, 'the APK link is missing');
    assert.match(html, /href="\/start"/, 'the download page does not offer the browser path');
  }
});

test('the privacy page is a real, self-contained document', () => {
  // Arrange — the notice must be readable offline, which means no external
  // stylesheet, font or script.
  const html = readFileSync(join('web', 'privacy', 'index.html'), 'utf8');

  // Act / Assert
  assert.ok(html.length > 2000, 'the privacy page looks empty');
  assert.match(html, /Neshan/, 'the routing provider is not named (FR-8.48)');
  assert.ok(!/<link[^>]+href=["']https?:/.test(html), 'the privacy page loads an external stylesheet');
  assert.ok(!/fonts\.googleapis/.test(html), 'the privacy page loads a CDN font');
});

test('the export is served by the Caddyfile contract, not by a second root', () => {
  // Arrange — `/start` and `/e/` must resolve through the catch-all, not
  // through a static root, or the reviewer path bypasses the app.
  const caddy = readFileSync('Caddyfile', 'utf8');

  // Act / Assert
  assert.ok(!/web\/start/.test(caddy), 'the Caddyfile still serves a static /start page');
  assert.match(caddy, /try_files[^\n]*\/index\.html/, 'the catch-all does not fall back to the shell');
});

// ──────────────────────────────────────────────────────────────────────────
// The deploy script's ordering — the one edit that must never be made
// ──────────────────────────────────────────────────────────────────────────

test('the deploy script gates the BUILT bundle before publishing it', () => {
  // Arrange — moving the rsync above `gate:web` publishes an artifact that was
  // never scanned. The line ordering is the assertion.
  const script = readFileSync(join('scripts', 'deploy', 'deploy.sh'), 'utf8');

  const lines = script.split(/\r?\n/);
  const exportLine = lines.findIndex((line) => /bash scripts\/build\/export-web\.sh/.test(line));
  const webGateLine = lines.findIndex((line) => /npm run gate:web/.test(line));
  const rsyncLine = lines.findIndex((line) => /^\s*rsync .*dist\//.test(line));

  // Act / Assert
  assert.ok(exportLine > 0, 'the deploy script never exports');
  assert.ok(webGateLine > exportLine, 'gate:web runs before the export — it would scan a stale dist/');
  assert.ok(rsyncLine > webGateLine, 'the rsync runs before gate:web — an unscanned bundle would be published');
});

test('the export script runs --clear and verifies the served document', () => {
  // Arrange — a stale `dist/` 404s on hashed chunks, and the two assertions at
  // the end are the ones that have failed before.
  const script = readFileSync(join('scripts', 'build', 'export-web.sh'), 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };

  // Act / Assert
  assert.match(packageJson.scripts['export:web'] ?? '', /--clear/, 'the export does not pass --clear');
  assert.match(script, /npm run gate:web/, 'the export script does not gate the built bundle');
  assert.match(script, /dir="rtl"/, 'the export script does not verify the served direction');
});

test('the APK build requires a keystore instead of producing an unsigned artifact', () => {
  // Arrange — a build that succeeds without a keystore produces an APK nobody
  // can install over the previous one, with no error that explains why.
  const script = readFileSync(join('scripts', 'build', 'build-apk.sh'), 'utf8');

  // Act / Assert
  assert.match(script, /FREE_WHEN_RELEASE_STORE_FILE is unset/, 'a missing keystore does not fail the build');
  assert.ok(!/eas build/.test(script), 'the build depends on EAS — no Expo account is allowed (AC-10.1.1)');
  assert.match(script, /gradlew assembleRelease/, 'the build does not run Gradle locally');
});

test('the analytics table is self-hosted, with no US SaaS client', () => {
  // Arrange — reachability from Iran is UNVERIFIED, and a monitoring endpoint
  // that blocks a request is worse than no monitoring (PRD-12 §8).
  const banned = ['sentry', 'posthog', 'mixpanel', 'amplitude', 'segment.io', 'google-analytics'];
  const files = ['server/lib/analytics.ts', ...bundle().filter((file) => file.endsWith('.js'))].slice(0, 400);

  // Act
  const hits = files.flatMap((file) => {
    const content = readFileSync(file, 'utf8').toLowerCase();
    return banned.filter((name) => content.includes(name)).map((name) => `${file}: ${name}`);
  });

  // Assert
  assert.deepEqual(hits, [], `a third-party analytics client appeared: ${hits.join(', ')}`);
});

test('the analytics emitter redacts before it writes', () => {
  // Arrange — one layer of defence is a layer that holds only as long as every
  // future call site remembers.
  const emitter = readFileSync(join('server', 'lib', 'analytics.ts'), 'utf8');
  const migration = readFileSync(join('migrations', '017_analytics.sql'), 'utf8');

  // Act / Assert — the emitter redacts, and the table refuses a sensitive key.
  assert.match(emitter, /redactObject\(/, 'track() does not redact its payload');
  assert.match(migration, /analytics_event_reject_sensitive_keys/, 'the table does not refuse a sensitive key');
  assert.match(migration, /enable row level security/, 'the analytics table has no RLS');
});

test('htmlText reads every exported page, so the assertions above are not vacuous', () => {
  // Act
  const text = htmlText();

  // Assert — a scan over zero pages would pass silently.
  assert.ok(text.length > 1000, 'the export has no HTML content');
});
