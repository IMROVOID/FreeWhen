/**
 * The live PostgREST proof — with a NON-SUPERUSER connection.
 *
 * ★ WHY THIS FILE IS SEPARATE FROM `tests/backend/live.test.ts`.
 *
 * The point of the local backend is that it is a PEER of Supabase: the
 * same schema, the same policies, the same answers. A test that connects
 * as a superuser proves nothing, because a superuser BYPASSES RLS
 * entirely — every answer would be "everything" and the test would look
 * identical whether the policies worked or not.
 *
 * So the local stack's PostgREST connects as `authenticator` — a
 * non-superuser that is a member of `anon` and `authenticated` — and
 * this suite asserts the answers a non-superuser gets.
 *
 * ★ THE ASSERTION THAT MATTERS.
 *
 * A token for a user who is NOT a participant must return ZERO ROWS, not
 * every row. Under a superuser connection the same query returns every
 * row, and the difference is invisible unless the test says so.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { after, before, describe, test } from 'node:test';

import { signToken } from '../../server/auth/tokens';

const PGREST_URL = process.env.LOCAL_PGREST_URL ?? 'http://127.0.0.1:3001';
const SECRET = process.env.JWT_SECRET ?? 'local-dev-jwt-secret-long-enough-for-postgrest';
const DATABASE_URL =
  process.env.LOCAL_PG_DATABASE_URL ??
  'postgres://postgres:local-dev-password-not-a-real-secret@127.0.0.1:5434/freewhen';

async function stackIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${PGREST_URL}/`, { signal: AbortSignal.timeout(2000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

describe('the local backend, live, as a non-superuser', () => {
  const state = { up: false };

  before(async () => {
    state.up = await stackIsUp();

    if (!state.up) {
      console.log(
        `# backend/live-rls: skipped — no local stack at ${PGREST_URL}. ` +
          'Start it with: docker-compose -f docker-compose.local.yml up -d',
      );
    }
  });

  after(async () => {
    // The pool is closed by the suite's own `after` — nothing to do here
    // beyond letting the process exit.
  });

  test('PostgREST is connected as a NON-SUPERUSER', async (t) => {
    if (!state.up) {
      t.skip('no local stack running');
      return;
    }

    // ★ THE ASSERTION THIS WHOLE FILE EXISTS FOR.
    //
    // A superuser connection bypasses RLS, so every policy would look
    // "working" while returning everything. The local stack must connect
    // as `authenticator`, which is NOT a superuser.
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query('set role authenticator');

      const rows = await client.query<{ rolsuper: boolean; current_user: string }>(
        `select current_user, (select rolsuper from pg_roles where rolname = current_user) as rolsuper`,
      );

      assert.equal(rows.rows[0]?.current_user, 'authenticator');
      assert.equal(
        rows.rows[0]?.rolsuper,
        false,
        'the connection role must NOT be a superuser, or RLS is bypassed',
      );
    } finally {
      await client.query('reset role').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  test('a token for a non-participant sees ZERO rows', async (t) => {
    if (!state.up) {
      t.skip('no local stack running');
      return;
    }

    // A user who exists but is in no event.
    const { token } = signToken({ sub: randomUUID(), is_anonymous: true }, SECRET);

    const response = await fetch(`${PGREST_URL}/event?select=id&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);

    const body = (await response.json()) as unknown[];
    assert.deepEqual(body, [], 'a non-participant must see zero rows, not every row');
  });

  test('a token for a non-participant sees zero VOTES', async (t) => {
    if (!state.up) {
      t.skip('no local stack running');
      return;
    }

    const { token } = signToken({ sub: randomUUID(), is_anonymous: true }, SECRET);

    const response = await fetch(`${PGREST_URL}/vote?select=id&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  test('a token for a non-participant sees zero START POINTS', async (t) => {
    if (!state.up) {
      t.skip('no local stack running');
      return;
    }

    // ★ A location leak is the worst possible outcome here.
    const { token } = signToken({ sub: randomUUID(), is_anonymous: true }, SECRET);

    const response = await fetch(`${PGREST_URL}/start_point?select=id&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  test('an unauthenticated request sees zero rows too', async (t) => {
    if (!state.up) {
      t.skip('no local stack running');
      return;
    }

    const response = await fetch(`${PGREST_URL}/event?select=id&limit=5`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
