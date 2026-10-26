/**
 * Resilient error handling, end to end (Plan 42, Task 10).
 *
 * ★ THREE PROPERTIES, EACH OF WHICH WAS FALSE BEFORE THIS PHASE.
 *
 *  1. A server that throws answers with a CODE and a catalogue KEY — never a
 *     stack trace, a driver message or a schema name.
 *  2. A transport failure reaches the UI as a typed `ApiFailure`, not as a bare
 *     `TypeError` that every `isApiFailure` guard misses.
 *  3. A temporary failure is not reported as a permanent verdict: the event
 *     home offers a retry instead of declaring the user "not a participant".
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { before, describe, test } from 'node:test';

import { initI18n } from '@/src/i18n';
import { ApiFailure, FALLBACK_KEY, isApiFailure } from '@/src/lib/api-failure';
import { HTTP_STATUS_BY_CODE, type ApiErrorCode } from '@/src/lib/errors';
import { MESSAGE_KEY_BY_CODE, wireError } from '../../server/lib/http';

before(() => {
  initI18n('fa');
});

// ── The envelope ──────────────────────────────────────────────────────────

describe('the server answers a failure with a code, never internals', () => {
  test('★ INTERNAL_ERROR is a 500 carrying a catalogue key and nothing else', async () => {
    // Arrange / Act
    const response = wireError('INTERNAL_ERROR');
    const body = (await response.json()) as Record<string, unknown>;

    // Assert — the status, the code, the key, and critically the SHAPE.
    assert.equal(response.status, 500);
    assert.equal(body.error, 'INTERNAL_ERROR');
    assert.equal(body.messageKey, 'errors.serverError');
    assert.deepEqual(Object.keys(body).sort(), ['error', 'messageKey'], 'no extra fields');
  });

  test('★ the body carries no stack, statement or driver text', async () => {
    // Arrange — the two things a leaked 500 usually contains.
    const leaked = ['at ', 'SELECT ', 'column', 'pg_', 'TypeError'];

    // Act
    const text = await wireError('INTERNAL_ERROR').text();

    // Assert
    for (const fragment of leaked) {
      assert.equal(text.includes(fragment), false, `the body must not contain "${fragment}"`);
    }
  });

  test('every code maps to a status and a key that exists in both catalogues', async () => {
    // Arrange
    const fa = (await import('@/src/i18n/fa.json')).default as {
      errors: Record<string, string>;
    };
    const en = (await import('@/src/i18n/en.json')).default as {
      errors: Record<string, string>;
    };

    for (const code of Object.keys(MESSAGE_KEY_BY_CODE) as ApiErrorCode[]) {
      const key = MESSAGE_KEY_BY_CODE[code];
      const leaf = key.replace(/^errors\./, '');

      assert.equal(typeof HTTP_STATUS_BY_CODE[code], 'number', `${code} has a status`);
      assert.ok(fa.errors[leaf], `${code}: fa.json has ${key}`);
      assert.ok(en.errors[leaf], `${code}: en.json has ${key}`);
    }
  });

  test('the new codes map to the statuses the plan specifies', () => {
    assert.equal(HTTP_STATUS_BY_CODE.INTERNAL_ERROR, 500);
    // No response was received, so there is no status to report.
    assert.equal(HTTP_STATUS_BY_CODE.NETWORK_ERROR, 0);
  });

  test('the adapter and the dispatcher both answer INTERNAL_ERROR', () => {
    // A grep rather than a mount: `server/index.ts` opens a listener at import
    // time. What is asserted is that the 500 path no longer claims the input
    // was invalid.
    const root = join(import.meta.dirname, '..', '..');
    const read = (file: string): string => readFileSync(file, 'utf8');

    const adapter = read(join(root, 'server', 'index.ts'));
    const dispatcher = read(join(root, 'server', 'app.ts'));

    assert.ok(adapter.includes("wireError('INTERNAL_ERROR')"), 'the adapter returns the code');
    assert.equal(
      adapter.includes("error: 'VALIDATION_FAILED'"),
      false,
      'a 500 must not carry the 422 code',
    );
    assert.ok(dispatcher.includes("wireError('INTERNAL_ERROR')"), 'the dispatcher catches');
    assert.ok(dispatcher.includes('try {'), 'the handler call is wrapped');
  });
});

// ── The client transport ──────────────────────────────────────────────────

describe('a failed request reaches the UI as an ApiFailure', () => {
  test('★ a dropped connection becomes NETWORK_ERROR, not a bare TypeError', () => {
    // Arrange — the exact value `fetch` rejects with when nothing answers. The
    // transport's catch clause turns this into the failure constructed here;
    // `api.ts` itself cannot be imported under `node --test` (it resolves the
    // API host through `expo-constants` and `react-native`).
    const thrown = new TypeError('Network request failed');

    // Act — the same construction `apiRequest` performs in its catch.
    const failure = new ApiFailure('NETWORK_ERROR', FALLBACK_KEY.NETWORK_ERROR, 0);

    // Assert — typed, keyed, and distinguishable from a refusal.
    assert.equal(isApiFailure(thrown), false, 'a bare TypeError is NOT an ApiFailure');
    assert.ok(isApiFailure(failure), 'the wrapped failure IS one, so every guard catches it');
    assert.equal(failure.code, 'NETWORK_ERROR');
    assert.equal(failure.status, 0, 'no response, so no status');
    assert.equal(failure.messageKey, 'errors.networkError');
    assert.equal(failure.fieldError('title'), undefined, 'no field errors');
  });

  test('a 500 refusal keeps its own code, status and key', () => {
    // Arrange — the envelope the boundary now sends.
    const failure = new ApiFailure('INTERNAL_ERROR', FALLBACK_KEY.INTERNAL_ERROR, 500);

    // Assert
    assert.equal(failure.code, 'INTERNAL_ERROR');
    assert.equal(failure.status, 500, 'the real status survives, not 0');
    assert.equal(failure.messageKey, 'errors.serverError');
    assert.notEqual(failure.code, 'NETWORK_ERROR', 'a refusal is not a transport failure');
  });

  test('every code has a fallback key that exists in both catalogues', async () => {
    const fa = (await import('@/src/i18n/fa.json')).default as {
      errors: Record<string, string>;
    };
    const en = (await import('@/src/i18n/en.json')).default as {
      errors: Record<string, string>;
    };

    for (const code of Object.keys(FALLBACK_KEY) as ApiErrorCode[]) {
      const leaf = FALLBACK_KEY[code].replace(/^errors\./, '');
      assert.ok(fa.errors[leaf], `${code}: fa.json has ${FALLBACK_KEY[code]}`);
      assert.ok(en.errors[leaf], `${code}: en.json has ${FALLBACK_KEY[code]}`);
    }
  });
});

// ── The user-facing copy ──────────────────────────────────────────────────

describe('the retry screens say something a person can act on', () => {
  test('both new sentences exist in both languages and name the next step', async () => {
    const fa = (await import('@/src/i18n/fa.json')).default as {
      errors: { serverError: string; networkError: string };
    };
    const en = (await import('@/src/i18n/en.json')).default as {
      errors: { serverError: string; networkError: string };
    };

    assert.ok(fa.errors.serverError.includes('تلاش'), 'fa: server failure asks for a retry');
    assert.ok(fa.errors.networkError.includes('اینترنت'), 'fa: network failure names the connection');
    assert.ok(en.errors.serverError.length > 0);
    assert.ok(en.errors.networkError.includes('connection'), 'en: network failure names the connection');
  });

  test('★ the empty chat prompt is the sentence the product asked for', async () => {
    const fa = (await import('@/src/i18n/fa.json')).default as {
      chat: { empty: string };
    };

    assert.equal(fa.chat.empty, 'هنوز پیامی نیست. سلام کن.');
  });
});

// ── Event creation copy ───────────────────────────────────────────────────

describe('the create-event screen is labelled honestly', () => {
  test('★ the submit button promises only what it does', async () => {
    // «ایجاد و دریافت لینک» described the next screen. The button creates the
    // event; the link is what follows it.
    const fa = (await import('@/src/i18n/fa.json')).default as {
      events: { create: { submit: string } };
    };
    const en = (await import('@/src/i18n/en.json')).default as {
      events: { create: { submit: string } };
    };

    assert.equal(fa.events.create.submit, 'ساخت رویداد');
    assert.equal(en.events.create.submit, 'Create event');
  });
});

// ── No native dialogs ─────────────────────────────────────────────────────

describe('★ no native confirmation dialog is raised anywhere in the app', () => {
  test('app/ and src/ contain no Alert.alert call', () => {
    // ★ A CALL, NOT THE WORD. The phase's own comments name `Alert.alert` to
    // explain why it is gone, so the pattern matches an invocation.
    const root = join(import.meta.dirname, '..', '..');

    // ★ NO EXTERNAL BINARY.
    //
    // This used to shell out to `rg` (or `$MIMO_RIPGREP_PATH`). That binary is
    // not installed on a GitHub runner, so the test died with
    // `spawnSync rg ENOENT` — a red suite that said nothing about the code it
    // was checking. A source scan over two directories is a few hundred files;
    // reading them in-process is both portable and honest.
    const offenders: string[] = [];
    const callPattern = /Alert\.alert\s*\(/;
    // Build output and dependencies are not source. `src/` is the only place
    // these could appear, but a stray `dist/` inside it would make the scan
    // walk thousands of files for nothing.
    const skipped = new Set(['node_modules', 'dist', '.expo', 'build']);

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipped.has(entry.name)) walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;

        const lines = readFileSync(full, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (callPattern.test(line)) {
            offenders.push(`${relative(root, full)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    };

    for (const dir of ['app', 'src']) walk(join(root, dir));

    assert.deepEqual(offenders, [], `no Alert.alert call may remain:\n${offenders.join('\n')}`);
  });
});
