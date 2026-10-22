/**
 * A live proof that the local token service's token works against PostgREST.
 *
 * This is the acceptance criterion "a locally-issued token and a
 * Supabase-issued token pass the same validator" — proven end to end
 * against a real PostgREST with real RLS, not against a stub.
 *
 * Run manually against the compose stack:
 *   docker-compose -f docker-compose.local.yml up -d
 *   LOCAL_PGREST_URL=http://127.0.0.1:3001 npm run test -- backend/live
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { signToken, verifyToken } from '../../server/auth/tokens';

const PGREST_URL = process.env.LOCAL_PGREST_URL ?? 'http://127.0.0.1:3001';
const SECRET = process.env.JWT_SECRET ?? 'local-dev-jwt-secret-long-enough-for-postgrest';
const USER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Whether the local stack is running.
 *
 * ★ The suite SKIPS when it is not.
 *
 * The stack needs a database and a PostgREST container, which the unit
 * test run cannot assume. A suite that failed on their absence would
 * break `npm run test` for every contributor, so the suite skips and says
 * so — loudly enough that a CI job that MEANT to run it can require it.
 */
async function stackIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${PGREST_URL}/`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

describe('the local backend, live', () => {
  // ★ The stack's availability is checked ONCE, in `before`, and the
  // tests that need it call `t.skip()`.
  //
  // A `skip` OPTION would be evaluated when the test is registered —
  // before `before` has run — so every test would skip. `t.skip()` is
  // called from inside the test, which is the only point at which the
  // answer is known.
  const state = { stackUp: false };

  before(async () => {
    state.stackUp = await stackIsUp();

    if (!state.stackUp) {
      console.log(
        `# backend/live: skipped — no local stack at ${PGREST_URL}. ` +
          'Start it with: docker-compose -f docker-compose.local.yml up -d',
      );
    }
  });

  test('PostgREST is reachable', async (t) => {
    if (!state.stackUp) {
      t.skip('no local stack running');
      return;
    }

    const response = await fetch(`${PGREST_URL}/`);

    assert.equal(response.status, 200);
  });

  test('a locally-issued token is accepted by PostgREST', async (t) => {
    if (!state.stackUp) {
      t.skip('no local stack running');
      return;
    }
    // ★ THE END-TO-END PROOF.
    //
    // PostgREST validates the bearer JWT, sets `request.jwt.claims` from
    // it, and the `auth.uid()` shim reads that GUC. If any of the three
    // disagreed — the claim names, the secret, or the GUC — this request
    // would 401.
    const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);

    const response = await fetch(`${PGREST_URL}/event?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.notEqual(response.status, 401, 'PostgREST must accept the token');

    // The claims PostgREST reads are the ones the shim reads.
    const claims = verifyToken(token, SECRET);
    assert.equal(claims.role, 'authenticated');
    assert.equal(claims.is_anonymous, true);
  });

  test('PostgREST returns zero rows for an unauthenticated request', async (t) => {
    if (!state.stackUp) {
      t.skip('no local stack running');
      return;
    }

    // ★ THE DENIAL IS "ZERO ROWS", NOT AN ERROR.
    //
    // A denied read returns an empty array with a 200 — that is what
    // makes AC-9.3.1's "zero rows" assertion meaningful rather than a
    // permission error in disguise. The `anon` role has SELECT on every
    // table (so the denial comes from the POLICY, not from a missing
    // grant), and no policy matches a caller with no claims.
    const response = await fetch(`${PGREST_URL}/event?select=id&limit=1`);

    assert.equal(response.status, 200);

    const body = (await response.json()) as unknown[];
    assert.deepEqual(body, [], 'an unauthenticated caller must see zero rows');
  });

  test('PostgREST refuses a token signed with the wrong secret', async (t) => {
    if (!state.stackUp) {
      t.skip('no local stack running');
      return;
    }

    const { token } = signToken(
      { sub: USER_ID, is_anonymous: true },
      'a-completely-different-secret-that-is-long-enough',
    );

    const response = await fetch(`${PGREST_URL}/event?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 401, 'a foreign-signed token must be refused');
  });

  test('the auth schema is not exposed through PostgREST', async (t) => {
    if (!state.stackUp) {
      t.skip('no local stack running');
      return;
    }

    // ★ `auth.users` holds every user's id, email and phone. Exposing the
    // schema would publish it to anyone holding the anon key.
    const response = await fetch(`${PGREST_URL}/auth/users?select=id&limit=1`);

    assert.notEqual(response.status, 200, 'the auth schema must not be served');
  });
});
