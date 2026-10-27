/**
 * `/api/invite/:token` — redemption and guest join (Tasks 4, 5).
 *
 * ★ EVERY FAILURE ON THIS ROUTE LOOKS THE SAME.
 *
 * Invalid, expired, revoked and rate-limited all produce the identical
 * `INVITE_INVALID` envelope — same status, same body, no distinguishing header
 * (FR-1.13, FR-1.15). The one deliberate exception is `EVENT_FULL`, which is
 * only reachable by a caller already holding a valid link and therefore reveals
 * nothing they did not already know (FR-1.21).
 *
 * A test in `tests/db/invites.test.ts` compares the raw bytes of the three
 * failure paths, because a difference of one character is still a leak.
 *
 * ★ JOINING NEVER REQUIRES LOCATION.
 *
 * There is no permission check, no location field and no prompt on this path.
 * A participant who declines everything still becomes a participant (FR-1.22).
 */

import { JoinSchema, VALIDATION } from '@/src/types/event';

import { track, secondsFromOpen } from '../lib/funnel';
import { callerIdFrom, isUuid, json, readJsonBody, validationFailed, wireError } from '../lib/http';
import { hashToken, isTokenShaped } from '../lib/invite-token';
import { joinViaInvite, resolveInvite } from '../lib/invite-service';
import { clientIp, limiters } from '../lib/rate-limit';
import { createAnonymousUser, resolveCaller, type Caller } from '../lib/supabase';
import { nicknameFor } from './profile';

/**
 * Applies both invite limits: per address and per token (FR-1.15).
 *
 * A breach answers with the generic invalid-link error rather than a 429. A
 * distinguishable rate-limit response would make the limiter itself an oracle:
 * an attacker could tell "this token exists but I am throttled" from "this token
 * does not exist", which is the one thing this route must never reveal.
 */
function withinInviteLimits(request: Request, token: string): boolean {
  const byIp = limiters.redeemByIp.check(`redeem:${clientIp(request.headers)}`);
  // The bucket is keyed on the HASH, so a raw token never sits in memory as a
  // map key that a heap dump or a diagnostics endpoint could surface.
  const byToken = limiters.redeemByToken.check(`redeem:${hashToken(token)}`);

  return byIp.allowed && byToken.allowed;
}

function failInvite(reason: 'invalid' | 'rate_limited' | 'event_full'): Response {
  // Counts only — never the token, never the event id (PRD-01 §9).
  track('invite_redeem_failed', { reason });

  return reason === 'event_full' ? wireError('EVENT_FULL') : wireError('INVITE_INVALID');
}

/** `GET /api/invite/:token` — the S4 title, status and count. */
export async function resolveInviteHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';

  if (!isTokenShaped(token)) return failInvite('invalid');
  if (!withinInviteLimits(request, token)) return failInvite('rate_limited');

  const resolved = await resolveInvite(token);
  if (!resolved.ok) {
    return failInvite(resolved.reason === 'EVENT_FULL' ? 'event_full' : 'invalid');
  }

  const platform = request.headers.get('x-platform') === 'web' ? 'web' : 'app';
  track('invite_link_opened', { event_id: resolved.event.event_id, platform });

  return json({ event: resolved.event });
}

/**
 * The joining identity: reuse the presented one, else mint an anonymous one.
 *
 * The address budget applies only to MINTING. A re-join by an existing identity
 * is not an identity-creation event, and spending the budget on it would lock
 * a legitimate participant out of their own event after 30 visits.
 */
async function joinCaller(request: Request, userIdHeader: string | null): Promise<Caller | null> {
  if (userIdHeader && isUuid(userIdHeader)) {
    const existing = await resolveCaller(userIdHeader);
    if (existing) return existing;
  }

  const limited = limiters.signInByIp.check(`signin:${clientIp(request.headers)}`);
  if (!limited.allowed) return null;

  const userId = await createAnonymousUser();
  return resolveCaller(userId);
}

/** `POST /api/invite/:token/join` */
export async function joinInviteHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? '';

  if (!isTokenShaped(token)) return failInvite('invalid');
  if (!withinInviteLimits(request, token)) return failInvite('rate_limited');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = JoinSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const caller = await joinCaller(request, callerIdFrom(request));
  if (!caller) return failInvite('rate_limited');

  /**
   * ★ THE NICKNAME IS THE FALLBACK NAME, AND THE ONLY ONE.
   *
   * An invite form that omits `display_name` used to be a validation failure. With
   * a global nickname the person has already answered "who are you?", so asking
   * again on every invite is exactly the friction the nickname exists to remove.
   * The per-event name still WINS when supplied — a person may want a different
   * name in this one event.
   *
   * A caller with neither is still refused: an invitation must not be redeemable
   * anonymously, because `display_name` is what other participants see.
   */
  const displayName = parsed.data.display_name ?? (await nicknameFor(caller.userId));
  if (!displayName) {
    return validationFailed([{ path: ['display_name'], message: VALIDATION.nameRequired }]);
  }

  const joined = await joinViaInvite(token, caller, displayName);
  if (!joined.ok) {
    return failInvite(joined.reason === 'EVENT_FULL' ? 'event_full' : 'invalid');
  }

  // `seconds_from_open` is captured from the invite screen's mount, so the
  // metric measures the funnel rather than how warm the app was (PRD-12 §8.1).
  if (joined.result.created) {
    track('guest_joined', {
      event_id: joined.result.event.event_id,
      seconds_from_open: secondsFromOpen(typeof body.opened_at === 'string' ? body.opened_at : null),
      auth_is_anonymous: caller.isAnonymous,
    });
  }

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.set('x-user-id', caller.userId);

  return new Response(JSON.stringify(joined.result), { status: 200, headers });
}
