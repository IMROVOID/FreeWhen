/**
 * Notification tap handling and body composition (Plan 10 Tasks 8, 13 —
 * FR-6.20, PRD-06 §8, §15.6).
 *
 * ★ A NOTIFICATION THAT LANDS ON THE APP ROOT WASTES ITSELF (FR-6.20).
 *
 * The whole point of a notification is that it saves the user from hunting. If a
 * tap opens the home list and the user then has to find the event, the card, or
 * the proposal the notification was about, the notification has cost a tap and
 * delivered nothing. So every type maps to a specific screen, and "the root" is
 * not among the destinations.
 *
 * ★ THE BODY IS RESOLVED HERE, FROM A KEY, IN THE RECIPIENT'S LANGUAGE (§15.6).
 *
 * The server ships `notifications.bodies.N4` plus sanitised params. This module
 * turns that into a sentence using the reader's own translator. A server that
 * rendered Persian would deliver Persian notifications to every English-mode
 * user — which is why the wire carries a key and never a sentence.
 *
 * ★ THE PRIVACY ALLOW-LIST IS RE-APPLIED HERE.
 *
 * The server sanitises, and this module sanitises again before the text reaches
 * an OS-level notification. Lock screens are public, and two independent
 * defences against a pasted coordinate are worth the one extra function call.
 */

import { translatorFor } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';

/**
 * The notification inventory.
 *
 * ★ DECLARED HERE RATHER THAN IMPORTED FROM THE SERVER.
 *
 * Nothing under `src/` may import from `server/` — the server module holds a
 * privileged pool, and the client bundle is served to strangers. These four
 * declarations are the wire contract, restated on this side of the boundary; the
 * server's `NOTIFICATION_TYPES` is the same list, and `budget.test.ts` asserts the
 * two stay identical.
 */
export const NOTIFICATION_TYPES = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What a notification body may interpolate.
 *
 * There is no field for a coordinate, a start point or a token, so a template
 * cannot interpolate one even by mistake.
 */
export interface NotificationContext {
  venueName?: string;
  authorName?: string;
  count?: number;
  when?: string;
  minutes?: number;
}

/**
 * Strips anything that must never reach a lock screen.
 *
 * Re-applied on this side even though the server sent already-sanitised params:
 * lock screens are public, and a second pass over a string that becomes visible
 * text costs nothing.
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

export function sanitizeContext(context: NotificationContext): NotificationContext {
  const out: NotificationContext = { ...context };

  for (const key of TEXT_CONTEXT_KEYS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = sanitizeForLockScreen(value);
  }

  return out;
}

/**
 * The screen a tap must open.
 *
 * Every value is a concrete destination carrying the ids the screen needs. `null`
 * is deliberately not a member: a notification with no destination is a
 * notification that should not have been sent.
 */
export function deepLinkFor(
  type: NotificationType,
  ids: { eventId: string; axis?: 'time' | 'place'; proposalId?: string },
): string {
  const axis = ids.axis ?? 'time';

  switch (type) {
    // The decision is confirmed: the Decision Card, split by axis.
    case 'N4':
      return `/event/${ids.eventId}/decision?axis=${axis}`;

    // A proposal was added or edited: the decision screen is where voting lives
    // in this build, so both land there with the proposal named.
    case 'N1':
    case 'N2':
      return ids.proposalId
        ? `/event/${ids.eventId}/decision?axis=${axis}&proposal=${ids.proposalId}`
        : `/event/${ids.eventId}/decision?axis=${axis}`;

    // Closing soon, running late, and the nudge all concern the plan itself.
    case 'N3':
    case 'N5':
    case 'N6':
    default:
      return `/event/${ids.eventId}/decision?axis=${axis}`;
  }
}

/** One notification as the client holds it. */
export interface NotificationPayload {
  type: NotificationType;
  /** Resolved against the recipient's language at render time. */
  bodyKey: string;
  /** Already sanitised — never a coordinate, never a token. */
  params: NotificationContext;
  /** The screen the tap opens. */
  deepLink: string;
}

/** The catalogue key for a body. */
export function bodyKey(type: NotificationType): string {
  return `notifications.bodies.${type}`;
}

/**
 * Assembles a payload from the wire and a set of ids.
 *
 * The server sends the type and (optionally) a context; the client owns the body
 * key and the destination, because both depend on the client's own routing and
 * language rather than on the server's.
 */
export function buildPayload(
  type: NotificationType,
  params: NotificationContext,
  ids: { eventId: string; axis?: 'time' | 'place'; proposalId?: string },
): NotificationPayload {
  return {
    type,
    bodyKey: bodyKey(type),
    // Re-sanitised client-side: the server's pass is one defence, this is another.
    params: sanitizeContext(params),
    deepLink: deepLinkFor(type, ids),
  };
}

/**
 * Renders a payload into the text an OS notification shows.
 *
 * `t` is passed in rather than imported so this is callable from a background
 * handler with an explicitly-chosen language, and so the rendered string is
 * testable without a React tree.
 *
 * An unknown key falls back to the notification's own generic line rather than
 * showing `notifications.bodies.N4` to a user.
 */
export function renderBody(
  payload: NotificationPayload,
  language: Language,
): string {
  const t = translatorFor(language);

  const resolved = t(payload.bodyKey, payload.params as Record<string, string | number>);

  // i18next returns the key itself when the entry is missing.
  if (resolved === payload.bodyKey) {
    return t('notifications.genericBody');
  }

  return resolved;
}

/**
 * The deep link a tap should follow, from an OS notification's `data` blob.
 *
 * Returns `null` when the payload carries no event — the caller then does NOT
 * navigate to the root, it leaves the user where they are with the in-app badge
 * still showing. Opening the root would spend the tap for nothing (FR-6.20).
 */
export function deepLinkFromData(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;

  const candidate = (data as { deepLink?: unknown }).deepLink;
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;

  // Only an in-app route is acceptable. A notification payload is attacker-
  // adjacent data if it ever comes from a push service, and handing it straight
  // to the router would let it navigate anywhere.
  if (!candidate.startsWith('/event/')) return null;

  return candidate;
}
