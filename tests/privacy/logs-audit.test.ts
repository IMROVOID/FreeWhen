/**
 * Log and activity-log audit (Plan 09 Task 11, FR-8.44 / §19.10).
 *
 * ★ TWO TABLES, TWO DIFFERENT FAILURES.
 *
 *  - A coordinate in a LOG LINE (server logs, analytics) is a leak an operator
 *    may never look at. `gate:logs` already enforces the AST rule; this suite
 *    asserts the same rule over the whole tree so a violation is red in CI's
 *    test step too, and not only in the gate step.
 *
 *  - A coordinate in `activity_log.detail` is WORSE: the table is
 *    participant-visible, append-only, and attributed to a person. It is a
 *    disclosure to everyone in the event, permanently, with a receipt.
 *
 * `server/lib/audit-logs.ts` refuses the second at build-the-row time; this
 * suite proves the refusal works and that the tree contains no violation.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, test } from 'node:test';

import {
  ActivityLogViolation,
  FORBIDDEN_DETAIL_KEYS,
  activityLogStatement,
  assertNoLocationInDetail,
} from '@/server/lib/audit-logs';
import { isSensitiveKey, logSafe, redactObject, redactString, toLatinDigits } from '@/src/lib/redact';
import { parseNotice } from '@/src/features/privacy/content/parse-notice';
import { NOTICE_EN } from '@/src/features/privacy/content/notice-en';
import { NOTICE_FA } from '@/src/features/privacy/content/notice-fa';

const PROJECT_ROOT = process.cwd();

/** Every `.ts`/`.tsx` under the given roots, excluding build output. */
function sourceFiles(roots: readonly string[]): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.expo') continue;

      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full);
    }
  };

  for (const root of roots) walk(join(PROJECT_ROOT, root));
  return found;
}

const relativePath = (file: string): string => relative(PROJECT_ROOT, file).split(sep).join('/');

// ───────────────────────────────────────────────────────────────
// The activity log's no-coordinate rule
// ───────────────────────────────────────────────────────────────
describe('the activity log records actions, not locations (FR-8.44)', () => {
  test('a vote change with `{from, to}` is accepted', () => {
    // The record pain point 4 needs: a change, with enough detail to explain it.
    const statement = activityLogStatement({
      eventId: 'e',
      actorId: 'p',
      action: 'vote_changed',
      subjectType: 'proposal',
      subjectId: 'x',
      detail: { from: 'maybe', to: 'yes' },
    });

    assert.match(statement.text, /insert into activity_log/);
    assert.ok(statement.values.includes('vote_changed'));
  });

  test('a top-level coordinate is refused', () => {
    for (const key of FORBIDDEN_DETAIL_KEYS) {
      assert.throws(
        () => assertNoLocationInDetail({ [key]: 35.7 }),
        ActivityLogViolation,
        `\`${key}\` must be refused`,
      );
    }
  });

  test('a NESTED coordinate is refused', () => {
    // A shallow check would report `{ from: { lat } }` clean, and the value
    // reaches the table just the same.
    assert.throws(
      () => assertNoLocationInDetail({ from: { lat: 35.7 } }),
      ActivityLogViolation,
    );
    assert.throws(
      () => assertNoLocationInDetail({ to: [{ lng: 51.4 }] }),
      ActivityLogViolation,
    );
  });

  test('a coordinate spelled unusually is still refused', () => {
    // The list cannot anticipate every spelling; `isSensitiveKey` catches the
    // rest, so `userLat` and `geoPoint` do not slip through.
    assert.throws(() => assertNoLocationInDetail({ userLat: 35.7 }), ActivityLogViolation);
    assert.throws(() => assertNoLocationInDetail({ geoPoint: '35.7,51.4' }), ActivityLogViolation);
  });

  test('a null or empty detail is fine', () => {
    assert.doesNotThrow(() => assertNoLocationInDetail(null));
    assert.doesNotThrow(() => assertNoLocationInDetail({}));
    assert.doesNotThrow(() => assertNoLocationInDetail({ from: 'maybe', to: 'yes' }));
  });

  test('the statement builder refuses before it can produce SQL', () => {
    assert.throws(
      () =>
        activityLogStatement({
          eventId: 'e',
          actorId: 'p',
          action: 'voted',
          subjectType: null,
          subjectId: null,
          detail: { lat_rounded: 35.7 },
        }),
      ActivityLogViolation,
    );
  });
});

// ───────────────────────────────────────────────────────────────
// The redaction path
// ───────────────────────────────────────────────────────────────
describe('one redaction module is the only logging path (§19.10)', () => {
  test('a coordinate in a free-text value is scrubbed', () => {
    const scrubbed = redactString('meet at lat: 35.7000, lng: 51.4000 please');
    assert.equal(scrubbed.includes('35.7'), false);
    assert.equal(scrubbed.includes('51.4'), false);
  });

  test('a coordinate hidden behind a Persian-rendered digit is scrubbed', () => {
    // Persian digits are this app's NORMAL rendering, so a rule that only
    // recognised Latin digits would miss a coordinate a Persian user pasted.
    const scrubbed = redactString('موقعیت: ۳۵.۷۰۰۰, ۵۱.۴۰۰۰');
    assert.equal(scrubbed.includes('۳۵'), false);
  });

  test('a nested coordinate key is redacted', () => {
    const redacted = redactObject({ where: { lat: 35.7, lng: 51.4 }, count: 2 });
    assert.equal(JSON.stringify(redacted).includes('35.7'), false);
    assert.equal(redacted.count, 2, 'non-sensitive values survive');
  });

  test('invite tokens and pasted text are redacted', () => {
    assert.equal(isSensitiveKey('invite_token'), true);
    assert.equal(isSensitiveKey('pastedText'), true);
    assert.equal(isSensitiveKey('displayName'), true);
    assert.equal(isSensitiveKey('participantCount'), false);
  });

  test('logSafe does not throw on a circular payload', () => {
    // Redaction must never crash in the error path: a throwing logger is worse
    // than no logger.
    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;

    assert.doesNotThrow(() => logSafe('audit_circular', circular));
  });
});

// ───────────────────────────────────────────────────────────────
// The tree
// ───────────────────────────────────────────────────────────────
describe('no log site passes a forbidden key', () => {
  test('no `console.*` call exists outside the redaction module', () => {
    const files = sourceFiles(['src', 'app', 'server']);
    const violations: string[] = [];

    for (const file of files) {
      const path = relativePath(file);
      if (path === 'src/lib/redact.ts') continue;

      const content = readFileSync(file, 'utf8');
      const matches = content.match(/console\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/g);

      if (matches) violations.push(`${path}: ${matches.length} console call(s)`);
    }

    assert.deepEqual(violations, [], `every log line must go through logSafe()`);
  });

  test('no `logSafe` or analytics call passes a coordinate key', () => {
    const files = sourceFiles(['src', 'app', 'server']);
    const violations: string[] = [];

    // The list is deliberately wider than `lat`/`lng`: a key such as `accuracy`
    // or `start_point` localises a person just as well.
    const forbidden = ['lat', 'lng', 'lon', 'accuracy', 'coordinate', 'start_point', 'token'];

    for (const file of files) {
      const path = relativePath(file);
      if (path === 'src/lib/redact.ts') continue;

      const content = readFileSync(file, 'utf8');
      const callPattern = /\b(logSafe|logEvent|track|capture)\s*\(([\s\S]{0,400}?)\)/g;

      for (const match of content.matchAll(callPattern)) {
        const payload = match[2] ?? '';

        for (const key of forbidden) {
          // A key used as an object-literal property: `lat:` or `lat =`.
          const propertyPattern = new RegExp(`\\b${key}\\b\\s*:`);
          if (propertyPattern.test(payload)) {
            violations.push(`${path} passes \`${key}\` to ${match[1]}()`);
          }
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});

// ───────────────────────────────────────────────────────────────
// The privacy notice
// ───────────────────────────────────────────────────────────────
describe('the privacy notice is complete and offline', () => {
  for (const [language, markdown] of [
    ['fa', NOTICE_FA],
    ['en', NOTICE_EN],
  ] as const) {
    test(`${language}: names every recipient of approximate coordinates (FR-8.48)`, () => {
      // B15 — sending coordinates to a third party without naming the recipient
      // is a disclosure failure, so all three are asserted by name.
      assert.match(markdown, /Neshan|نشان/);
      assert.match(markdown, /OpenRouteService/);
      assert.match(markdown, /Mapbox/);
    });

    test(`${language}: marks the uncertain retentions as unverified`, () => {
      // An honest "unverified" beats an invented assurance.
      assert.match(markdown, /Unverified|UNVERIFIED|تأییدنشده/);
      assert.doesNotMatch(markdown, /\bguarantee\b/i);
    });

    test(`${language}: states retention, deletion and revocation`, () => {
      // Persian renders `۳۰`, not `30` — the assertion normalises the digits
      // rather than forcing the notice to use Latin numerals.
      const latin = toLatinDigits(markdown);

      assert.match(latin, /30/);
      assert.match(latin, /delet|حذف/i);
      assert.match(latin, /hour|ساعت/i);
    });

    test(`${language}: is bundled, not fetched`, () => {
      // The generated module is a string constant. An import of a URL, or a
      // `fetch`, would make the notice fail in airplane mode — the exact case
      // E10 forbids.
      assert.equal(typeof markdown, 'string');
      assert.ok(markdown.length > 500);
      assert.doesNotMatch(markdown, /https?:\/\//);
    });

    test(`${language}: parses into the expected structure`, () => {
      const blocks = parseNotice(markdown);
      const tables = blocks.filter((block) => block.kind === 'table');

      assert.ok(blocks.length > 20, 'the notice is a document, not a stub');
      assert.equal(tables.length, 1, 'the third-party table is present');
      assert.equal(tables[0]?.rows.length, 3, 'three recipients are listed');
    });
  }

  test('both languages ship, and neither is a stub', () => {
    // A consent a person cannot read in their own language is not informed
    // consent (PRD-08 §12).
    assert.ok(NOTICE_FA.length > 1000);
    assert.ok(NOTICE_EN.length > 1000);
  });

  test('the generated copy matches its markdown source', () => {
    // The markdown is the source of truth. Without this, an edit to `fa.md`
    // would leave the app serving the previous text and nothing would notice.
    for (const [language, markdown] of [
      ['fa', NOTICE_FA],
      ['en', NOTICE_EN],
    ] as const) {
      const source = readFileSync(
        join(PROJECT_ROOT, 'assets', 'privacy', `${language}.md`),
        'utf8',
      );
      assert.equal(
        markdown,
        source,
        `${language}: run \`npm run gen:privacy-notice\` — the bundled copy has drifted`,
      );
    }
  });
});
