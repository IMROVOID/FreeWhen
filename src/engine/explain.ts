/**
 * Reason generation.
 *
 * **The engine never emits a rendered sentence.** It returns a template key
 * and its parameters, and the client renders it from its own catalogue in
 * the active locale (PRD-05 §11.1).
 *
 * This is not a stylistic preference. A pre-rendered string freezes the
 * digit set and the wording at composition time, so neither can be
 * re-localised downstream — the bug that makes the ranking untranslatable.
 * The English strings are also authored, not machine-translated: "not
 * included in this comparison" must not soften to "not compared".
 *
 * **No digit formatting happens here, in either locale.** `floorMinutes` is
 * the number `18`; «۱۸» and "18" are the client's decision. Importing a
 * digit formatter here would be a locale leak, even though the formatter
 * itself is pure — the issue is the *direction of responsibility*.
 *
 * **The same treatment applies to every payload string**: `excluded[].detail`,
 * `conflicts[].detail`, and each participant's `unmet` label. Any prose left
 * in the payload is a string the client cannot localise.
 */

import { round2 } from './lenses';
import type {
  Aggregate,
  ConflictType,
  ExclusionReason,
  Lens,
  Reason,
  ReasonTemplateId,
} from './types';

/**
 * The reason template for a venue, under the active lens.
 *
 * The lens's own template carries the headline number; the modifiers below
 * wrap it.
 */
export function buildReason(
  lens: Lens,
  aggregate: Aggregate,
  options: { coverageMissing?: number; lowConfidence?: boolean } = {},
): Reason {
  const base = baseReason(lens, aggregate);

  // The modifiers nest, so the client can render "… — 2 people are not
  // included in this comparison — one person's figure is an estimate".
  let reason = base;

  if (options.lowConfidence) {
    reason = { templateId: 'with_low_confidence', params: { base: reason } };
  }

  if (options.coverageMissing && options.coverageMissing > 0) {
    reason = {
      templateId: 'with_coverage_gap',
      params: { base: reason, n: options.coverageMissing },
    };
  }

  return reason;
}

/** The lens's own reason, before the modifiers. */
function baseReason(lens: Lens, aggregate: Aggregate): Reason {
  switch (lens) {
    case 'balanced':
      // The floor is what Balanced protects, so it is what the reason names.
      // The parameter is in MINUTES, not utility points: "nobody travels more
      // than 18 minutes" is a claim a participant can picture.
      return {
        templateId: 'balanced_floor',
        params: { floorMinutes: round2(aggregate.worstMinutes) },
      };

    case 'fastest':
      return {
        templateId: 'fastest_total',
        params: { totalMinutes: round2(aggregate.totalTime) },
      };

    case 'fairest':
      return {
        templateId: 'fairest_gap',
        params: { gapMinutes: round2(aggregate.minutesGap) },
      };

    case 'cheapest':
      // A venue with no known cost has no total to report. The parameter is
      // null rather than a fabricated 0 — a zero would read as "free".
      return {
        templateId: 'cheapest_total',
        params: { totalCostIrr: aggregate.totalCost },
      };
  }
}

/**
 * The reason for an exclusion.
 *
 * An accessibility exclusion gets its own detail template, because "no
 * confirmed step-free access for Darya" is a different claim from "the
 * venue is closed" and the client must not blur them.
 */
export function buildExclusionReason(
  reason: ExclusionReason,
  participantName: string | null,
): Reason {
  if (reason === 'accessibility') {
    return {
      templateId: 'accessibility_no_confirm',
      params: { participantName: participantName ?? '' },
    };
  }

  return {
    templateId: 'excluded',
    params: { reason, participantName: participantName ?? '' },
  };
}

/**
 * The reason for a surfaced conflict.
 *
 * An `accessibility_unknown` conflict gets its own note template — the
 * venue is NOT inaccessible, it is unverified, and the wording must not
 * collapse the two.
 */
export function buildConflictReason(
  type: ConflictType,
  participantName: string | null,
): Reason {
  if (type === 'accessibility_unknown') {
    return {
      templateId: 'accessibility_unknown_note',
      params: { participantName: participantName ?? '' },
    };
  }

  return {
    templateId: 'excluded',
    params: { reason: type, participantName: participantName ?? '' },
  };
}

/** The template ids the engine may emit. */
export const REASON_TEMPLATE_IDS: readonly ReasonTemplateId[] = [
  'balanced_floor',
  'balanced_mean',
  'fastest_total',
  'fairest_gap',
  'cheapest_total',
  'with_coverage_gap',
  'with_low_confidence',
  'excluded',
  'accessibility_no_confirm',
  'accessibility_unknown_note',
];
