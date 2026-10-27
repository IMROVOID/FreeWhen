/**
 * The role `withCallerTransaction` switches to must be reachable (Plan 49 follow-up).
 *
 * ★ THE DEFECT THIS PINS.
 *
 * `withCallerTransaction` opens every caller-scoped unit with
 *
 *     set local role service_role
 *
 * and `000_portability.sql` granted that role to `authenticator` (through
 * `anon`) and to nothing else. It never granted it to the CONNECTION role.
 *
 * On the documented backends that is invisible, which is why it shipped:
 *
 *   - locally the connection is `postgres`, a SUPERUSER, so `set role` always
 *     succeeds;
 *   - on Supabase the connection is `postgres`, which is a member of
 *     `service_role`.
 *
 * A managed Postgres whose login role is neither — Neon's default
 * `neondb_owner` reaches `service_role` through `pg_auth_members` only by
 * SET ROLE, and `SET ROLE` is precisely what a role needs MEMBERSHIP for — makes
 * every caller-scoped unit fail:
 *
 *     api: request failed: permission denied to set role "service_role"
 *
 * which is a 500 on join, vote, confirm, the events list, and every other route
 * that writes.
 *
 * ★ AND MEMBERSHIP ALONE IS NOT ENOUGH.
 *
 * A grant is only half the fix. Since Postgres 16 a membership carries
 * `ADMIN`, `INHERIT` and `SET` independently, and `SET ROLE` needs `SET`. A
 * managed provider issues its memberships as `INHERIT FALSE, SET FALSE`: the
 * grant lands, `pg_has_role(..., 'member')` answers true, and
 * `set role service_role` still answers 42501. The repair is therefore to
 * `revoke` and re-`grant` the membership with `INHERIT FALSE, SET TRUE`.
 *
 * ★ NOT `alter role`. That statement is a GUC assignment, not membership
 * syntax, and Postgres refuses it with "permission will be denied to set role".
 *
 * ★ THE GRANT IS CONDITIONAL, AND THAT IS NOT DEFENSIVENESS.
 *
 * Unconditional `grant service_role to <connection role>` breaks the plan on
 * Supabase, where `postgres` holds ADMIN on `service_role`: Postgres then
 * refuses with
 *
 *     cannot be granted back to your own grantor
 *
 * so the migration skips the whole block for a superuser, and skips it again when
 * the membership already carries `SET`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/** The migration text with `--` comments stripped, so prose cannot satisfy a check. */
function sql(): string {
  return readFileSync('migrations/024_role_grants.sql', 'utf8')
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

test('the connection role is granted service_role', () => {
  // Act
  const text = sql();

  // Assert — without this, `set local role service_role` is `42501` on any
  // backend whose login role is not its owner.
  assert.ok(
    /grant service_role to/i.test(text),
    'no migration grants service_role to the connection role',
  );
});

test('the grant names the role the connection logs in as, not the one it switched to', () => {
  // Act
  const text = sql();

  // Assert — ★ `session_user`, NOT `current_user`.
  //
  // Neon's pooler sets `role = service_role` on connect, so by the time this
  // file runs `current_user` IS `service_role`. Granting to it is
  // `grant service_role to service_role` — refused with 42501 — and revoking
  // from it is refused the same way. `session_user` is the credential's role,
  // which is the one that needs the membership.
  assert.ok(/session_user/.test(text), 'the grant does not name the login role');
  assert.ok(
    !/current_user/.test(text),
    'the migration still reads `current_user`, which is `service_role` on Neon',
  );
});

test('the block is skipped when the membership already carries SET', () => {
  // Act — the guard reads the membership catalogue, not `pg_has_role`: that
  // function reports the GRANT, which a `SET FALSE` member holds and cannot use.
  const text = sql();
  const guarded =
    /pg_auth_members/.test(text) &&
    /set_option/.test(text) &&
    text.indexOf('if v_can_set then') !== -1;

  // Assert — a member with `SET FALSE` is exactly the broken state this
  // migration repairs, so skipping on membership alone would leave it broken.
  assert.ok(guarded, 'the migration does not check whether the role can switch');
});

test('a superuser is skipped, because granting there is an error', () => {
  // Act
  const guardsSuper = /rolsuper/i.test(sql());

  // Assert — on Supabase `postgres` already holds `service_role`, and
  // `grant service_role to postgres` raises `0LP01`.
  assert.ok(guardsSuper, 'the migration grants unconditionally to a superuser');
});

test('the membership is granted with SET TRUE, and without admin option', () => {
  // Act
  const text = sql();

  // Assert — `set true` is what makes `SET ROLE` legal; admin option is what
  // raises "cannot be granted back to your own grantor".
  assert.ok(/set true/i.test(text), 'the membership is granted without SET TRUE');
  assert.ok(
    !/with admin option/i.test(text),
    'the migration grants admin option, which SQLSTATE 0LP01 refuses',
  );
});

test('the mint is granted INSERT on auth.users', () => {
  // Act
  const text = sql();

  // Assert — `createAnonymousUser` inserts into `auth.users` as `service_role`,
  // and `000_portability.sql` granted that role SELECT and DELETE only. The
  // insert worked solely where the connection owned the table, which on a
  // managed Postgres it does not.
  assert.ok(
    /grant insert on auth\.users to service_role/i.test(text),
    'service_role cannot mint an identity, so every first-time join 500s',
  );
});

test('the migration grants no privilege the server never uses', () => {
  // Act
  const text = sql();
  const granted = [
    ...text.matchAll(/grant\s+([a-z, ]+)\s+on\s+auth\.users\s+to\s+(\w+)/gi),
  ].map((match) => `${String(match[1]).trim().toLowerCase()}:${String(match[2]).toLowerCase()}`);

  // Assert — `update` would let the server rewrite an address or a phone number,
  // which nothing in the product asks for. A grant with no caller outlives its
  // reason and is a widening nobody notices.
  assert.ok(granted.length > 0, 'no auth.users grant found');
  assert.deepEqual(
    granted.filter((entry) => entry.startsWith('update')),
    [],
    `an unused privilege is granted on auth.users: ${granted.join(', ')}`,
  );
});

test('the migration sorts after every migration already deployed', () => {
  // Arrange
  const files = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();

  // Act
  const ours = files.indexOf('024_role_grants.sql');

  // Assert — the runner applies in filename order and skips what it has already
  // recorded, so a migration numbered below the deployed maximum would only ever
  // reach a fresh database.
  assert.equal(ours, files.length - 1, `024_role_grants.sql is not the last migration (${files[files.length - 1]})`);
});

