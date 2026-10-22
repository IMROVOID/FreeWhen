/**
 * `DELETE /api/account` — in-app account deletion (Plan 09 Task 10).
 *
 * ★ APPLE §5.1.1(v): ONCE ACCOUNTS EXIST, IN-APP DELETION IS MANDATORY (B5).
 *
 * Not a support email, not a web form — a control inside the app. The email
 * upgrade lands in Phase 14, so this must exist BEFORE that ships. Shipping
 * accounts first and deletion later is the violation.
 *
 * ★ WHAT IS DELETED, AND WHAT IS NOT.
 *
 * Deleting the `auth.users` row cascades:
 *
 *   auth.users → participant (auth_user_id)  → start_point (participant_id)
 *             → participant.role=organizer   → event (created_by) → …
 *
 * A participant who owns no event loses only their own rows. A participant who
 * ORGANIZES an event takes the event and its contents with them, because there
 * is no organizer left to run it — that is `event.created_by on delete cascade`,
 * decided in Phase 2, not a choice this route makes.
 *
 * ★ OTHER PARTICIPANTS' DATA IS UNTOUCHED.
 *
 * Their votes on a surviving event, their own start points, their RSVPs. The
 * only rows that disappear are the ones the deleted account owned or was the
 * sole reason for existing.
 */

import { callerIdFrom, isUuid, json, wireError } from '../lib/http';
import { servicePool } from '../lib/supabase';
import { logSafe } from '../../src/lib/redact';

/** What the deletion removed — counts only, never row contents. */
export interface AccountDeletionResult {
  deleted: true;
  events_deleted: number;
}

/**
 * Deletes the caller's account.
 *
 * The count of removed events is reported so the UI can be honest — "3 events
 * you organized were deleted, 2 events you joined are unaffected" — rather than
 * claiming a clean exit when other people just lost their plan.
 *
 * One statement, so the whole deletion commits or none of it does.
 */
export async function deleteAccountHandler(request: Request): Promise<Response> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return wireError('NOT_PARTICIPANT');

  const result = await servicePool().query<{ events_deleted: number }>(
    `with owned as (
       select id from event where created_by = $1
     ),
     removed as (
       delete from auth.users where id = $1 returning id
     )
     select (select count(*)::int from owned) as events_deleted`,
    [userId],
  );

  // ★ ZERO ROWS MEANS ALREADY GONE, NOT AN ERROR.
  //
  // A retried request — the client lost the response, the person tapped twice —
  // must not surface a failure for an account that is already deleted. The
  // desired end state is reached; reporting an error would push the person to
  // believe their data survived.
  const eventsDeleted = result.rows[0]?.events_deleted ?? 0;

  // No user id in the payload: an id is an identifier, and this log line is the
  // one place a deletion could be correlated back to a person.
  logSafe('account_deleted', { eventsDeleted });

  return json({ deleted: true, events_deleted: eventsDeleted } satisfies AccountDeletionResult);
}
