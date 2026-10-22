/**
 * The reviewer path (AC-13.1.1, AC-18.1.1, AC-18.2.1).
 *
 * ★ THE CLAIM IS SPECIFIC, SO THE TEST IS TOO.
 *
 * "A reviewer with no app and no account opens one URL and reaches a live event
 * with a ranked list in under two minutes." Four things have to be true for
 * that sentence to hold, and this suite asserts each one against the artitacts
 * that ship rather than against a mock:
 *
 *   1. `/start` is a route in the EXPORT (`dist/start.html`), not a hand-written
 *      page — otherwise steps 1–4 do not exist.
 *   2. `/start` carries the five instruction steps and the honesty block,
 *      including the browser line, in the served document.
 *   3. The demo invite token is a STABLE environment value, inlined at export
 *      time, and `/e/<token>` renders without a session.
 *   4. Reading the demo creates no anonymous user — the `is_demo` predicate in
 *      `demo_event_summary()` is the only thing keeping it readable, and a
 *      forgotten flag turns every reviewer visit into a sign-in.
 *
 * Point 4 is the one that needs a database. It runs through `npm run test:db`
 * and skips explicitly here, like the rest of the DB suites: a skipped case says
 * what was not checked, a passing one that never ran says the opposite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** The served document for `/start`, or `null` when the export is absent. */
function startPage(): string | null {
  const path = join(DIST, 'start.html');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function startSource(): string {
  return readFileSync(join('app', 'start.tsx'), 'utf8');
}

/** The catalogue, so a missing instruction fails here rather than in review. */
function catalogue(language: 'fa' | 'en'): Record<string, unknown> {
  return JSON.parse(readFileSync(join('src', 'i18n', `${language}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

function startKeys(language: 'fa' | 'en'): Record<string, string> {
  const web = catalogue(language).web as { start: Record<string, string> };
  return web.start;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. The route exists in the export
// ──────────────────────────────────────────────────────────────────────────

test('AC-13.1.1: /start is exported as a route, not a hand-written page', () => {
  // Arrange — PRD-18 D18-1. A `web/start/index.html` would be a second frontend
  // that cannot do steps 2–4.

  // Act
  const exported = existsSync(join(DIST, 'start.html'));
  const staticPage = existsSync(join('web', 'start', 'index.html'));

  // Assert
  assert.ok(exported, 'dist/start.html is missing — /start is not in the export');
  assert.ok(!staticPage, 'web/start/index.html exists — that is the second frontend D18-1 removed');
});

test('AC-13.1.1: the served /start document is Persian RTL in the markup', () => {
  // Arrange
  const html = startPage();
  assert.ok(html, 'dist/start.html is missing — run `npm run export:web`');

  // Act
  const tag = /<html[^>]*>/.exec(html)?.[0] ?? '';

  // Assert — direction before first paint, not applied after hydration.
  assert.match(tag, /dir="rtl"/);
  assert.match(tag, /lang="fa"/);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. The instruction steps and the honesty block
// ──────────────────────────────────────────────────────────────────────────

test('the five reviewer steps are present in both catalogues', () => {
  // Arrange — PRD-17 §7. Persian is the default, English is a shipping mode
  // (PRD-10 D11A), so a step missing from either is a shipping defect.
  const required = [1, 2, 3, 4, 5].flatMap((step) => [`step${step}Title`, `step${step}Body`]);

  // Act / Assert
  for (const language of ['fa', 'en'] as const) {
    const keys = startKeys(language);
    for (const key of required) {
      const value = keys[key];
      assert.ok(value && value.trim() !== '', `${language}: web.start.${key} is missing or empty`);
    }
  }
});

test('step 1 names the thing the reviewer is meant to notice', () => {
  // Arrange — "the top one tells you who travels farthest and why". Without it
  // the differentiator reads as an arbitrary list of numbers.
  const fa = startKeys('fa');
  const en = startKeys('en');

  // Act / Assert
  assert.match(en.step1Title ?? '', /ranked/i);
  assert.match(en.step1Body ?? '', /travels farthest/i);
  assert.match(fa.step1Body ?? '', /بیشترین مسیر/);
});

test('the honesty block covers real, estimated, missing AND the browser', () => {
  // Arrange — the browser line is mandatory: leaving it unwritten turns a
  // design decision (list-only on web) into an apparent defect.
  const rows = ['Real', 'Estimated', 'Missing', 'Browser'];

  // Act / Assert
  for (const language of ['fa', 'en'] as const) {
    const keys = startKeys(language);
    for (const row of rows) {
      const labelKey = `honesty${row}Label`;
      const bodyKey = `honesty${row}Body`;
      assert.ok(keys[labelKey], `${language}: web.start.${labelKey} is missing`);
      assert.ok(keys[bodyKey], `${language}: web.start.${bodyKey} is missing`);
    }
  }
});

test('the browser row says the map is Android-only and the ranking survives', () => {
  // Arrange — AC-18.4.1. The ranking carries the decision; the map does not.
  const en = startKeys('en');

  // Act / Assert
  assert.match(en.honestyBrowserBody ?? '', /Android-only/i);
  assert.match(en.honestyBrowserBody ?? '', /ranked list/i);
});

test('the estimated row names transit, and the missing row names accessibility', () => {
  // Arrange — PRD-13 §9: an undocumented gap is discounted far more than a
  // disclosed one, and these two are the ones a reviewer would find.
  const en = startKeys('en');

  // Act / Assert
  assert.match(en.honestyEstimatedBody ?? '', /transit/i);
  assert.match(en.honestyMissingBody ?? '', /wheelchair/i);
});

test('the Play Protect note is on the reviewer page, not only the download page', () => {
  // Arrange — the most likely place a reviewer stalls (PRD-13 §5).
  const en = startKeys('en');

  // Act / Assert
  assert.match(en.apkBody ?? '', /Play Protect/);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. The demo token is a stable environment value
// ──────────────────────────────────────────────────────────────────────────

test('the demo token comes from the environment, never from the UI', () => {
  // Arrange — a token minted through the interface rotates on the next database
  // reset and `/start` breaks silently (PRD-13 R "Demo token accidentally
  // rotated").
  const source = startSource();

  // Act / Assert
  assert.match(source, /EXPO_PUBLIC_DEMO_TOKEN/, 'the token is not read from the environment');
  assert.ok(
    !/createEvent|createInvite|rotateInvite|POST/.test(source),
    'the reviewer page creates an event or an invite — the token must be pre-seeded',
  );
});

test('an unconfigured demo token renders a state, not a crash', () => {
  // Arrange — `/start` is the one page that must always load. A throw here
  // makes the entry point the failure.
  const source = startSource();

  // Act / Assert
  assert.match(source, /tryNowUnavailable/, 'the unconfigured state has no copy');
  assert.ok(
    !/throw new Error\(.*DEMO_TOKEN/.test(source),
    'a missing demo token throws instead of degrading',
  );
});

test('the reviewer page and the download page agree on the invite path', () => {
  // Arrange — `/e/<token>` is the route `app/e/[token].tsx` renders.
  const source = startSource();

  // Act / Assert
  assert.match(source, /\/e\/\$\{DEMO_TOKEN\}/, 'the page does not route to /e/<token>');
  assert.ok(existsSync(join('app', 'e', '[token].tsx')), 'the invite route does not exist');
});

test('the QR encodes the invite URL, and it needs no third-party renderer', () => {
  // Arrange — an invite link is a credential; sending it to a QR image service
  // would leak it on every page load and break the no-third-party rule.
  const source = startSource();
  const qr = readFileSync(join('src', 'features', 'settings', 'components', 'QrCode.tsx'), 'utf8');

  // Act / Assert
  assert.match(source, /<QrCode[^>]*value=\{inviteUrl\}/, 'the QR is not given the invite URL');
  assert.ok(!/https?:\/\/api\.qrserver|chart\.googleapis|quickchart/.test(qr), 'the QR is fetched from a service');
  assert.match(qr, /qrMatrix/, 'the QR is not drawn locally');
});

// ──────────────────────────────────────────────────────────────────────────
// 4. The demo reads without a session
// ──────────────────────────────────────────────────────────────────────────

test('AC-18.2.1: the demo event is marked is_demo, which is what makes it anonymous-readable', () => {
  // Arrange — `demo_event_summary()` is `security definer` and bypasses RLS.
  // `e.is_demo is true` is the ONLY predicate keeping it from reading a real
  // event, so the seed must set it.
  const migration = readFileSync(join('migrations', '016_demo_read.sql'), 'utf8');
  const seed = readFileSync(join('supabase', 'seed.sql'), 'utf8');

  // Act / Assert — the column exists with a safe default, and the seed sets it.
  assert.match(migration, /add column if not exists is_demo boolean not null default false/);
  assert.match(migration, /and e\.is_demo is true/);
  assert.match(seed, /is_demo\s*=\s*true/i, 'the seed does not mark the demo event');
});

test('the funnel starts from a step that needs no session either', () => {
  // Arrange — `invite_link_opened` fires on a token that may resolve to
  // nothing, which is why `analytics_event.event_id` is nullable.
  const migration = readFileSync(join('migrations', '017_analytics.sql'), 'utf8');

  // Act / Assert
  assert.match(migration, /event_id\s+uuid references event\(id\) on delete set null/);
  assert.ok(!/event_id\s+uuid[^,]*not null/.test(migration), 'the funnel would drop its first step');
});

test('the reviewer never has to sign in to see the ranking', () => {
  // Arrange — the sequence the reviewer walks, and where each step is served.
  // Steps 1–4 all render from the export, so none of them may require a
  // session: sign-in is needed only to vote or confirm.
  const source = startSource();

  // Act / Assert — the page offers no sign-in gate before the ranked list.
  assert.ok(!/getStoredUserId|signIn|requireSession/.test(source), 'the reviewer page gates on a session');

  // And the route it points at is the join screen, which renders the event
  // before it asks for a name (app/e/[token].tsx resolves the invite first).
  const joinRoute = readFileSync(join('app', 'e', '[token].tsx'), 'utf8');
  assert.match(joinRoute, /resolveInvite\(token/, 'the invite route does not resolve before asking');
});

test('the from-scratch path a reviewer actually takes has no unanswered screen', () => {
  // Arrange — the export must contain every route the instructions name, or a
  // step 404s on the host and the two-minute budget dies there.
  const routes = [
    join('start.html'),
    join('e', '[token].html'),
    join('event', '[id]', 'index.html'),
    join('event', '[id]', 'decision.html'),
  ];

  // Act
  const missing = routes.filter((route) => !existsSync(join(DIST, route)));

  // Assert
  assert.deepEqual(missing, [], `routes named by the instructions are not exported: ${missing.join(', ')}`);
});
