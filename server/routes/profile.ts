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

import { callerIdFrom, isUuid, json, readJsonBody, validationFailed, wireError } from '../lib/http';
import { scopedQueryable, type Queryable } from '../lib/supabase';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, VALIDATION } from '../../src/types/event';

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
}

/** `GET /api/profile` — the caller's nickname, or `null` when never chosen. */
export async function getProfileHandler(request: Request): Promise<Response> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return wireError('NOT_PARTICIPANT');

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

/** `PUT /api/profile` — sets or replaces the caller's nickname. */
export async function putProfileHandler(request: Request): Promise<Response> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return wireError('NOT_PARTICIPANT');

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
  await seedParticipants(userId, nickname);

  return json({ nickname: result.rows[0]?.nickname ?? nickname } satisfies ProfileResult);
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
 */
export async function nicknameFor(
  userId: string,
  query: Queryable = scopedQueryable(),
): Promise<string | null> {
  const result = await query.query<{ nickname: string }>(
    'select nickname from user_profile where auth_user_id = $1',
    [userId],
  );

  return result.rows[0]?.nickname ?? null;
}
