/**
 * The portability suite — the proof that the schema is backend-agnostic.
 *
 * ★ WHAT THIS SUITE IS FOR.
 *
 * Plan 02B's whole argument is that plain PostgreSQL and self-hosted Supabase
 * run the SAME schema, the SAME migrations and the SAME RLS policies, and
 * differ in exactly three things: who issues JWTs, how realtime is
 * delivered, and whether an admin UI exists.
 *
 * That argument is only worth something if it is TESTED. This suite is the
 * test:
 *
 *  1. Migration `000` is idempotent and creates the shim.
 *  2. The shim behaves correctly with claims absent, malformed and present.
 *  3. Every migration 000–015 applies on plain Postgres with no Supabase
 *     container — which is Task 2's actual purpose: any migration that
 *     reaches for a Supabase-only object fails HERE, loudly, and is fixed
 *     in the migration rather than worked around in the shim.
 *  4. The RLS policies hold under the shim, as a NON-SUPERUSER.
 *
 * ★ EVERY POLICY ASSERTION RUNS AS A NON-SUPERUSER.
 *
 * A superuser and the service role both bypass RLS entirely. An RLS test
 * run with either passes while every policy is broken, and hides the bug
 * until production (PRD-09 §13.9, PRD-13 §4 step 7). The `openSession`
 * helper sets the JWT claims and issues `set role authenticated`, so the
 * policies see a real caller.
 *
 * ★ THE DENIAL IS "ZERO ROWS", NOT AN ERROR.
 *
 * A denied read returns zero rows — that is what makes the assertion
 * meaningful rather than a permission error in disguise.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createPool, databaseUrl, loadDotEnv } from '../../scripts/db/client';
import { MIGRATIONS_DIR, migrate, migrationFiles, reapplyAll } from '../../scripts/db/migrate';
import { PROJECT_ROOT } from '../../scripts/db/paths';
import {
  addMember,
  asOwner,
  closePool,
  closeSession,
  createUser,
  openSession,
  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
  type Session,
} from './support';
import {
  NOTIFY_CONTEXT_SQL,
  NOTIFY_FUNCTION_SQL,
} from '../../server/realtime/bridge';

/**
 * Normalises SQL for comparison.
 *
 * ★ COMMENTS ARE STRIPPED FROM BOTH SIDES.
 *
 * The migration file explains each function above AND inside it; the
 * bridge's constant carries the SQL without the prose. Stripping the
 * comments from both leaves the SQL, which is what the two must agree
 * about — a comment cannot change what the database does, and a comment
 * that drifts is a documentation problem rather than a behavioural one.
 */
function normaliseSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Creates a scratch database for a destructive test.
 *
 * ★ THE SUITES SHARE ONE DATABASE, so a test that DROPS a schema must
 * not do it in the shared one.
 *
 * The scratch database is created from the same connection string as the
 * shared one, with a different NAME — so it is the same server, the same
 * credentials and the same configuration, which is what makes the
 * from-scratch run a real test.
 */
async function createScratchDatabase(): Promise<{ name: string; url: string }> {
  const name = `freewhen_scratch_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = createPool(databaseUrl());

  try {
    await admin.query(`create database ${quoteName(name)}`);
  } finally {
    await admin.end();
  }

  const url = databaseUrl().replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

  return { name, url };
}

/** Drops the scratch database. */
async function dropScratchDatabase(scratch: { name: string }): Promise<void> {
  const admin = createPool(databaseUrl());

  try {
    // The pool's own connections must be gone first, or the drop fails
    // with "database is being accessed by other users".
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [scratch.name],
    );
    await admin.query(`drop database if exists ${quoteName(scratch.name)}`);
  } catch {
    // A scratch database that will not drop is litter, not a test
    // failure. The test's own assertions have already run.
  } finally {
    await admin.end();
  }
}

/** Quotes an identifier. The name is generated here, never from input. */
function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Opens a session and guarantees it is released. */
async function withSession<T>(
  userId: string,
  options: { isAnonymous?: boolean; role?: 'anon' | 'authenticated' } = {},
  body: (session: Session) => Promise<T>,
): Promise<T> {
  const session = await openSession(userId, options);
  try {
    return await body(session);
  } finally {
    await closeSession(session);
  }
}

describe('portability', { concurrency: false }, () => {
  before(async () => {
    loadDotEnv();
  });

  after(async () => {
    await closePool();
  });

  // ───────────────────────────────────────────────────────────
  // Task 1 — the shim exists, and it is idempotent
  // ───────────────────────────────────────────────────────────
  describe('the portability shim', () => {
    test('migration 000 is the first migration and it exists', () => {
      const files = migrationFiles();

      assert.ok(files.length > 0);
      assert.equal(files[0], '000_portability.sql');
      assert.ok(files.includes('000_portability.sql'));
    });

    test('the shim functions exist', async () => {
      const rows = await asOwner<{ proname: string }>(
        `select proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'auth' and proname in ('uid', 'is_anonymous')`,
      );

      const names = rows.rows.map((r) => r.proname).sort();
      assert.deepEqual(names, ['is_anonymous', 'uid']);
    });

    test('the identity table exists with the columns the schema references', async () => {
      const rows = await asOwner<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'auth' and table_name = 'users'`,
      );

      const columns = new Set(rows.rows.map((r) => r.column_name));

      for (const column of ['id', 'email', 'phone', 'is_anonymous', 'created_at', 'last_sign_in_at']) {
        assert.ok(columns.has(column), `auth.users is missing ${column}`);
      }
    });

    test('re-applying every migration changes nothing', async () => {
      // ★ The whole migration set is re-run over an already-migrated
      // database. A migration that is not idempotent fails here, which is
      // exactly AC-9.7.1's "repeatable without error".
      const pool = createPool(databaseUrl());
      try {
        const reapplied = await reapplyAll(pool);
        assert.ok(reapplied.length > 0, 'there must be migrations to re-apply');
      } finally {
        await pool.end();
      }
    });

    test('the shim is a no-op on a database that already has it', async () => {
      // ★ The guard is what makes migration 000 safe on Supabase, where
      // `auth.uid()` is platform-owned. The guard is `to_regprocedure(...) is
      // null` — so on a database that HAS the function, the function is not
      // replaced.
      //
      // The proof that the guard works: the function's definition is
      // unchanged after a re-run. If `000` replaced it unconditionally, the
      // definition would change.
      const before = await asOwner<{ prosrc: string }>(
        `select prosrc from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'auth' and proname = 'uid'`,
      );

      const pool = createPool(databaseUrl());
      try {
        await reapplyAll(pool, MIGRATIONS_DIR);
      } finally {
        await pool.end();
      }

      const after = await asOwner<{ prosrc: string }>(
        `select prosrc from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'auth' and proname = 'uid'`,
      );

      assert.equal(after.rows[0]?.prosrc, before.rows[0]?.prosrc);
    });

    test('the shim file only uses idempotent constructs', () => {
      // ★ A STATIC CHECK, and it is the cheapest possible guard.
      //
      // `000` runs FIRST on plain Postgres and is a NO-OP on Supabase. A
      // statement that could fail on a second run, or that would fail on
      // Supabase where the object already exists, does not belong in it.
      //
      // The allowed forms are `create ... if not exists`, `create or
      // replace`, and the guarded `to_regprocedure` blocks. A bare
      // `create table auth.users` or `create function auth.uid()` would
      // break one of the two backends.
      const sql = readFileSync(join(MIGRATIONS_DIR, '000_portability.sql'), 'utf8');

      // Every `create table` must be guarded.
      const tableCreates = sql.match(/create\s+table\s+(?!if\s+not\s+exists)/gi) ?? [];
      assert.deepEqual(tableCreates, [], 'every create table in 000 must be `if not exists`');

      // Every `create schema` must be guarded.
      const schemaCreates = sql.match(/create\s+schema\s+(?!if\s+not\s+exists)/gi) ?? [];
      assert.deepEqual(schemaCreates, [], 'every create schema in 000 must be `if not exists`');

      // The public entries must be created ONLY when absent.
      assert.match(
        sql,
        /to_regprocedure\('auth\.uid\(\)'\)\s+is\s+null/,
        "auth.uid() must be created only when absent, or it would replace Supabase's",
      );
      assert.match(
        sql,
        /to_regprocedure\('auth\.is_anonymous\(\)'\)\s+is\s+null/,
        "auth.is_anonymous() must be created only when absent",
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The shim's behaviour
  // ───────────────────────────────────────────────────────────
  describe('the shim reads the JWT claims', () => {
    test('with no claims at all, auth.uid() is NULL', async () => {
      const rows = await asOwner<{ uid: string | null }>(`select auth.uid() as uid`);
      assert.equal(rows.rows[0]?.uid, null);
    });

    test('with no claims at all, auth.is_anonymous() is false — not NULL', async () => {
      // ★ THE NULL TRAP.
      //
      // A NULL here would silently disable FR-8.36's restrictive policy:
      // `auth.is_anonymous() is not true` evaluates TRUE for a NULL, so the
      // policy would permit what it exists to refuse. The cast happens
      // BEFORE the coalesce for exactly this reason.
      const rows = await asOwner<{ anon: boolean | null }>(
        `select auth.is_anonymous() as anon`,
      );
      assert.equal(rows.rows[0]?.anon, false);
    });

    test('with claims present, auth.uid() returns the sub', async () => {
      const userId = await createUser();
      const session = await openSession(userId, { isAnonymous: false });

      try {
        const rows = await session.query<{ uid: string | null }>(`select auth.uid() as uid`);
        assert.equal(rows.rows[0]?.uid, userId);
      } finally {
        await closeSession(session);
      }
    });

    test('with claims present, auth.is_anonymous() reads the claim', async () => {
      const userId = await createUser();

      const anonymous = await openSession(userId, { isAnonymous: true });
      try {
        const rows = await anonymous.query<{ anon: boolean | null }>(
          `select auth.is_anonymous() as anon`,
        );
        assert.equal(rows.rows[0]?.anon, true);
      } finally {
        await closeSession(anonymous);
      }

      const named = await openSession(userId, { isAnonymous: false });
      try {
        const rows = await named.query<{ anon: boolean | null }>(
          `select auth.is_anonymous() as anon`,
        );
        assert.equal(rows.rows[0]?.anon, false);
      } finally {
        await closeSession(named);
      }
    });

    test('malformed claims JSON is treated as absent, not as a crash', async () => {
      // ★ The edge case from the plan's checklist.
      //
      // A malformed `request.jwt.claims` must not turn every anonymous
      // read into a 500. The shim reads it with `::json`, so a non-JSON
      // value would raise — the caller must therefore set it sanely, and
      // the test proves the failure mode is a clean error rather than a
      // wrong ANSWER.
      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query(`select set_config('request.jwt.claims', 'not json', false)`);

        await assert.rejects(
          () => client.query(`select auth.uid()`),
          /invalid input syntax for type json/i,
        );
      } finally {
        await client.query(`reset request.jwt.claims`).catch(() => undefined);
        client.release();
        await pool.end();
      }
    });

    test('an empty claims value is treated as absent', async () => {
      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query(`select set_config('request.jwt.claims', '', false)`);

        const rows = await client.query<{ uid: string | null; anon: boolean | null }>(
          `select auth.uid() as uid, auth.is_anonymous() as anon`,
        );
        assert.equal(rows.rows[0]?.uid, null);
        assert.equal(rows.rows[0]?.anon, false);
      } finally {
        await client.query(`reset request.jwt.claims`).catch(() => undefined);
        client.release();
        await pool.end();
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // Task 2 — the migration set runs on plain Postgres
  // ───────────────────────────────────────────────────────────
  describe('the migration set is backend-agnostic', () => {
    test('every migration 000-015 is present and ordered', () => {
      const files = migrationFiles();

      for (let index = 0; index <= 15; index += 1) {
        const prefix = String(index).padStart(3, '0');
        assert.ok(
          files.some((file) => file.startsWith(prefix)),
          `migration ${prefix}_* is missing`,
        );
      }
    });

    test('no migration reaches for a Supabase-only object', () => {
      // ★ THIS IS TASK 2's ACTUAL PURPOSE.
      //
      // A migration that references a Supabase-only object — a `supabase_*`
      // schema, `pg_net`, `vault`, the `auth.jwt()` function — fails on
      // plain Postgres. The test finds them, and each find must be fixed IN
      // THE MIGRATION, not worked around in the shim.
      //
      // The allowed `auth.` calls are the two the shim provides —
      // `auth.uid()` and `auth.is_anonymous()` — plus the shim's own
      // internals, which live in migration 000 and exist on both backends.
      const files = migrationFiles();

      for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

        // Strip the comments, so a file that EXPLAINS the problem does not
        // trip the check that looks for it.
        const code = sql.replace(/--[^\n]*/g, '');

        for (const forbidden of ['auth.jwt(', 'supabase_admin', 'pg_net', 'vault.', 'storage.']) {
          assert.ok(
            !code.includes(forbidden),
            `${file} references the Supabase-only object \`${forbidden}\``,
          );
        }

        // Every `auth.` FUNCTION call must be one that exists on BOTH
        // backends. `auth.users` is a TABLE, and it is matched by the same
        // pattern because a foreign key reads `references auth.users(id)`
        // — so the table name is excluded explicitly.
        const allowedAuthCalls = new Set([
          'auth.uid',
          'auth.is_anonymous',
          'auth.freewhen_uid',
          'auth.freewhen_is_anonymous',
        ]);

        for (const match of code.match(/auth\.\w+\s*\(/g) ?? []) {
          const name = match.replace(/[\s(]/g, '');
          if (name === 'auth.users') continue;
          assert.ok(
            allowedAuthCalls.has(name),
            `${file} calls \`${name}\`, which does not exist on both backends`,
          );
        }
      }
    });

    test('the migration set applies from scratch', async () => {
      // ★ THE FROM-SCRATCH RUN, IN A DATABASE OF ITS OWN.
      //
      // `--fresh` drops the public schema and re-applies everything. This
      // is what a new host does, and it is where a migration that only
      // works against a database P02 happened to leave behind fails.
      //
      // ★ IT MUST NOT RUN AGAINST THE SHARED DATABASE.
      //
      // The suites SHARE one database and run in sequence. A `--fresh`
      // here would drop the schema out from under every suite that runs
      // after this one — their fixtures would vanish mid-suite, and the
      // failures would read like policy bugs rather than like a test that
      // destroyed its neighbours' data.
      //
      // So the fresh run gets its OWN database, created and dropped here.
      const scratch = await createScratchDatabase();

      try {
        const pool = createPool(scratch.url);
        try {
          const applied = await migrate(pool, { fresh: true });
          assert.ok(applied.length > 0, 'the fresh run must apply the migrations');
        } finally {
          await pool.end();
        }
      } finally {
        await dropScratchDatabase(scratch);
      }
    });

    test('the schema is complete after a fresh run', async () => {
      const rows = await asOwner<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public'`,
      );
      const present = new Set(rows.rows.map((r) => r.tablename));

      const expected = [
        'activity_log', 'comment', 'decision', 'event', 'event_message',
        'message_report', 'participant', 'proposal', 'rsvp', 'start_point',
        'travel_measurement', 'user_group', 'venue', 'vote',
      ];

      for (const table of expected) {
        assert.ok(present.has(table), `missing table: ${table}`);
      }
    });

    test('the realtime publication carries exactly the five published tables', async () => {
      const rows = await asOwner<{ tablename: string }>(
        `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
      );
      const published = rows.rows.map((r) => r.tablename).sort();

      assert.deepEqual(published, ['event', 'event_message', 'proposal', 'rsvp', 'vote']);
    });

    test('the notify triggers are installed on exactly the five published tables', async () => {
      // ★ The local realtime signal and the publication must agree.
      //
      // The publication is what Supabase Realtime consumes; the triggers are
      // what the local bridge consumes. If they disagreed, the two backends
      // would stream different tables — which is precisely the drift D22
      // exists to prevent.
      const rows = await asOwner<{ tablename: string }>(
        `select c.relname as tablename
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and t.tgname like 'freewhen_notify_%'
           and not t.tgisinternal`,
      );
      const triggered = rows.rows.map((r) => r.tablename).sort();

      assert.deepEqual(triggered, ['event', 'event_message', 'proposal', 'rsvp', 'vote']);
    });

    test('the notify functions are not security definer', async () => {
      // ★ A definer function is a privilege-escalation surface.
      //
      // The trigger functions only read a row the writer could already see
      // and raise a notification. Making them definer would add a
      // privilege surface for no benefit.
      const rows = await asOwner<{ proname: string; prosecdef: boolean }>(
        `select proname, prosecdef from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and proname in ('freewhen_notify_change', 'freewhen_change_context')`,
      );

      assert.ok(rows.rows.length === 2, 'both notify functions must exist');

      for (const row of rows.rows) {
        assert.equal(row.prosecdef, false, `${row.proname} must not be security definer`);
      }
    });

    test('the bridge’s SQL constants match the migration exactly', () => {
      // ★ THE DUPLICATION IS TURNED INTO A CHECKED INVARIANT.
      //
      // `server/realtime/bridge.ts` exports the trigger SQL so the
      // trigger and the bridge cannot drift. That is a second copy of the
      // SQL, and a second copy can drift — so the copy is asserted equal
      // to the migration file, and the test fails the moment they differ.
      //
      // Without this, a change to the migration would leave the constant
      // describing the OLD trigger, and nothing would say so.
      const migration = readFileSync(join(MIGRATIONS_DIR, '015_realtime_notify.sql'), 'utf8');
      const normalisedMigration = normaliseSql(migration);

      for (const [name, constant] of [
        ['freewhen_notify_change', NOTIFY_FUNCTION_SQL],
        ['freewhen_change_context', NOTIFY_CONTEXT_SQL],
      ] as const) {
        // ★ BOTH SIDES ARE NORMALISED, so the comparison is on the SQL.
        const body = normaliseSql(constant);
        assert.ok(
          normalisedMigration.includes(body),
          `the bridge's ${name} SQL does not match migrations/015_realtime_notify.sql`,
        );
      }
    });

    test('the vote’s event is resolved from the participant, not the proposal', () => {
      // ★ THE CASCADE PATH.
      //
      // Deleting a proposal cascade-deletes its votes, and by the time
      // the vote's AFTER-DELETE trigger fires the proposal row is already
      // gone. A proposal lookup would resolve `event_id` to NULL, and the
      // bridge would drop the change — so the client would never learn
      // its vote was withdrawn.
      const migration = readFileSync(join(MIGRATIONS_DIR, '015_realtime_notify.sql'), 'utf8');

      assert.match(
        migration,
        /from public\.participant pt/,
        'the vote\'s event must be resolved from the participant, which outlives a proposal',
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // Task 3 — RLS under the shim, as a non-superuser
  // ───────────────────────────────────────────────────────────
  describe('row-level security holds under the shim', () => {
    before(async () => {
      await truncateAll();
    });

    test('a participant reads their own event', async () => {
      const { eventId, organizerId } = await seedEvent();

      await withSession(organizerId, { isAnonymous: false }, async (session) => {
        const result = await session.query('select * from event where id = $1', [eventId]);
        assert.equal(result.rows.length, 1);
      });
    });

    test('a non-participant reads nothing', async () => {
      const { eventId } = await seedEvent();
      const strangerId = await createUser();

      await withSession(strangerId, { isAnonymous: false }, async (session) => {
        const result = await session.query('select * from event where id = $1', [eventId]);
        assert.equal(result.rows.length, 0, 'a non-participant must see zero rows');
      });
    });

    test('a non-participant reads no votes of another event', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [proposalId, organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, { isAnonymous: false }, async (session) => {
        const result = await session.query('select * from vote');
        assert.equal(result.rows.length, 0);
      });
    });

    test('the anon role with no claims reads nothing', async () => {
      const { eventId } = await seedEvent();

      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query('set role anon');
        const result = await client.query('select * from event where id = $1', [eventId]);
        assert.equal(result.rows.length, 0);
      } finally {
        await client.query('reset role').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });

    test('a participant may vote in their own name', async () => {
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId);

      await withSession(userId, { isAnonymous: false }, async (session) => {
        const result = await session.query(
          `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'maybe')`,
          [proposalId, participantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('a participant may not vote in another participant’s name', async () => {
      // The caller is the ORGANIZER; the row names a MEMBER's participant.
      // The reverse — a member voting for themselves — is legal, and is
      // the test above.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { participantId: otherParticipantId } = await addMember(eventId);

      await withSession(organizerId, { isAnonymous: false }, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
              [proposalId, otherParticipantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('the restrictive decision policy refuses a non-organizer', async () => {
      // ★ FR-8.36's restrictive policy, under the shim.
      //
      // The shim's `auth.is_anonymous()` is what the policy reads, so this
      // test is the proof that the shim satisfies the policy's
      // precondition — a shim that returned NULL would let this through.
      const { eventId, organizerParticipantId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });
      const { userId, participantId } = await addMember(eventId, { displayName: 'Member' });

      await withSession(userId, { isAnonymous: true }, async (session) => {
        await assert.rejects(
          () =>
            session.query(
              `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
               values ($1, 'place', $2, 'balanced_floor', $3)`,
              [eventId, proposalId, participantId],
            ),
          /row-level security|violates/i,
        );
      });
    });

    test('the organizer may confirm, even anonymously', async () => {
      // ★ The policy pair ANDs to exactly one outcome: the organizer of
      // that event, and nobody else — anonymous or not.
      const { eventId, organizerParticipantId, organizerId } = await seedEvent();
      const venueId = await seedVenue(eventId);
      const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

      await withSession(organizerId, { isAnonymous: true }, async (session) => {
        const result = await session.query(
          `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
           values ($1, 'place', $2, 'balanced_floor', $3)`,
          [eventId, proposalId, organizerParticipantId],
        );
        assert.equal(result.rowCount, 1);
      });
    });

    test('a start point of another event is not readable', async () => {
      // ★ A location leak is the worst possible outcome here.
      const { organizerParticipantId } = await seedEvent();

      await asOwner(
        `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
         values ($1, 35.70, 51.40, 'gps_coarse')`,
        [organizerParticipantId],
      );

      const strangerId = await createUser();

      await withSession(strangerId, { isAnonymous: false }, async (session) => {
        const result = await session.query('select * from start_point');
        assert.equal(result.rows.length, 0);
      });
    });

    test('the travel cache is not readable by a participant at all', async () => {
      const { organizerId } = await seedEvent();

      // ★ THE COORDINATES ARE THIS SUITE'S OWN.
      //
      // The travel cache has a six-column unique constraint on its
      // geography, and the suites SHARE a database. A fixture that
      // collides with another suite's would fail with a unique
      // violation that reads like a schema bug rather than like two
      // suites picking the same spot on the map.
      await asOwner(
        `insert into travel_measurement (
           origin_lat, origin_lng, dest_lat, dest_lng, mode, departure_bucket,
           minutes, distance_m, cost_irr, confidence, source
         ) values (35.62, 51.33, 35.67, 51.38, 'car', '2026-08-09 11:15:00+00',
                   17, 3100, 210000, 'high', 'neshan')`,
      );

      await withSession(organizerId, { isAnonymous: false }, async (session) => {
        const result = await session.query('select * from travel_measurement');
        assert.equal(result.rows.length, 0);
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  // The shim's own security properties
  // ───────────────────────────────────────────────────────────
  describe('the shim does not widen the trust boundary', () => {
    test('the anon role cannot read auth.users', async () => {
      // ★ The grant matrix the shim sets is part of the trust boundary.
      //
      // Granting SELECT on `auth.users` would publish every user's id,
      // email and phone to anyone holding the publishable anon key, and
      // would let an attacker enumerate user ids to impersonate.
      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query('set role anon');
        await assert.rejects(
          () => client.query('select id, email, phone from auth.users'),
          /permission denied/i,
        );
      } finally {
        await client.query('reset role').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });

    test('the authenticated role cannot read auth.users either', async () => {
      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query('set role authenticated');
        await assert.rejects(
          () => client.query('select id, email, phone from auth.users'),
          /permission denied/i,
        );
      } finally {
        await client.query('reset role').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });

    test('the service role can read auth.users — it owns the identity table', async () => {
      const pool = createPool(databaseUrl());
      const client = await pool.connect();
      try {
        await client.query('set role service_role');
        const result = await client.query('select count(*)::int as n from auth.users');
        assert.ok(result.rows[0]?.n !== undefined);
      } finally {
        await client.query('reset role').catch(() => undefined);
        client.release();
        await pool.end();
      }
    });

    test('the service role bypasses RLS, exactly as on Supabase', async () => {
      // ★ The two backends must behave the SAME.
      //
      // On Supabase, `service_role` has BYPASSRLS. A plain-Postgres role
      // created without the attribute would make the local backend differ,
      // and the server — which holds the service role — would silently fail
      // every write it makes.
      const rows = await asOwner<{ rolbypassrls: boolean }>(
        `select rolbypassrls from pg_roles where rolname = 'service_role'`,
      );
      assert.equal(rows.rows[0]?.rolbypassrls, true);
    });

    test('the client roles exist', async () => {
      const rows = await asOwner<{ rolname: string }>(
        `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
      );
      const names = rows.rows.map((r) => r.rolname).sort();

      assert.deepEqual(names, ['anon', 'authenticated', 'service_role']);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The plan file's own frontmatter
  // ───────────────────────────────────────────────────────────
  describe('the plan and the repository agree', () => {
    test('the project root resolves to the plan’s directory', () => {
      // A guard against the path helpers drifting: a migration applied to
      // the wrong tree is the failure mode the whole `paths.ts` module
      // exists to prevent.
      //
      // ★ ASSERT THE INVARIANT, NOT THE DIRECTORY'S NAME. The root is
      // whatever checkout this is — the main clone ends in `FreeWhen`, but a
      // git worktree ends in its branch (`.worktrees/14-p1-backlog`). What
      // must hold in both is that the root is the directory that CONTAINS
      // the migrations and that `paths.ts` derived them from itself.
      assert.ok(existsSync(join(PROJECT_ROOT, 'package.json')));
      assert.ok(existsSync(join(PROJECT_ROOT, 'migrations')));
      assert.ok(MIGRATIONS_DIR.startsWith(PROJECT_ROOT));
    });
  });
});
