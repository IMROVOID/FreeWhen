/**
 * Share-the-plan (Plan 10 Task 10, FR-6.23, AC-6.6.1).
 *
 * ★ THIS IS THE PRODUCT'S MAIN VIRALITY PATH.
 *
 * A plan image in a group chat is an invitation to try the app, shown to a whole
 * group at once. So the shared text carries exactly what makes it useful without
 * the app open — the title, the date and time in BOTH calendars, the venue, a
 * map link, and how many people are coming — and it is composed here as a pure
 * function so what is shared is testable rather than assembled inline in a
 * component.
 *
 * ★ NO COORDINATES IN THE SHARED TEXT (§8).
 *
 * The share goes to a chat; a precise coordinate is a location disclosure to
 * everyone in it, including people who were not invited. The map link is built
 * from the venue's NAME, which is the same exposure as the venue name beside it
 * and no more. `shareText` therefore takes no latitude or longitude at all.
 *
 * ★ THE FALLBACK IS A COPYABLE LINK, NOT AN ERROR (E8).
 *
 * Web has no native share sheet, and the same is true of a device with sharing
 * disabled. The caller copies `shareText` to the clipboard in that case, so the
 * feature degrades to something that still works rather than to a dead button.
 */

import { formatDate } from '@/src/lib/format';
import type { Language } from '@/src/i18n/types';

/** What a share needs. Every field is already-rendered data, not a raw row. */
export interface ShareablePlan {
  title: string;
  venueName: string;
  /** ISO-8601 UTC instant, or `null` for a place-only decision. */
  startUtc: string | null;
  /** `19:00–21:00` in the event's zone, already localised. */
  timeRange: string | null;
  venueAddress: string | null;
  going: number;
  maybe: number;
  /** The deep link back into the app, when one can be built. */
  link: string | null;
}

/** Optional line labels, resolved by the caller from the catalogue. */
export interface ShareTemplates {
  heading: string;
  when: string;
  where: string;
  attendees: (going: number, maybe: number) => string;
}

/**
 * A maps search URL for a venue name.
 *
 * A name-based search URL rather than a coordinate pin: it resolves on whatever
 * map the recipient uses, and it discloses no more than the venue name the same
 * message already contains.
 */
export function mapLink(venueName: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(venueName)}`;
}

/**
 * The share text.
 *
 * ★ BOTH CALENDARS, ALWAYS (PRD-03 §3.2).
 *
 * `formatDate` gives Jalali primary with a Gregorian secondary in `fa`, and the
 * reverse in `en`, so a recipient in either language can place the date. The
 * digits follow the active locale.
 */
export function shareText(plan: ShareablePlan, locale: Language, templates: ShareTemplates): string {
  const lines: string[] = [plan.title];

  if (plan.startUtc) {
    const date = formatDate(plan.startUtc, locale);
    const dateLine = [date.primary, plan.timeRange, `(${date.secondary})`]
      .filter((part): part is string => Boolean(part))
      .join(' · ');

    lines.push(`${templates.when}: ${dateLine}`);
  }

  lines.push(
    `${templates.where}: ${plan.venueName}` +
      (plan.venueAddress ? ` — ${plan.venueAddress}` : ''),
  );

  lines.push(mapLink(plan.venueName));
  lines.push(templates.attendees(plan.going, plan.maybe));

  if (plan.link) lines.push(plan.link);

  return lines.join('\n');
}

/** The shape a native share-sheet call accepts. */
export interface SharePayload {
  message: string;
  title: string;
}

/**
 * What the share sheet receives.
 *
 * `title` is the plan's name so the receiving app can show a subject line; the
 * plan itself travels in `message`, which every share target understands.
 */
export function sharePayload(plan: ShareablePlan, locale: Language, templates: ShareTemplates): SharePayload {
  return {
    title: plan.title,
    message: shareText(plan, locale, templates),
  };
}
