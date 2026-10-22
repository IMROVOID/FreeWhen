/**
 * The only path from a reason to text (Plan 08 Task 9a, PRD-05 §11.1).
 *
 * ★ THE PAYLOAD'S `reason` IS `{templateId, params}`, NOT A SENTENCE.
 *
 * Rendering it as a string prints `[object Object]`. The fix is this module,
 * not a change to the payload — a pre-rendered string would freeze the digit
 * set and the wording at composition time, so neither could be re-localised.
 *
 * ★ THIS WRAPS `src/lib/format.ts`; IT DOES NOT REIMPLEMENT IT.
 *
 * `renderReason` and the locale-aware `digits`/`formatNumber` already exist
 * there, and `format.ts` is the documented "locale-aware rendering layer".
 * A second implementation would be a second source of truth for the digit
 * rule, and the two would drift. What this module adds is the presentation
 * decisions the screens need on top: which reason to show, whether a reason
 * is displayable at all, and how a number joins a unit.
 */

import { digits, formatNumber, renderReason } from '@/src/lib/format';
import { translatorFor } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';
import type { Exclusion, Reason } from '@/src/engine/types';

export { renderReason };

/**
 * Whether a reason has anything to say.
 *
 * `null` and an empty template id both mean "no reason", and the caller
 * renders nothing rather than an empty row.
 */
export function hasReason(reason: Reason | null | undefined): reason is Reason {
  return reason != null && typeof reason.templateId === 'string' && reason.templateId.length > 0;
}

/**
 * Renders a reason, or an empty string when there is none.
 *
 * The empty-string case is deliberate: a caller mapping over optional reasons
 * can filter on truthiness without a second null check.
 */
export function renderReasonOrEmpty(
  reason: Reason | null | undefined,
  locale: Language,
): string {
  return hasReason(reason) ? renderReason(reason, locale) : '';
}

/**
 * Renders an exclusion's reason (PRD-04 FR-4.14, OQ-4.2).
 *
 * ★ THE REASON NAMES THE PERSON.
 *
 * `«حذف شد: دسترسی بدون پله برای داریا تایید نشده است.»` — not a code, not a
 * bare category. Seeing who was affected is the whole transparency promise,
 * and an anonymous "accessibility" label does not keep it.
 *
 * The engine's `detail` template already carries `participantName` where one
 * applies; when the exclusion is venue-scoped and the template has no name,
 * the caller's `participantName` fills in.
 */
export function renderExclusion(
  exclusion: Exclusion,
  locale: Language,
  participantName?: string | null,
): string {
  const detail: Reason = { ...exclusion.detail };

  if (participantName && !('participantName' in detail.params)) {
    detail.params = { ...detail.params, participantName };
  }

  return renderReason(detail, locale);
}

/**
 * A travel figure with its unit — `۱۸ دقیقه`.
 *
 * The unit is a catalogue word (`common.minutes`), not a hardcoded "m": the
 * plan's `۱۸د` is shorthand for the Persian copy, not for every locale.
 */
export function formatMinutesWithUnit(minutes: number, locale: Language): string {
  return `${digits(minutes, locale)} ${translatorFor(locale)('common.minutes')}`;
}

/** A range, never a single number — `۲۲–۳۵ دقیقه`. */
export function formatRangeWithUnit(low: number, high: number, locale: Language): string {
  return `${digits(low, locale)}–${digits(high, locale)} ${translatorFor(locale)('common.minutes')}`;
}

/**
 * A cost figure — `۱۵٬۰۰۰ تومان`, or `نامشخص` for `null`.
 *
 * ★ `null` IS NOT ZERO (PRD-05 §8).
 *
 * An unknown cost is not a free one. The engine carries `null` deliberately
 * and this is the only place it becomes text.
 */
export function formatCost(costIrr: number | null, locale: Language): string {
  const t = translatorFor(locale);

  if (costIrr == null) return t('common.unknown');

  return t('venue.costLine', { amount: formatNumber(costIrr, locale) });
}
