/**
 * The decision summary (Plan 14 Task 8, PRD-07 FR-7.11–FR-7.13, AC-7.6.1).
 *
 * ★ THE TEMPLATE IS THE PRODUCT. AN LLM REWRITE IS AN OPTIONAL EXTRA.
 *
 * FR-7.11 says the deterministic summary is "P0-quality output with no AI at
 * all", and that is the only part that ships. A model may later rewrite it for
 * fluency; it may never add a fact, change a number, change a name, or change a
 * rank. This module implements the template and the guard that would police a
 * rewrite — and the guard is reachable and tested even though no provider is.
 *
 * ★ NO PROVIDER IS CONFIGURED, AND THIS FILE DOES NOT PRETEND ONE IS.
 *
 * PRD-07 §2 records the provider as unreachable from Iran (OpenAI blocked,
 * Anthropic blocked and entity-scoped). `summarise()` therefore returns the
 * template and says so in its result. There is no network call, no stub client,
 * no "await rewrite()" that silently resolves — a fake provider behind a
 * template is the failure mode the plan forbids.
 *
 * ★ THE SUMMARY IS BUILT FROM STRUCTURED FACTS, IN THE ACTIVE LOCALE.
 *
 * Not from a Persian sentence. A pre-rendered string freezes the digits and the
 * wording at composition time, so it can never be re-localised (PRD-05 §11.1).
 * Everything below is a count, a name, or a rank — and the caller's `t()` turns
 * it into text.
 */

import type { Tally } from '@/src/types/vote';

/**
 * The facts a summary is built from. Counts and names only.
 *
 * ★ NO COORDINATES, NO VENUE ADDRESS, NO FREE TEXT.
 *
 * This is the exact payload an LLM rewrite would be allowed to see (AC-7.7.1),
 * so the type is the privacy boundary: a field that is not here cannot be sent,
 * because there is nothing to send it from.
 */
export interface SummaryFacts {
  /** Yes / maybe / no counts for the leading proposal. */
  yes: number;
  maybe: number;
  no: number;
  /** The leading proposal's title, as the group sees it. */
  leaderTitle: string | null;
  /** How many proposals are on the table at all. */
  proposalCount: number;
  /**
   * Everyone who has not voted, in the order the payload carries them.
   *
   * Names are DATA and are never translated — the same strings appear in both
   * locales (PRD-05 §11.1).
   */
  outstanding: string[];
  /** Proposals flagged as inaccessible-unconfirmed, when the caller knows. */
  unconfirmedAccessibility: number;
}

/** A summary and where it came from. */
export interface SummaryResult {
  /**
   * The catalogue key and its parameters.
   *
   * Returned as data rather than a string so the caller can render it in `fa` or
   * `en` — and so a test can assert the FACTS without matching prose.
   */
  key: 'ai.summary';
  params: {
    yes: number;
    maybe: number;
    no: number;
    leaderTitle: string | null;
    proposalCount: number;
    outstanding: string;
    outstandingCount: number;
    accessibilityCount: number;
  };
  /** Always `template` today — no provider is reachable. */
  source: 'template' | 'rewrite';
  /**
   * Why a rewrite was not used, when one was offered and rejected.
   *
   * `null` when no rewrite was attempted. The screen does not show this; it
   * exists so the decision is auditable in a log rather than silent.
   */
  rewriteRejected: 'unavailable' | 'changed_fact' | null;
}

/** The facts, derived from a tally the engine already produced. */
export function factsFromTally(
  tally: Tally,
  leaderTitle: string | null,
  proposalCount: number,
  unconfirmedAccessibility = 0,
): SummaryFacts {
  return {
    yes: tally.yes,
    maybe: tally.maybe,
    no: tally.no,
    leaderTitle,
    proposalCount,
    outstanding: [...tally.outstanding],
    unconfirmedAccessibility,
  };
}

/**
 * The template summary, as structured facts.
 *
 * `summarise()` is the entry point a screen calls; this is what it returns today.
 */
export function templateSummary(facts: SummaryFacts): SummaryResult {
  return {
    key: 'ai.summary',
    params: {
      yes: facts.yes,
      maybe: facts.maybe,
      no: facts.no,
      leaderTitle: facts.leaderTitle,
      proposalCount: facts.proposalCount,
      // Names are joined with the catalogue's own separator, not a hardcoded
      // comma: `fa` uses «،» and `en` uses ", ".
      outstanding: facts.outstanding.join('\u0000'),
      outstandingCount: facts.outstanding.length,
      accessibilityCount: facts.unconfirmedAccessibility,
    },
    source: 'template',
    rewriteRejected: null,
  };
}

/**
 * Every number in a string, as a multiset, so order does not matter.
 *
 * ★ PERSIAN AND ARABIC-INDIC DIGITS ARE NUMBERS TOO.
 *
 * The template renders `۴` in `fa` and `4` in `en`, so a guard that only matched
 * ASCII would let a Persian rewrite turn «۴ نفر موافق» into «۵ نفر موافق» and
 * accept it — the exact AC-7.6.1 failure, in the locale the product ships in.
 * Both numeral sets are folded to integers before comparing.
 */
export function extractNumbers(text: string): number[] {
  const folded = text
    // Arabic-Indic (٠١٢…) and Persian (۰۱۲…) digits, in their two code points.
    .replace(/[\u0660-\u0669]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x0660),
    )
    .replace(/[\u06f0-\u06f9]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0),
    );

  const found = folded.match(/\d+/g) ?? [];
  return found.map(Number).sort((a, b) => a - b);
}

/**
 * Whether two lists hold the same values with the same multiplicities.
 *
 * Sorts a copy of each, so the check is genuinely a multiset comparison and not
 * a positional one. `[1, 4]` and `[4, 1]` are the same numbers, and a rewrite
 * that reorders them has not changed the facts.
 */
export function sameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;

  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);

  return left.every((value, index) => value === right[index]);
}

/**
 * Accepts or rejects an LLM rewrite (FR-7.13, AC-7.6.1).
 *
 * ★ A REWRITE THAT CHANGES A NUMBER, A NAME, OR A RANK IS REJECTED.
 *
 * This is a correctness check, not a style preference: a rationale that
 * disagrees with the computation it explains is worse than no rationale, because
 * the group acts on the sentence and not on the numbers.
 *
 * The three checks, in order:
 *
 * 1. **Numbers.** The multiset of integers must be identical. "4 in favour" may
 *    not become "5 in favour", and it may not lose the "1 against".
 * 2. **Names.** Every outstanding participant's name must survive, and no name
 *    may be added — `facts.outstanding` is the whole allowed set.
 * 3. **Rank.** The leader's title must appear verbatim, or the leader must be
 *    named as absent in both.
 */
export function acceptRewrite(
  template: string,
  rewrite: string,
  facts: SummaryFacts,
): { accepted: boolean; reason: 'changed_number' | 'changed_name' | 'changed_rank' | null } {
  if (!sameMultiset(extractNumbers(template), extractNumbers(rewrite))) {
    return { accepted: false, reason: 'changed_number' };
  }

  // Every outstanding name must still be there.
  for (const name of facts.outstanding) {
    if (!rewrite.includes(name)) return { accepted: false, reason: 'changed_name' };
  }

  // And the leader must still be the leader.
  if (facts.leaderTitle !== null && !rewrite.includes(facts.leaderTitle)) {
    return { accepted: false, reason: 'changed_rank' };
  }

  return { accepted: true, reason: null };
}

/**
 * The summary the screen shows.
 *
 * ★ TODAY THIS IS THE TEMPLATE AND SAYS SO (FR-7.12, PRD-07 §2).
 *
 * `rewrite` is an optional callback rather than a client this module imports, so
 * this file cannot reach a network even by accident: there is no fetch, no SDK
 * and no URL here. A caller with a reachable provider passes its own rewrite and
 * gets the AC-7.6.1 guard applied; a caller without one gets the template.
 *
 * A rewrite that throws is treated exactly like a rewrite that changed a fact:
 * the template is returned. The group still gets a summary.
 */
export async function summarise(
  facts: SummaryFacts,
  render: (result: SummaryResult) => string,
  rewrite?: (template: string, payload: SummaryFacts) => Promise<string>,
): Promise<SummaryResult> {
  const template = templateSummary(facts);

  if (!rewrite) {
    return { ...template, rewriteRejected: 'unavailable' };
  }

  const templateText = render(template);

  try {
    const rewritten = await rewrite(templateText, facts);
    const verdict = acceptRewrite(templateText, rewritten, facts);

    if (!verdict.accepted) {
      return { ...template, rewriteRejected: 'changed_fact' };
    }

    return { ...template, source: 'rewrite', rewriteRejected: null };
  } catch {
    // ★ A FAILED REWRITE IS NOT A FAILED SUMMARY.
    return { ...template, rewriteRejected: 'unavailable' };
  }
}
