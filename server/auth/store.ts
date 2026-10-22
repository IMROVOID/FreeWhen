/**
 * The local backend's Postgres-backed identity store.
 *
 * ★ IT USES THE SERVICE ROLE, AND THAT IS THE POINT.
 *
 * The token service writes `auth.users` rows, and the `anon` and
 * `authenticated` roles are forbidden from reading that table — granting
 * them SELECT would publish every user's id, email and phone to anyone
 * holding the publishable key, and would let an attacker enumerate user
 * ids to impersonate. So the write goes through the service role, which
 * owns the identity table and bypasses RLS.
 *
 * The service role is used for exactly two things here: writing an
 * identity row, and checking that the database is reachable. Every
 * end-user read goes through PostgREST as the user, never through this
 * connection.
 *
 * ★ IT REUSES PLAN 05's CLIENT RATHER THAN OPENING A SECOND POOL.
 *
 * `server/lib/supabase.ts` already holds the service-role pool and the
 * `createAnonymousUser()` write. A second pool would be a second set of
 * credentials in the process, and the two would drift.
 */

import type { UserStore } from './routes';
import { createAnonymousUser, servicePool } from '../lib/supabase';

/**
 * The identity store the auth service writes through.
 *
 * ★ THE ROW IS WRITTEN BEFORE THE TOKEN IS SIGNED.
 *
 * `sub` must be an id that already exists: `participant.auth_user_id`
 * references `auth.users(id)`, and a token whose subject does not exist
 * would fail every insert that used it.
 */
export const postgresUserStore: UserStore = {
  createAnonymousUser,
  async ping(): Promise<boolean> {
    // `select 1` proves the connection works. It does NOT need the
    // service role, and it is the cheapest possible check.
    await servicePool().query('select 1');
    return true;
  },
};
