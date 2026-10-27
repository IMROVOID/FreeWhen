/**
 * The caller's global nickname (Plan 49 T7).
 *
 * ★ WHY THIS IS NOT PART OF `participant`.
 *
 * `participant.display_name` is per-event by design (migration 003): a person may
 * be "Sara" at a dinner and "Sara from work" at an offsite. But it left the app
 * with no answer to "who are you?" before the first event, so a user with three
 * events had typed three names and had no identity to colour or reuse. This route
 * reads and writes that identity.
 *
 * ★ IT SEEDS `display_name`; IT DOES NOT REPLACE IT.
 *
 * `applyNicknameToParticipant` copies the nickname onto the participant row when
 * that row has no name of its own, which is what makes the nickname appear on
 * proposals, votes, comments, activity and messages without changing any of the
 * twelve routes that already serialise `display_name`. It also keeps
 * `event_message.sender_name` and `activity_log.actor_name` intact: those are
 * snapshots, and a rename must not rewrite what a thread already said.
 *
 * ★ THIS ROUTE NEVER TOUCHES ANOTHER PERSON'S ROW.
 *
 * Every statement is keyed on the caller's `auth.users.id`, and migration 021's
 * RLS predicates say the same thing. The nickname reaches other participants
 * through `participant.display_name` inside an event — never by reading this table
 * across users, which would be a directory the product does not promise.
 */

import { z } from 'zod';

import {
  callerIdFrom,
  isUuid,
  json,
  readJsonBody,
  validationFailed,
  wireError,
} from '../lib/http';
import { clientIp, limiters } from '../lib/rate-limit';
import { createAnonymousUser, resolveCaller, scopedQueryable, type Caller, type Queryable } from '../lib/supabase';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, VALIDATION } from '../../src/types/event';

/**
 * The caller, minting an anonymous identity when there is none.
 *
 * The same rule `POST /api/events` uses, and the same budget: an identity is
 * a sign-in as far as abuse is concerned, so it is metered per address whether
 * it is minted for an event or for a profile.
 */
async function callerOrCreate(request: Request): Promise<Caller | null> {
  const existing = callerIdFrom(request);
  if (existing && isUuid(existing)) {
    const caller = await resolveCaller(existing);
    if (caller) return caller;
  }

  const limited = limiters.signInByIp.check(`signin:${clientIp(request.headers)}`);
  if (!limited.allowed) return null;

  const userId = await createAnonymousUser();
  const caller = await resolveCaller(userId);
  if (!caller) throw new Error('a freshly created identity could not be resolved');

  return caller;
}

/**
 * `PUT /api/profile` — one field.
 *
 * The same bounds as `JoinSchema.display_name` (`DISPLAY_NAME_MIN`/`MAX`), so a
 * nickname and an event name cannot disagree about what is acceptable. `.trim()`
 * runs before the length check, which is what makes a whitespace-only name a
 * validation failure rather than a 1-character name.
 */
export const ProfileSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(DISPLAY_NAME_MIN, { message: VALIDATION.nameRequired })
    .max(DISPLAY_NAME_MAX, { message: VALIDATION.nameTooLong }),
});

/** What the client renders and gates on. */
export interface ProfileResult {
  nickname: string | null;
  /**
   * The caller's identity, when this request established one.
   *
   * ★ A MINTED ID THE CLIENT NEVER RECEIVES IS THE SAME 403 NEXT REQUEST.
   *
   * Only `PUT` mints; `GET` answers `null` for an identity-less caller because it
   * has nothing to store. The client persists this value the moment it sees it,
   * which is what ends the identity-less window rather than deferring it to the
   * first join.
   */
  userId?: string;
}

/**
 * `GET /api/profile` — the caller's nickname, or `null` when never chosen.
 *
 * ★ A CALLER WITH NO IDENTITY YET GETS `null`, NOT 403.
 *
 * On a first launch there is no `x-user-id` and no `auth.users` row: an identity is
 * minted lazily by the first join or the first `/api/events`. The gate asks this
 * route exactly then, so answering 403 made every new user's console show a failed
 * request before they had done anything wrong — and any client that treats a
 * failure as an error would show a broken screen instead of the question it was
 * about to ask.
 *
 * "You have no nickname" and "you have no identity" are the same answer to this
 * question, so they get the same response.
 */
export async function getProfileHandler(request: Request): Promise<Response> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return json({ nickname: null } satisfies ProfileResult);

  const result = await scopedQueryable().query<{ nickname: string }>(
    'select nickname from user_profile where auth_user_id = $1',
    [userId],
  );

  // ★ `null`, NOT 404.
  //
  // "You have not chosen one yet" is a state the client acts on — it shows the
  // gate — rather than a missing resource. A 404 would have every caller
  // distinguishing an absent profile from a broken one.
  return json({ nickname: result.rows[0]?.nickname ?? null } satisfies ProfileResult);
}

/**
 * `PUT /api/profile` — sets or replaces the caller's nickname.
 *
 * ★ A FIRST-LAUNCH CALLER GETS AN IDENTITY, NOT A 403.
 *
 * The nickname gate runs BEFORE anything else in the app, by design — it sits
 * above the router so no deep link can skip it. But an identity is minted lazily
 * by the first join or the first event creation, so at that moment the caller has
 * none. Answering 403 made every first launch show a failed write in the console
 * and, worse, left `user_profile` empty: the gate fell back to its local cache,
 * and the next screen that asked for a name had no way to know one existed.
 *
 * The response carries the identity it minted, so the client stores it and stops
 * sending identity-less requests altogether. That is what the reported pair of
 * 403s (`GET /api/events`, `PUT /api/profile`) was.
 */
export async function putProfileHandler(request: Request): Promise<Response> {
  const caller = await callerOrCreate(request);
  if (!caller) return wireError('RATE_LIMITED');

  const userId = caller.userId;

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const nickname = parsed.data.nickname;

  const result = await scopedQueryable().query<{ nickname: string }>(
    `insert into user_profile (auth_user_id, nickname)
     values ($1, $2)
     on conflict (auth_user_id)
     do update set nickname = excluded.nickname, updated_at = now()
     returning nickname`,
    [userId, nickname],
  );

  // ★ SEED THE EVENT NAMES THAT HAVE NONE.
  //
  // A rename should reach the events where the person never chose a per-event
  // name. Rows that DO have their own name are left alone — that is the whole
  // reason the per-event column exists.
  //
  // ★ A SEED FAILURE DOES NOT UNDO THE SAVE.
  //
  // The nickname is already written by the statement above. Failing the response
  // here would tell the person their choice was rejected when it was stored, and
  // the gate would stay shut on a write that had succeeded.
  try {
    await seedParticipants(userId, nickname);
  } catch {
    // The profile is saved; the per-event names reconcile on the next join.
  }

  return json({
    nickname: result.rows[0]?.nickname ?? nickname,
    userId,
  } satisfies ProfileResult);
}

/**
 * Copies the nickname onto the caller's participant rows that have no name.
 *
 * ★ A PARTICIPANT ROW ALWAYS HAS A NAME, SO "HAS NONE" NEEDS A MARKER.
 *
 * `display_name` is `not null` with a 1-30 check (migration 003), so there is no
 * NULL to test. The marker is the nickname itself: at join time a participant with
 * no explicit name is created WITH the nickname, so a row whose name equals the
 * previous nickname is one the person did not choose. Rows that differ are their
 * own choice and are never rewritten.
 *
 * That is why the rename path passes both values: it can only distinguish the two
 * by knowing what the name used to be.
 */
export async function seedParticipants(
  userId: string,
  nickname: string,
  previousNickname?: string,
  query: Queryable = scopedQueryable(),
): Promise<void> {
  const marker = previousNickname ?? nickname;

  await query.query(
    `update participant
        set display_name = $2
      where auth_user_id = $1
        and display_name = $3`,
    [userId, nickname, marker],
  );
}

/**
 * The nickname for a caller, or `null`.
 *
 * Read by the join path, which uses it as the display name when the invite form
 * did not supply one.
 *
 * ★ IT NEVER THROWS.
 *
 * The join route calls this while holding no transaction of its own, and a failure
 * here turned a perfectly good invite redemption into a 500 — the guest saw
 * "something went wrong" and could not join at all. A nickname lookup is an
 * optimisation: if it cannot answer, the route falls back to asking for a name, and
 * the request still succeeds.
 */
export async function nicknameFor(
  userId: string,
  query: Queryable = scopedQueryable(),
): Promise<string | null> {
  try {
    const result = await query.query<{ nickname: string }>(
      'select nickname from user_profile where auth_user_id = $1',
      [userId],
    );

    return result.rows[0]?.nickname ?? null;
  } catch {
    return null;
  }
}
