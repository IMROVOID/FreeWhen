/**
 * The client-side proposal analytics (Plan 06 Task 13, PRD-02 §9, PRD-03 §9).
 *
 * ★ `duplicate_detected.resolution` IS THE METRIC THAT TUNES THE THRESHOLD.
 *
 * `voted_existing` means the 75 m hint was right and saved a redundant proposal.
 * `created_anyway` means it fired on something the user considered distinct. A
 * threshold set too wide shows up as a rising `created_anyway` share long before
 * anyone reports it, which is why the two outcomes are recorded separately
 * rather than as one count.
 *
 * ★ NOTHING HERE CARRIES A COORDINATE OR A NAME.
 *
 * Every payload is a closed set of scalars, and it still goes through
 * `logSafe()`, which redacts by normalised key and scrubs coordinate-shaped
 * strings. The second line of defence exists because the first only knows the
 * keys someone remembered to forbid.
 */

import { logSafe } from '@/src/lib/redact';
import type { DuplicateResolution } from '@/server/lib/funnel';

/** The client-side events this phase emits. */
export type ProposalAnalyticsEvent =
  | 'duplicate_detected'
  | 'opening_hours_warning_shown'
  | 'timezone_mismatch_shown';

/**
 * Records how a duplicate hint was resolved.
 *
 * Called once per resolution, from the action the user actually took — never
 * from the hint being shown, because showing a hint and acting on it are the
 * two different things the metric is trying to separate.
 */
export function trackDuplicateResolution(
  resolution: DuplicateResolution,
  reason: 'same_provider_place' | 'near_and_similar',
): void {
  logSafe('duplicate_detected', { resolution, match_reason: reason });
}

/**
 * Records that an advisory opening-hours warning was displayed.
 *
 * The warning is advisory and never blocking (FR-3.13): Iranian venue hours are
 * frequently missing or stale, so the count of times we warned is a measure of
 * data quality, not of anything we refused.
 */
export function trackOpeningHoursWarningShown(hoursKnown: boolean): void {
  logSafe('opening_hours_warning_shown', { hours_known: hoursKnown });
}

/**
 * Records that the local-time indicator was shown (AC-3.1.4).
 *
 * A sustained count here means a real share of participants are outside the
 * event's timezone — the population for whom the indicator is load-bearing.
 */
export function trackTimezoneMismatchShown(deviceTz: string, homeTz: string): void {
  // The zone names are IANA identifiers, not locations: `Europe/Berlin` says
  // nothing about where in Berlin someone is.
  logSafe('timezone_mismatch_shown', { device_tz: deviceTz, home_tz: homeTz });
}
