/**
 * The locale-aware rendering layer.
 *
 * Digits and calendars are RENDERING concerns; numbers travel unformatted
 * (PRD-03 §3.2, PRD-05 §11.1). This module is the only place a number or a
 * reason becomes display text.
 */

import { formatGregorian, formatJalali, toPersianDigits } from './jalali';
import { translatorFor } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';
import { logSafe } from './redact';

/**
 * Renders a number in the locale's digit set. `fa` gives Persian digits,
 * `en` keeps Latin.
 */
export function digits(value: number | string, locale: Language = 'fa'): string {
  const asString = String(value);
  return locale === 'fa' ? toPersianDigits(asString) : asString;
}

/**
 * Renders a number with locale-aware thousands separators — `۱۴۲٬۰۰۰`
 * in `fa`, `142,000` in `en`.
 */
export function formatNumber(value: number, locale: Language = 'fa'): string {
  const formatted = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(value);
  return locale === 'fa' ? toPersianDigits(formatted) : formatted;
}

/**
 * A date rendered for one locale: Jalali primary with a Gregorian secondary
 * line in `fa`; Gregorian primary with a Jalali secondary line in `en`.
 * **Both calendars stay readable in both languages** (PRD-03 §3.2).
 */
export function formatDate(iso: string, locale: Language = 'fa'): { primary: string; secondary: string } {
  return locale === 'fa'
    ? { primary: formatJalali(iso, 'fa'), secondary: formatGregorian(iso) }
    : { primary: formatGregorian(iso), secondary: formatJalali(iso, 'en') };
}

/** The reason contract: the engine sends `{ templateId, params }`, the client renders it. */
export interface Reason {
  templateId: string;
  params: Record<string, number | string | Reason>;
}

type ReasonParam = number | string | Reason;

/**
 * Applies the locale's digit set to a reason's parameters. Strings that are
 * participant names pass through unchanged — a display name is data
 * (PRD-05 §11.1).
 */
function localiseParams(params: Record<string, ReasonParam>, locale: Language): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number') {
      out[key] = digits(value, locale);
    } else if (typeof value === 'string') {
      out[key] = value;
    } else {
      out[key] = renderReason(value, locale);
    }
  }

  return out;
}

/**
 * Renders a `{ templateId, params }` reason into a sentence.
 *
 * This is the ONLY place a reason becomes text (PRD-05 §11.1). An unknown
 * template id falls back without throwing, and the failure is logged through
 * the redaction path rather than surfaced to the user.
 */
export function renderReason(reason: Reason, locale: Language = 'fa'): string {
  const t = translatorFor(locale);
  const key = `reason.${reason.templateId}`;
  const params = localiseParams(reason.params ?? {}, locale);

  const template = t(key, params);

  // i18next returns the key itself when the translation is missing.
  if (template === key) {
    logSafe('reason.template_missing', { templateId: reason.templateId, locale });
    return t('reason.unknownTemplate');
  }

  return template;
}
