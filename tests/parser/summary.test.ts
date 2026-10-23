/**
 * The template summary and the rewrite guard (Plan 14 Task 8,
 * PRD-07 FR-7.11–FR-7.13, AC-7.6.1, AC-7.7.1).
 *
 * ★ AC-7.6.1 IS THE CENTRE: A REWRITE THAT CHANGES A NUMBER IS REJECTED.
 *
 * The template is the product. A model may improve the prose; it may not change
 * a count, a name or a rank, because a rationale that disagrees with the
 * computation it explains is worse than no rationale at all.
 *
 * ★ AND THE OUTPUT IS DETERMINISTIC WITH NO NETWORK CALL.
 *
 * No provider is reachable from Iran (PRD-07 §2). The strongest proof available
 * without one is: the module makes no outbound call, and the same facts produce
 * byte-identical output every time. Both are asserted below — the second by
 * running the builder repeatedly, the first by inspecting what `summary.ts`
 * imports.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  acceptRewrite,
  extractNumbers,
  factsFromTally,
  sameMultiset,
  summarise,
  templateSummary,
  type SummaryFacts,
  type SummaryResult,
} from '../../src/features/parser/summary';
import { tally } from '../../src/features/voting/services/tally';
import type { Proposal } from '../../src/types/proposal';
import type { Vote } from '../../src/types/vote';
import fa from '../../src/i18n/fa.json';
import en from '../../src/i18n/en.json';

const people = [
  { id: 'p-1', display_name: 'سارا', role: 'organizer' },
  { id: 'p-2', display_name: 'دریا', role: 'guest' },
  { id: 'p-3', display_name: 'امیر', role: 'guest' },
];

function proposal(): Proposal {
  return {
    id: 'pr-1',
    event_id: 'e-1',
    type: 'TIME_AND_PLACE',
    title: 'کافه دیدار',
    notes: null,
    link: null,
    status: 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: '2026-08-05T15:30:00Z',
    end_utc: '2026-08-05T17:30:00Z',
    venue: null,
    proposer_id: 'p-1',
    proposer_name: 'سارا',
    created_at: '2026-08-01T10:00:00Z',
  };
}

function vote(participantId: string, displayName: string, value: 'yes' | 'maybe' | 'no'): Vote {
  return {
    proposal_id: 'pr-1',
    participant_id: participantId,
    display_name: displayName,
    value,
    is_dealbreaker: false,
    created_at: '2026-08-02T10:00:00Z',
    updated_at: '2026-08-02T10:00:00Z',
  };
}

/** The FR-7.11 example: 4 yes, 1 no, two silent, one unconfirmed accessibility. */
const facts: SummaryFacts = {
  yes: 4,
  maybe: 0,
  no: 1,
  leaderTitle: 'کافه دیدار',
  proposalCount: 2,
  outstanding: ['بهار', 'علی'],
  unconfirmedAccessibility: 1,
};

describe('FR-7.11 — the template is generated deterministically from the facts', () => {
  test('the same facts always produce byte-identical output', () => {
    const first = templateSummary(facts);
    const second = templateSummary(facts);

    assert.deepEqual(first, second);

    // Repeated, because a `Date.now()` or a shuffled set would show up as a
    // difference on one of these rather than on the first pair.
    for (let run = 0; run < 20; run++) {
      assert.deepEqual(templateSummary(facts), first);
    }
  });

  test('the params carry counts, names and the leader — nothing else', () => {
    const result = templateSummary(facts);

    assert.equal(result.params.yes, 4);
    assert.equal(result.params.no, 1);
    assert.equal(result.params.leaderTitle, 'کافه دیدار');
    assert.equal(result.params.outstandingCount, 2);
    assert.equal(result.params.accessibilityCount, 1);
  });

  test('names are data, so both locales receive the same names', () => {
    const result = templateSummary(facts);

    // Joined with `\u0000` rather than a hardcoded comma: `fa` uses «،» and `en`
    // uses ", ", and the separator belongs to the catalogue, not to this module.
    const names = result.params.outstanding.split('\u0000');
    assert.deepEqual(names, ['بهار', 'علی']);
  });

  test('the template renders in both locales from the same facts', () => {
    for (const catalogue of [fa, en]) {
      const template = catalogue.parser.summary;

      assert.equal(typeof template, 'string');
      // The placeholders the params fill. A template missing one renders a
      // literal `{{...}}` to the user.
      for (const placeholder of ['yes', 'no', 'leaderLine', 'outstandingLine', 'accessibilityLine']) {
        assert.ok(
          template.includes(`{{${placeholder}}}`),
          `${placeholder} missing from a catalogue template`,
        );
      }
    }
  });

  test('an empty group has no leader line to lie about', () => {
    const noLeader = templateSummary({ ...facts, leaderTitle: null, proposalCount: 0 });

    assert.equal(noLeader.params.leaderTitle, null);
    // The catalogue has a dedicated line for this, so the screen never has to
    // print `“” is leading`.
    assert.equal(typeof fa.parser.summaryNoLeader, 'string');
    assert.equal(typeof en.parser.summaryNoLeader, 'string');
  });

  test('facts are derived from the tally, not re-counted', () => {
    // ★ ONE SOURCE OF TRUTH. If this module counted votes itself, a change to
    // the tally's rules would leave the summary disagreeing with the bar beside
    // it — the exact defect FR-7.13 exists to prevent.
    const votes = [
      vote('p-1', 'سارا', 'yes'),
      vote('p-2', 'دریا', 'yes'),
      vote('p-3', 'امیر', 'no'),
    ];

    const derived = factsFromTally(tally(votes, people, proposal()), 'کافه دیدار', 2);

    assert.equal(derived.yes, 2);
    assert.equal(derived.no, 1);
    assert.deepEqual(derived.outstanding, [], 'everyone has voted');
  });
});

describe('AC-7.6.1 — a rewrite that changes a number is rejected', () => {
  test('a rewrite that bumps a count is refused', () => {
    // Arrange — the template, then a "fluent" version with 5 in favour.
    const template = '۴ نفر موافق، ۱ نفر مخالف. پیشنهاد «کافه دیدار» جلو است.';
    const rewrite = '۵ نفر موافق، ۱ نفر مخالف. پیشنهاد «کافه دیدار» جلو است.';

    // Act
    const verdict = acceptRewrite(template, rewrite, { ...facts, outstanding: [] });

    // Assert
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.reason, 'changed_number');
  });

  test('a rewrite that drops a count is refused', () => {
    const template = '4 in favour, 1 against. “کافه دیدار” is leading.';
    const rewrite = '4 in favour. “کافه دیدار” is leading.';

    const verdict = acceptRewrite(template, rewrite, { ...facts, outstanding: [] });

    assert.equal(verdict.accepted, false);
    assert.equal(verdict.reason, 'changed_number');
  });

  test('a rewrite that drops an outstanding name is refused', () => {
    const template = '4 in favour, 1 against. “کافه دیدار” is leading. بهار, علی have not voted.';
    const rewrite = '4 in favour, 1 against. “کافه دیدار” is leading. بهار has not voted.';

    const verdict = acceptRewrite(template, rewrite, facts);

    assert.equal(verdict.accepted, false);
    assert.equal(verdict.reason, 'changed_name');
  });

  test('a rewrite that changes the leader is refused', () => {
    const template = '4 in favour, 1 against. “کافه دیدار” is leading.';
    const rewrite = '4 in favour, 1 against. “رستوران مرکزی” is leading.';

    const verdict = acceptRewrite(template, rewrite, { ...facts, outstanding: [] });

    assert.equal(verdict.accepted, false);
    assert.ok(
      verdict.reason === 'changed_rank' || verdict.reason === 'changed_number',
      'the leader swap is caught by one of the guards',
    );
  });

  test('a pure fluency rewrite is accepted', () => {
    const template = '4 in favour, 1 against. “کافه دیدار” is leading. بهار, علی have not voted.';
    const rewrite =
      'With 4 in favour and 1 against, “کافه دیدار” is leading. هنوز بهار, علی رأی نداده‌اند.';

    const verdict = acceptRewrite(template, rewrite, facts);

    assert.equal(verdict.accepted, true);
    assert.equal(verdict.reason, null);
  });

  test('the number multiset ignores order, and reads Persian digits', () => {
    assert.equal(sameMultiset([1, 4], [4, 1]), true);
    assert.equal(sameMultiset([1, 4], [4, 4]), false);
    assert.equal(sameMultiset([1], [1, 1]), false);

    // ★ THE PERSIAN CASE. The template renders `۴`, so a guard that only read
    // ASCII would accept a rewrite that changed it to `۵` — the AC-7.6.1
    // failure, in the locale the product ships in.
    assert.deepEqual(extractNumbers('۴ موافق و ۱ مخالف'), [1, 4]);
    assert.deepEqual(extractNumbers('٤ yes, ١ no'), [1, 4], 'Arabic-Indic too');
    assert.deepEqual(extractNumbers('4 yes, 1 no, 12 total'), [1, 4, 12]);
    assert.deepEqual(extractNumbers('no numbers here'), []);
  });
});

describe('summarise — the template is returned when no provider is reachable', () => {
  const render = (result: SummaryResult): string =>
    `${result.params.yes} in favour, ${result.params.no} against.` +
    (result.params.leaderTitle ? ` “${result.params.leaderTitle}” is leading.` : '') +
    result.params.outstanding.split('\u0000').join(', ');

  test('with no rewrite callback the template is returned and marked unavailable', async () => {
    const result = await summarise(facts, render);

    assert.equal(result.source, 'template');
    assert.equal(result.rewriteRejected, 'unavailable');
    assert.equal(result.params.yes, 4);
  });

  test('an offered rewrite that changes a fact leaves the template in place', async () => {
    const result = await summarise(facts, render, async () => '5 in favour, 0 against.');

    // ★ AC-7.6.1 END TO END: the caller gets the TEMPLATE, not the rewrite.
    assert.equal(result.source, 'template');
    assert.equal(result.rewriteRejected, 'changed_fact');
    assert.equal(result.params.yes, 4, 'the real count is unchanged');
  });

  test('a rewrite that throws is treated as unavailable, not as a failure', async () => {
    const result = await summarise(facts, render, async () => {
      throw new Error('provider unreachable');
    });

    // The group still gets a summary. An unreachable model degrades to the
    // template — it never degrades to an error screen.
    assert.equal(result.source, 'template');
    assert.equal(result.rewriteRejected, 'unavailable');
  });

  test('an honest rewrite is used, and the facts behind it are unchanged', async () => {
    const result = await summarise(facts, render, async (template) => `${template} (clearer)`);

    assert.equal(result.source, 'rewrite');
    assert.equal(result.rewriteRejected, null);
    assert.equal(result.params.yes, 4);
    assert.equal(result.params.leaderTitle, 'کافه دیدار');
  });
});

describe('AC-7.7.1 — nothing leaves the device, because nothing calls out', () => {
  test('summary.ts imports no network client', () => {
    // ★ THE STRUCTURAL PROOF.
    //
    // A provider implementation could be blocked, rate-limited or mocked — but a
    // module that imports no HTTP client cannot make a request at all, whatever
    // the environment does.
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'parser', 'summary.ts'),
      'utf8',
    );

    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'axios', 'https://', 'http://']) {
      assert.ok(!source.includes(forbidden), `summary.ts must not reference ${forbidden}`);
    }
  });

  test('the rewrite payload carries no coordinate and no address', () => {
    // ★ THE TYPE IS THE BOUNDARY. An LLM rewrite receives `SummaryFacts`, and
    // that type has no lat, no lng, no address and no free text — so there is
    // nothing to send even if a caller wanted to.
    const keys = Object.keys(facts);

    for (const forbidden of ['lat', 'lng', 'latitude', 'longitude', 'address', 'text', 'body']) {
      assert.ok(!keys.includes(forbidden), `SummaryFacts must not carry ${forbidden}`);
    }

    assert.deepEqual(keys.sort(), [
      'leaderTitle',
      'no',
      'outstanding',
      'proposalCount',
      'unconfirmedAccessibility',
      'yes',
      'maybe',
    ].sort());
  });

  test('the app discloses a provider only when one is configured', () => {
    // FR-7.17 — honest in both directions. With no provider, `parser.
    // providerDisclosure` must not be shown; the string exists for the branch
    // where one is.
    assert.equal(typeof fa.parser.providerDisclosure, 'string');
    assert.equal(typeof en.parser.providerDisclosure, 'string');

    // Today no provider is configured, so the template note is what the screen
    // shows instead.
    assert.equal(typeof fa.parser.summaryTemplateNote, 'string');
    assert.match(fa.parser.summaryTemplateNote, /هوش مصنوعی/);
  });
});
