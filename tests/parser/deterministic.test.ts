/**
 * The deterministic parser (Plan 14 Task 7, PRD-07).
 *
 * The governing test is AC-7.3.1: the parser must work with **no AI provider
 * configured**, which in this file means no network, no key and no model — the
 * import list below is the assertion. AC-7.1.1 is asserted the same way: the
 * module has no path to a database write, so a grep of its own source is a
 * stronger proof than a mock that could be bypassed.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { parseChat } from '../../src/features/parser/chat-parser';
import { parseDeterministic } from '../../src/features/parser/deterministic';
import { normaliseText } from '../../src/features/parser/lexicon';
import { MAX_CANDIDATES, PASTE_MAX_CHARS, type ParseContext } from '../../src/features/parser/types';

/**
 * A fixed clock inside an August window.
 *
 * `now` is deliberately a Friday so «جمعه» resolves to TODAY and «شنبه» to
 * tomorrow — the two resolutions the user test is most likely to paste.
 */
const CONTEXT: ParseContext = {
  windowStartDate: '2026-07-31',
  windowEndDate: '2026-08-07',
  homeTz: 'Asia/Tehran',
  now: { date: '2026-07-31', time: '10:00' },
};

/** The instant the parse runs, matching `CONTEXT.now`. */
const NOW = new Date('2026-07-31T06:30:00Z');

describe('normaliseText', () => {
  test('folds Persian digits to Latin', () => {
    assert.equal(normaliseText('ساعت ۱۹:۳۰'), 'ساعت 19:30');
  });

  test('folds Arabic-Indic digits too — both appear in real pastes', () => {
    assert.equal(normaliseText('١٩'), '19');
  });

  test('folds the Arabic forms of ye and kaf to their Persian counterparts', () => {
    // Arabic `ي`/`ك` are produced by some keyboards and would miss every pattern.
    assert.equal(normaliseText('كيك'), 'کیک');
  });

  test('turns ZWNJ into a space so a phrase spanning it still matches', () => {
    assert.equal(normaliseText('می‌ریم'), 'می ریم');
  });
});

describe('AC-7.3.1 — the deterministic parser works with no AI provider', () => {
  test('returns candidates from Persian chat text', () => {
    // Arrange
    const text = 'جمعه شب کافه دیدار خوبه؟\nیا شنبه ساعت ۸ رستوران مرکزی';

    // Act — no provider is configured or reachable anywhere in this suite
    const candidates = parseDeterministic(text, CONTEXT).candidates;

    // Assert
    assert.ok(candidates.length >= 2, 'two lines must yield at least two candidates');
    assert.ok(
      candidates.some((candidate) => candidate.placeQuery?.includes('کافه دیدار')),
      'the first café must be found',
    );
    assert.ok(
      candidates.some((candidate) => candidate.placeQuery?.includes('رستوران مرکزی')),
      'the second restaurant must be found',
    );
  });

  test('resolves «فردا شب» forward from the event clock', () => {
    const candidates = parseChat('فردا شب ساعت 19:30 پارک لاله', CONTEXT, NOW).candidates;

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;

    assert.equal(candidate?.local?.date, '2026-08-01', 'فردا is the day after 07-31');
    assert.equal(candidate?.local?.time, '19:30');
    assert.equal(candidate?.local?.resolvedFromWeekday, false, 'an explicit day needs no confirmation');
  });

  test('reads «شب» with no hour as the evening default', () => {
    const candidates = parseChat('شنبه شب کافه دیدار', CONTEXT, NOW).candidates;

    assert.equal(candidates[0]?.local?.time, '20:00');
  });

  test('reads a bare number only when the clock word makes it a time', () => {
    const withWord = parseChat('فردا ساعت 19 پارک لاله', CONTEXT, NOW).candidates;
    const withoutWord = parseChat('فردا 19 نفر پارک لاله', CONTEXT, NOW).candidates;

    assert.equal(withWord[0]?.local?.time, '19:00');
    assert.equal(withoutWord[0]?.local, null, '«19 نفر» is a count, not a time');
  });

  test('returns an empty result for text that names nothing', () => {
    const result = parseChat('باشه حتما', CONTEXT, NOW);

    assert.equal(result.candidates.length, 0);
    assert.equal(result.recognised, false, 'nothing recognised is a normal outcome, not an error');
  });
});

describe('E4 — an ambiguous weekday is resolved and marked for confirmation', () => {
  test('«جمعه» resolves to the nearest future occurrence inside the window', () => {
    const candidates = parseChat('جمعه شب کافه دیدار', CONTEXT, NOW).candidates;

    assert.equal(candidates[0]?.local?.date, '2026-07-31', 'now is a Friday');
    assert.equal(candidates[0]?.local?.resolvedFromWeekday, true, 'the user must confirm this');
  });

  test('a weekday outside the window is rejected rather than stretched to fit', () => {
    // A window that ends before the next Friday: the guess cannot be shown.
    const narrow: ParseContext = { ...CONTEXT, windowStartDate: '2026-08-01', windowEndDate: '2026-08-02' };
    const result = parseChat('جمعه شب کافه دیدار', narrow, NOW);

    assert.equal(result.candidates.length, 0);
  });
});

describe('E9 — the Jalali month boundary', () => {
  test('«۱۲ اسفند» resolves inside the Esfand window', () => {
    // 1404-12-12 is 2026-03-03 in the Gregorian calendar.
    const esfand: ParseContext = {
      windowStartDate: '2026-03-01',
      windowEndDate: '2026-03-07',
      homeTz: 'Asia/Tehran',
      now: { date: '2026-02-25', time: '10:00' },
    };

    const candidates = parseChat('۱۲ اسفند ساعت 19 کافه دیدار', esfand, new Date('2026-02-25T06:30:00Z')).candidates;

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.local?.date, '2026-03-03');
  });

  test('an Esfand date in a non-leap year still resolves (29 Esfand)', () => {
    const esfand: ParseContext = {
      windowStartDate: '2026-03-19',
      windowEndDate: '2026-03-21',
      homeTz: 'Asia/Tehran',
      now: { date: '2026-03-15', time: '10:00' },
    };

    // 1404 is not a leap year, so Esfand has 29 days and 29 Esfand is 2026-03-20.
    const candidates = parseChat('۲۹ اسفند کافه دیدار', esfand, new Date('2026-03-15T06:30:00Z')).candidates;

    assert.equal(candidates[0]?.local, null, 'no time named');
    assert.equal(candidates[0]?.placeQuery, 'کافه دیدار');
  });
});

describe('the paste cap and the candidate cap', () => {
  test('text over the 4000-character cap yields nothing, without throwing', () => {
    const text = 'کافه دیدار\n'.repeat(PASTE_MAX_CHARS);

    const result = parseChat(text, CONTEXT, NOW);

    assert.equal(result.candidates.length, 0);
    assert.equal(result.text, text, 'the raw text is echoed so the screen can show it');
  });

  test('more than ten messages are capped, keeping the most confident', () => {
    const text = Array.from({ length: 14 }, (_, index) => `کافه شماره ${index}`).join('\n');

    const result = parseChat(text, CONTEXT, NOW);

    assert.equal(result.candidates.length, MAX_CANDIDATES);
  });
});

describe('AC-7.1.1 — the parser has no write path', () => {
  const PARSER_DIR = join(process.cwd(), 'src', 'features', 'parser');

  const sources = readdirSync(PARSER_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, body: readFileSync(join(PARSER_DIR, name), 'utf8') }));

  test('no parser module imports a database, a service or a pool', () => {
    const forbidden = [/supabase/, /servicePool/, /withTransaction/, /from '\.\.\/\.\.\/server/];

    for (const { name, body } of sources) {
      const imports = body.split('\n').filter((line) => line.trimStart().startsWith('import'));
      for (const line of imports) {
        for (const pattern of forbidden) {
          assert.ok(!pattern.test(line), `${name} must not import ${String(pattern)}: ${line}`);
        }
      }
    }
  });

  test('no parser module writes', () => {
    for (const { name, body } of sources) {
      assert.ok(!/\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(body), `${name} must not write`);
    }
  });
});

describe('constraint pass — G3, AC-7.5.1', () => {
  test('a candidate in the past is dropped', () => {
    // The window is in the past relative to NOW, so every timed candidate fails.
    const past: ParseContext = {
      windowStartDate: '2020-01-01',
      windowEndDate: '2020-01-07',
      homeTz: 'Asia/Tehran',
      now: { date: '2020-01-01', time: '10:00' },
    };

    const result = parseChat('۲ دی ساعت 20 کافه دیدار', past, NOW);

    assert.equal(result.candidates.length, 0);
  });

  test('a dropped candidate does not remove its siblings (AC-7.5.1)', () => {
    const text = 'کافه دیدار';

    const result = parseChat(text, CONTEXT, NOW);

    assert.equal(result.candidates.length, 1, 'a place-only candidate survives the time checks');
  });
});
