/**
 * The notification policy engine and its gate endpoint (Plan 10 Tasks 3–5, 13 —
 * PRD-06 §5, §8).
 *
 * ★ THE RULES HERE ARE PURE, AND THAT IS WHAT MAKES THEM PROVABLE.
 *
 * The budget, the coalescing rule, the non-voter targeting and the privacy
 * sanitiser are the four policies that make these notifications bearable. Each is
 * a decision about a payload — no query, no clock, no I/O — so each is a function
 * over plain data, and `tests/notifications/budget.test.ts` drives all ten PRD
 * edge cases through them without a database.
 *
 * ★ THE BUDGET IS SERVER-SIDE, IN UTC, KEYED ON (PARTICIPANT, EVENT) (FR-6.16).
 *
 * Client-side budgeting is bypassable and untestable (§15.3). A user in three
 * events has three independent budgets: one per-user global bucket would silence
 * every other event the moment one got chatty.
 *
 * ★ OVER-BUDGET NOTIFICATIONS ARE DEFERRED, NEVER DROPPED (AC-6.3.1).
 *
 * Dropping loses information the user needed; deferring costs latency only, so
 * the decision carries the exact instant it becomes sendable.
 *
 * ★ N4 BYPASSES MUTE (FR-6.19, AC-6.4.1).
 *
 * This is the product's core promise, not an oversight. If you are about to "fix"
 * it, re-read PRD-06 FR-6.19.
 */

import { callerIdFrom, isUuid, json, wireError } from '../lib/http';
import { resolveCaller, servicePool, type Caller } from '../lib/supabase';

/** The inventory this phase ships (N1–N6). N7 is Phase 14. */
export const NOTIFICATION_TYPES = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The types a mute suppresses.
 *
 * ★ N4 IS ABSENT ON PURPOSE, and `budget.test.ts` fails if it is added.
 */
export const MUTABLE_TYPES: readonly NotificationType[] = ['N1', 'N2', 'N3', 'N5', 'N6'];

/** The budget window: one hour (FR-6.16). */
export const BUDGET_WINDOW_MS = 60 * 60 * 1000;

/** The N1 coalescing window: ten minutes (FR-6.17). */
export const COALESCE_WINDOW_MS = 10 * 60 * 1000;

/** Whether a mute applies to a type. N4 is never muted (FR-6.19). */
export function isMuted(type: NotificationType): boolean {
  return MUTABLE_TYPES.includes(type);
}

/** The budget key. One budget per participant per event. */
export function budgetKey(participantId: string, eventId: string): string {
  return `${participantId}:${eventId}`;
}

export type BudgetDecision = { send: true } | { send: false; deferUntil: Date };

/**
 * Whether a notification may be sent now.
 *
 * `lastSentAt` is the most recent send for the (participant, event) pair, or
 * `null` when nothing has been sent. A breaching send is deferred to the exact
 * instant the window rolls over, so a scheduler need not poll.
 */
export function checkBudget(
  lastSentAt: Date | null,
  nowUtc: Date,
  windowMs: number = BUDGET_WINDOW_MS,
): BudgetDecision {
  if (lastSentAt === null) return { send: true };
  if (nowUtc.getTime() - lastSentAt.getTime() >= windowMs) return { send: true };

  return { send: false, deferUntil: new Date(lastSentAt.getTime() + windowMs) };
}

export type SkipReason = 'muted' | 'not-recipient';

export type DispatchDecision =
  | { action: 'send'; type: NotificationType }
  | { action: 'defer'; type: NotificationType; until: Date }
  | { action: 'skip'; type: NotificationType; reason: SkipReason };

export interface DispatchInput {
  type: NotificationType;
  /** The participant has muted notifications for this event. */
  muted: boolean;
  /** The last send for this (participant, event), or `null`. */
  lastSentAt: Date | null;
  nowUtc: Date;
  /** False when a targeting rule already excluded this participant (e.g. N3). */
  isRecipient?: boolean;
}

/**
 * The single gate every notification passes through. Order is asserted:
 *
 *  1. **Not a recipient** — a targeting rule excluded them; nothing resurrects it.
 *  2. **Mute** — except N4, which bypasses it (FR-6.19).
 *  3. **Budget** — a bypassing N4 still spends budget, because the budget bounds
 *     how many pings a phone receives regardless of which type sent them.
 */
export function decideDispatch(input: DispatchInput): DispatchDecision {
  const { type, muted, lastSentAt, nowUtc } = input;

  if (!(input.isRecipient ?? true)) return { action: 'skip', type, reason: 'not-recipient' };

  // ★ N4 BYPASSES MUTE — `isMuted` is false for N4, so this is the same rule
  // stated once rather than a special case bolted on beside it.
  if (muted && isMuted(type)) return { action: 'skip', type, reason: 'muted' };

  const budget = checkBudget(lastSentAt, nowUtc);
  if (!budget.send) return { action: 'defer', type, until: budget.deferUntil };

  return { action: 'send', type };
}

export interface ProposalEvent {
  /** ISO instant the proposal was created. */
  createdAt: string;
  /** The author's display name, for the single-proposal body. */
  authorName: string;
}

/** The coalesced N1 result: one notification, never one per proposal. */
export interface CoalescedProposals {
  count: number;
  /** The single proposal's author, when the count is exactly one. */
  singleAuthor: string | null;
}

/**
 * Collapses proposals inside the window into one notification (FR-6.17).
 *
 * `null` when nothing is pending. The caller sends ONE notification whose body
 * names the count, or the single author — never three pings, which is the fastest
 * route to a permanent mute.
 */
export function coalesceProposals(
  proposals: readonly ProposalEvent[],
  nowUtc: Date,
  windowMs: number = COALESCE_WINDOW_MS,
): CoalescedProposals | null {
  const windowStart = nowUtc.getTime() - windowMs;

  const pending = proposals.filter((proposal) => {
    const at = Date.parse(proposal.createdAt);
    // An unparseable timestamp is not counted: it would inflate a number the
    // user reads.
    return Number.isFinite(at) && at >= windowStart && at <= nowUtc.getTime();
  });

  if (pending.length === 0) return null;

  return {
    count: pending.length,
    singleAuthor: pending.length === 1 ? (pending[0]?.authorName ?? null) : null,
  };
}

/**
 * The participants N3 (closing soon) should reach.
 *
 * ★ NON-VOTERS ONLY. Notifying people who already voted is pure fatigue, and it
 * trains them to ignore the one notification that matters (FR-6.18).
 */
export function n3Recipients(
  participants: readonly { id: string }[],
  voterIds: readonly string[],
): string[] {
  const voted = new Set(voterIds);
  return participants.filter((participant) => !voted.has(participant.id)).map((p) => p.id);
}

/**
 * The context a notification body may interpolate.
 *
 * ★ A LOCK SCREEN IS PUBLIC. This type is the allow-list: there is no field here
 * for a coordinate, a start point or a token, so a template cannot interpolate
 * one even by mistake. `sanitizeForLockScreen` defends the string level too,
 * because a venue name is free text and someone can paste a coordinate into it.
 */
export interface NotificationContext {
  venueName?: string;
  /** A participant's first name, in a proposal context only. */
  authorName?: string;
  count?: number;
  /** A date or time already rendered for the recipient's locale. */
  when?: string;
  /** Minutes of lateness, for the running-late broadcast. */
  minutes?: number;
}

/**
 * Strips anything that must never reach a lock screen: a coordinate pasted into
 * a venue name, and a URL whose query string carries a live token.
 */
export function sanitizeForLockScreen(value: string): string {
  return value
    // `35.6892,51.3890`, with optional spaces and signs.
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, '')
    // A URL with anything after `?` or `#` may carry a token.
    .replace(/https?:\/\/[^\s?#]+[?#][^\s]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const TEXT_CONTEXT_KEYS = ['venueName', 'authorName', 'when'] as const;

/** A context with every free-text field passed through the sanitiser. */
export function sanitizeContext(context: NotificationContext): NotificationContext {
  const out: NotificationContext = { ...context };

  for (const key of TEXT_CONTEXT_KEYS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = sanitizeForLockScreen(value);
  }

  return out;
}


// ─────────────────────────────────────────────────────────────
// The gate endpoint
// ─────────────────────────────────────────────────────────────

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;
  return resolveCaller(userId);
}

interface SendBody {
  type?: unknown;
  last_sent_at?: unknown;
}

/**
 * The caller's stored mute preference for one event.
 *
 * ★ THE STORED VALUE WINS, AND THE BODY'S `muted` IS IGNORED.
 *
 * This endpoint used to take `muted` as a client-supplied fact
 * (`body.muted === true`) while nothing stored it. That made the preference a
 * claim the caller made about itself at send time: a client that never asked,
 * or one that simply omitted the field, was treated as unmuted regardless of
 * what the participant had actually chosen — so the toggle appeared to work and
 * changed nothing.
 *
 * `false` when the caller is not a participant, or the event is unknown. Both
 * are indistinguishable to a caller without the event, and neither may be read
 * as "this person wants notifications" for anyone else.
 */
async function storedMuteFor(
  caller: Caller,
  eventId: string,
): Promise<boolean | null> {
  const result = await servicePool().query<{ notifications_muted: boolean }>(
    `select notifications_muted from participant
      where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0]?.notifications_muted ?? null;
}

/**
 * `POST /api/events/:id/notifications`
 *
 * ★ THE SERVER DECIDES, AND THE DECISION IS DATA.
 *
 * The request carries the fact of when this participant was last sent anything;
 * the mute state is READ FROM THE DATABASE, not taken from the body. This
 * endpoint applies the gate and answers `send` / `defer` / `skip`. A deferral is
 * reported with the instant it becomes sendable so the client queues it rather
 * than losing it — which is the whole of AC-6.3.1.
 */
export async function notificationsHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  let body: SendBody;
  try {
    body = (await request.json()) as SendBody;
  } catch {
    return wireError('VALIDATION_FAILED');
  }

  const type = body.type;
  if (typeof type !== 'string' || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    return wireError('VALIDATION_FAILED');
  }

  // A caller with no participant row for this event has no preference to honour
  // and no reason to be told this event's notification state.
  const muted = await storedMuteFor(caller, eventId);
  if (muted === null) return wireError('NOT_PARTICIPANT');

  const rawLastSent = body.last_sent_at;
  const lastSentAt =
    typeof rawLastSent === 'string' && Number.isFinite(Date.parse(rawLastSent))
      ? new Date(rawLastSent)
      : null;

  const decision = decideDispatch({
    type: type as NotificationType,
    muted,
    lastSentAt,
    nowUtc: new Date(),
  });

  return json({
    action: decision.action,
    type,
    // Null rather than absent, so the client has one shape to read.
    defer_until: decision.action === 'defer' ? decision.until.toISOString() : null,
    reason: decision.action === 'skip' ? decision.reason : null,
  });
}
