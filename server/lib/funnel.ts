/**
 * The seven funnel events (PRD-01 §9, Plan 05 Task 13).
 *
 * ★ NOTHING SENSITIVE TRAVELS IN THESE PAYLOADS.
 *
 * No invite token (FR-1.8), no coordinate, no display name. `invite_link_generated`
 * records the event id and nothing else; `invite_redeem_failed` records a reason
 * string. Every call goes through `logSafe()`, which redacts by key AND scrubs
 * coordinate-shaped strings — the second line of defence is there because the
 * first one only knows the keys someone remembered to forbid.
 *
 * ★ `seconds_from_open` IS MEASURED FROM THE LINK OPEN, NOT FROM APP LAUNCH.
 *
 * It is the primary acquisition metric (PRD-12 §8.1), and launch-time would
 * measure how long the app was warm — a number that looks good and means
 * nothing. The client sends the timestamp of the invite screen's mount; the
 * server subtracts it, so a wrong device clock cannot produce a negative value
 * that silently averages into the metric.
 */

import { logSafe } from '@/src/lib/redact';

/** The suite of events, named once so a typo cannot invent a new funnel step. */
export type FunnelEvent =
  | 'event_created'
  | 'invite_link_generated'
  | 'invite_link_opened'
  | 'guest_joined'
  | 'join_declined_location'
  | 'invite_redeem_failed'
  | 'account_upgraded'
  // Phase 6 — proposals (PRD-02 §9, PRD-03 §9).
  | 'proposal_created'
  | 'duplicate_detected'
  | 'time_proposal_created'
  | 'opening_hours_warning_shown'
  | 'timezone_mismatch_shown'
  // Phase 7 — voting and the decision (PRD-02 §9).
  //
  // `decision_confirmed` carries `elapsed_since_open_s` and
  // `outstanding_voters`, which are the "time to decision" and "who blocked
  // convergence" numbers the user test measures. Missing them makes Phase 13
  // unmeasurable, so they are named parts of the payload rather than extras.
  | 'vote_cast'
  | 'decision_status_viewed'
  | 'decision_confirmed'
  | 'no_viable_option_shown'
  // Phase 14 — the P1 backlog that the user test justified (PRD-07, PRD-02).
  //
  // `chat_parse_ran` carries the candidate count and whether anything was
  // recognised, so the paste feature's usefulness is measurable without ever
  // recording what was pasted.
  | 'chat_parse_ran'
  | 'decision_reopened';

/**
 * How a duplicate hint was resolved.
 *
 * ★ THIS PAIR IS THE ONLY EVIDENCE FOR THE 75 m THRESHOLD.
 *
 * `voted_existing` means the hint was right and saved a redundant proposal;
 * `created_anyway` means it fired on something the user considered distinct. A
 * threshold set too high shows up as a rising `created_anyway` share long before
 * anyone reports it, which is why the distinction is recorded rather than a
 * single `duplicate_detected` count.
 */
export type DuplicateResolution = 'voted_existing' | 'created_anyway';

/** The reason values `invite_redeem_failed` may carry. */
export type RedeemFailureReason = 'invalid' | 'event_full' | 'rate_limited';

/**
 * Emits one funnel event.
 *
 * The payload is a closed set of scalar properties — no `unknown` bag, so a
 * caller cannot attach a request body or a token by accident.
 */
export function track(
  event: FunnelEvent,
  properties: Record<string, string | number | boolean | null>,
): void {
  // `logSafe` redacts; the gate separately fails the build on a sensitive key
  // handed to a logger, so this cannot degrade into a leak silently.
  logSafe(event, properties);
}

/**
 * The elapsed seconds since the invite screen opened.
 *
 * Clamped at zero: a device clock ahead of the server would otherwise produce a
 * negative duration, and "joined −3 seconds after opening" would average into
 * the metric unnoticed. A missing timestamp yields `null` rather than 0 — the
 * difference between "instant" and "unmeasured" matters.
 */
export function secondsFromOpen(openedAtIso: string | null | undefined, now = Date.now()): number | null {
  if (!openedAtIso) return null;

  const openedAt = Date.parse(openedAtIso);
  if (!Number.isFinite(openedAt)) return null;

  return Math.max(0, Math.round((now - openedAt) / 1000));
}
