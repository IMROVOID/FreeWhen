/**
 * The database test support layer.
 *
 * ★ THE MOST IMPORTANT RULE IN THIS FILE: RLS is tested as a NON-SUPERUSER
 * role with claims set, never as the service role.
 *
 * A superuser and the service role both bypass RLS entirely. An RLS test
 * run with them passes while every policy is broken, and hides the bug until
 * production (PRD-09 §13.9, PRD-12 §4).
 *
 * The mechanism: a connection is taken, the `request.jwt.claims` GUC is set
 * for the session, and `set role authenticated` is issued. The policies then
 * see a real caller.
 */

import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { createPool, databaseUrl, loadDotEnv } from '../../scripts/db/client';

export { databaseUrl, loadDotEnv };

let sharedPool: Pool | undefined;

/** One pool for the whole suite — the fixtures are not cheap to rebuild. */
export function pool(): Pool {
  if (!sharedPool) {
    sharedPool = createPool(databaseUrl());
  }
  return sharedPool;
}

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}

/**
 * A client whose session carries a JWT and runs as the `authenticated` role.
 *
 * This is what an ordinary participant's request looks like to the
 * database: RLS applies, and the caller is identified by `auth.uid()`.
 */
export interface Session {
  /** Runs a query as the identified, RLS-subject caller. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
  /** The caller's auth.users id. */
  readonly userId: string;
  /** The underlying client — released by `closeSession`. */
  readonly client: PoolClient;
}

/**
 * Opens a session for a given user id.
 *
 * `isAnonymous` mirrors the JWT's `is_anonymous` claim, which the
 * restrictive `decision` policy reads.
 */
export async function openSession(
  userId: string,
  options: { isAnonymous?: boolean; role?: 'anon' | 'authenticated' | 'service' } = {},
): Promise<Session> {
  const { isAnonymous = true, role = 'authenticated' } = options;
  const client = await pool().connect();

  const claims = JSON.stringify({
    sub: userId,
    role: 'authenticated',
    is_anonymous: isAnonymous,
  });

  await client.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);

  // ★ `service` MAPS TO THE `service_role` DATABASE ROLE.
  //
  // It is not a member of `authenticated` and it is not a member of `anon`, so
  // `set role` cannot reach it directly — the role must be GRANTED first, and
  // the grant is made permanent here because a test session that cannot set
  // the role cannot test the function the way the server calls it.
  if (role === 'service') {
    await asOwner(`grant service_role to current_user`);
    await client.query(`set role service_role`);
  } else {
    await client.query(`set role ${role}`);
  }

  return {
    userId,
    client,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}

/**
 * Releases a session's client.
 *
 * ★ The role MUST be reset. `set role` and the `request.jwt.claims` GUC
 * persist for the life of the connection, and a pooled connection is reused:
 * without the reset, the next borrower of that connection would inherit the
 * previous caller's identity and RLS context. That turns the suite's own
 * owner queries into permission failures — and, worse, would let one test's
 * identity leak into another.
 */
export async function closeSession(session: Session): Promise<void> {
  try {
    await session.client.query('reset role');
    await session.client.query('reset request.jwt.claims');
  } catch {
    // A broken connection cannot be reset; it is discarded on release.
  }
  session.client.release();
}

/** A session with no claims at all — the unauthenticated caller. */
export async function openAnonymousSession(): Promise<Session> {
  const client = await pool().connect();
  await client.query(`set role anon`);
  await client.query(`reset request.jwt.claims`);

  return {
    userId: '',
    client,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}

/**
 * Runs a query as the schema owner — for SETUP, never for assertions.
 *
 * ★ The role is reset on the SAME connection before the query runs.
 *
 * `set role` persists for the life of a connection, and pooled connections
 * are reused. A session that does not clean up after itself would otherwise
 * leave the next borrower running as `authenticated`, and the owner query
 * would fail with a permission error that has nothing to do with the test.
 */
export async function asOwner<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const attempts = 5;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = await pool().connect();
    try {
      await client.query('reset role');
      await client.query('reset request.jwt.claims');
      const result = await client.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      // ★ A DEADLOCK IS TRANSIENT, SO IT IS RETRIED.
      //
      // The suite's pool and the server's own pool are separate connection
      // sets against the same database. A transaction in one that holds a row
      // lock — `join_event` takes an `event` lock with `for update` — and a
      // statement in the other that wants the same row wait for each other,
      // and Postgres resolves the cycle by aborting one of them.
      //
      // The loser is rolled back and can simply try again, so a retry is the
      // correct remedy. Without it, a healthy suite fails intermittently on a
      // lock race that has nothing to do with the code under test.
      const isDeadlock =
        error instanceof Error &&
        (error.message.includes('deadlock detected') ||
          (error as { code?: string }).code === '40P01');

      if (!isDeadlock || attempt === attempts) throw error;

      await new Promise((resolve) => setTimeout(resolve, attempt * 50));
    } finally {
      client.release();
    }
  }

  // The loop either returns or throws; this satisfies the type checker.
  throw new Error('asOwner exhausted its retries without returning or throwing');
}

/** A row id, so every fixture is addressable and cleanable. */
export function id(): string {
  return randomUUID();
}

/**
 * Creates an auth user and returns its id.
 */
export async function createUser(options: { isAnonymous?: boolean } = {}): Promise<string> {
  const userId = id();
  await asOwner(
    `insert into auth.users (id, is_anonymous) values ($1, $2)`,
    [userId, options.isAnonymous ?? true],
  );
  return userId;
}

/**
 * Creates an event with an organizer, and returns the ids.
 *
 * ★ THE DEFAULT WINDOW OPENS AT `now`, NOT AT `now + 1 day`.
 *
 * The suites' slot fixtures pin a start to 18:00 UTC one day ahead and assert
 * it is accepted. With a window that opened at `now + 1 day` — the same
 * calendar day but the CURRENT time of day — a run after 18:00 UTC proposed a
 * slot that began before its own window opened, and the server correctly
 * answered 422 `slotOutOfWindow`. Seventeen voting tests failed for a reason
 * that depended on the hour the suite was run rather than on the code.
 *
 * Opening the default window at `now` makes every in-window fixture legal at
 * any hour. A test that needs a window NOT containing its slot still passes
 * one explicitly, which is the only case where the distinction matters.
 */
export async function seedEvent(
  options: {
    organizerId?: string;
    title?: string;
    status?: string;
    inviteTokenHash?: string | null;
    inviteExpiresAt?: string | null;
    windowStart?: string;
    windowEnd?: string;
  } = {},
): Promise<{ eventId: string; organizerId: string; organizerParticipantId: string }> {
  const organizerId = options.organizerId ?? (await createUser());
  const eventId = id();

  await asOwner(
    `insert into event (
       id, title, activity_type, date_window_start, date_window_end,
       status, home_tz, created_by, invite_token_hash, invite_expires_at
     ) values ($1, $2, 'dinner', $3, $4, $5, 'Asia/Tehran', $6, $7, $8)`,
    [
      eventId,
      options.title ?? 'Test event',
      options.windowStart ?? new Date(Date.now()).toISOString(),
      options.windowEnd ?? new Date(Date.now() + 4 * 86_400_000).toISOString(),
      options.status ?? 'OPEN',
      organizerId,
      options.inviteTokenHash ?? null,
      options.inviteExpiresAt ?? null,
    ],
  );

  const organizerParticipantId = id();
  await asOwner(
    `insert into participant (id, event_id, auth_user_id, display_name, role)
     values ($1, $2, $3, 'Organizer', 'organizer')`,
    [organizerParticipantId, eventId, organizerId],
  );

  return { eventId, organizerId, organizerParticipantId };
}

/**
 * Adds a member to an event.
 */
export async function addMember(
  eventId: string,
  options: { userId?: string; displayName?: string; role?: string } = {},
): Promise<{ userId: string; participantId: string }> {
  const userId = options.userId ?? (await createUser());
  const participantId = id();

  await asOwner(
    `insert into participant (id, event_id, auth_user_id, display_name, role)
     values ($1, $2, $3, $4, $5)`,
    [
      participantId,
      eventId,
      userId,
      options.displayName ?? `Member ${participantId.slice(0, 4)}`,
      options.role ?? 'member',
    ],
  );

  return { userId, participantId };
}

/** Creates a proposal of the given type. */
export async function seedProposal(
  eventId: string,
  createdBy: string,
  options: { type?: string; venueId?: string; startUtc?: string; title?: string } = {},
): Promise<string> {
  const proposalId = id();
  const type = options.type ?? 'PLACE';

  await asOwner(
    `insert into proposal (id, event_id, created_by, type, title, venue_id, start_utc)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      proposalId,
      eventId,
      createdBy,
      type,
      options.title ?? `Proposal ${proposalId.slice(0, 4)}`,
      options.venueId ?? null,
      options.startUtc ?? null,
    ],
  );

  return proposalId;
}

/** Creates a venue. */
export async function seedVenue(
  eventId: string,
  options: { name?: string; lat?: number; lng?: number } = {},
): Promise<string> {
  const venueId = id();

  await asOwner(
    `insert into venue (id, event_id, name, lat, lng) values ($1, $2, $3, $4, $5)`,
    [
      venueId,
      eventId,
      options.name ?? `Venue ${venueId.slice(0, 4)}`,
      options.lat ?? 35.7,
      options.lng ?? 51.4,
    ],
  );

  return venueId;
}

/**
 * Removes every row the suite created, so the tests are independent.
 *
 * The deadlock retry lives in `asOwner`, which every statement in this file
 * goes through.
 */
export async function truncateAll(): Promise<void> {
  await asOwner(`
    truncate table
      vote, comment, rsvp, activity_log, event_message, message_report,
      decision, proposal, start_point, venue, participant, event, travel_measurement
    restart identity cascade;
  `);
  await asOwner(`delete from auth.users`);
}

/**
 * Runs the suite's bodies one at a time.
 *
 * ★ The tests SHARE one database, so they must not overlap.
 *
 * Node's test runner runs the suites and their bodies CONCURRENTLY. A
 * `beforeEach` truncation in one suite would then delete the fixtures of a
 * test that is still running in another — which surfaces as a foreign-key
 * violation for a row that existed a moment ago, and reads like a schema
 * bug.
 *
 * The suite files set `concurrency: false` for this reason; this helper is
 * the belt to that braces, and it is what a test file uses when it needs
 * its own ordering.
 */
export async function serial<T>(body: () => Promise<T>): Promise<T> {
  const previous = serialChain;
  let release!: () => void;
  serialChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await body();
  } finally {
    release();
  }
}

let serialChain: Promise<void> = Promise.resolve();
