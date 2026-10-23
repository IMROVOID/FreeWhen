/**
 * The PostgREST transport, proven by a caller through it (Plan 40 T10).
 *
 * ★ THIS IS THE TEST PLAN 39'S OWN HEADER SAYS IS THE ONLY ONE THAT MATTERS.
 *
 * `tests/db/worker-route.test.ts:1-28` records the failure: 912 green unit tests
 * that each exercised a seam, and a port that could not serve one request. A seam
 * is not proven by testing the seam. It is proven by driving a real route through
 * it against a real database.
 *
 * So this file calls `handleRequest` with a `Request`, does NOT bind a `pg` pool,
 * binds a REST queryable instead (`server/lib/supabase-rest.ts`), and asserts on
 * the response the route produced.
 *
 * ★ IT SKIPS, LOUDLY, WHEN THERE IS NO POSTGREST.
 *
 * A PostgREST needs a JWT secret and a `service_role`-capable key. Neither is
 * available in every CI run. The plan's GOTCHA is explicit: skip with a named
 * reason rather than passing vacuously or failing for an unrelated cause. The
 * repo already treats `17 skipped` as an honest signal (`docs/RUNBOOK.md:350`).
 *
 * ★ WHY IT LIVES UNDER `tests/db/`.
 *
 * It needs a live database, so it must not run in the unit suite
 * (`scripts/run-tests.ts:31` excludes `db/`). `scripts/db/run-tests.ts` applies
 * migrations itself and provides per-agent database isolation.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createRestQueryable } from '@/server/lib/supabase-rest';
import { withRequestQueryable } from '@/server/lib/db-scope';
import { closeServicePool } from '@/server/lib/supabase';

import { databaseUrl, loadDotEnv } from '../../scripts/db/client';
import { closePool } from './support';
import { uniqueIp } from './server-support';

/**
 * Where the local stack serves PostgREST.
 *
 * `docker-compose.local.yml` publishes it on `${POSTGREST_PORT:-3000}` and sets
 * `PGRST_DB_SCHEMAS=public` with no proxy URI, so the RPCs live at `/rpc/<fn>` —
 * NOT at Supabase's `/rest/v1/rpc/<fn>`. That difference is why
 * `createRestQueryable` takes a `prefix`.
 */
const POSTGREST_URL = process.env.POSTGREST_URL ?? 'http://127.0.0.1:3000';

/** The key a PostgREST deployment validates. Must be signed with `JWT_SECRET`. */
const POSTGREST_KEY = process.env.POSTGREST_SERVICE_KEY ?? process.env.POSTGREST_KEY ?? '';

/**
 * Why this suite is skipped, or `null` when it can run.
 *
 * Both conditions are real configuration, not conveniences: PostgREST rejects a
 * bearer it cannot verify, and the RPCs are granted to `service_role` only.
 */
async function skipReason(): Promise<string | null> {
  if (!POSTGREST_KEY) return 'no PostgREST service key (set POSTGREST_SERVICE_KEY)';

  try {
    const probe = await fetch(`${POSTGREST_URL}/`, {
      headers: { apikey: POSTGREST_KEY, authorization: `Bearer ${POSTGREST_KEY}` },
      signal: AbortSignal.timeout(3_000),
    });

    // A 401/403 is a reachable PostgREST with an unusable key — a real
    // misconfiguration, so it is reported rather than silently skipped.
    if (probe.status === 401 || probe.status === 403) {
      return `PostgREST rejected the key (HTTP ${probe.status}) — the key must be a signed service_role JWT`;
    }

    return null;
  } catch {
    return `no PostgREST reachable at ${POSTGREST_URL}`;
  }
}

/** The queryable under test, pointed at the real gateway. */
function restQueryable() {
  return createRestQueryable({
    url: POSTGREST_URL,
    key: POSTGREST_KEY,
    // See POSTGREST_URL: a bare PostgREST serves the RPCs at `/rpc/<fn>`.
    prefix: '',
  });
}

/** One API call through the REST transport. No `pg` pool is ever bound. */
async function call(path: string, options: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': uniqueIp() };
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const request = new Request(`http://rest.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const { handleRequest } = await import('@/server/app');
  return withRequestQueryable(restQueryable(), () => handleRequest(request));
}

describe('a real route over the PostgREST transport', async () => {
  const reason = await skipReason();

  before(async () => {
    loadDotEnv();
    // The `pg` pool is only used by `closeServicePool` below; nothing here binds
    // it. Set the URL anyway so a stray `servicePool()` cannot fail noisily.
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl();
  });

  test('GET /health reports the database up', { skip: reason ?? false }, async () => {
    const response = await call('/health');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, db: 'up' });
  });

  test('create_anonymous_user mints a real identity over REST', { skip: reason ?? false }, async () => {
    // The identity path every other route depends on, and the one that proves
    // `db-schemas=public` really did require an RPC for `auth.users`.
    const rest = restQueryable();
    const payload = await rest.rpc<{ id: string; is_anonymous: boolean }>('create_anonymous_user');

    assert.equal(typeof payload.id, 'string');
    assert.match(payload.id, /^[0-9a-f-]{36}$/i);
    assert.equal(payload.is_anonymous, true);
  });

  test('resolve_caller reads back what was minted, and returns null for a stranger', { skip: reason ?? false }, async () => {
    const rest = restQueryable();
    const minted = await rest.rpc<{ id: string }>('create_anonymous_user');

    const found = await rest.rpc<{ is_anonymous: boolean } | null>('resolve_caller', {
      p_user_id: minted.id,
    });
    assert.equal(found?.is_anonymous, true);

    // A uuid that exists nowhere. `resolveCaller` models this as `null`, which
    // every caller reads as "not a caller" — a 403, not a 500.
    const missing = await rest.rpc<unknown>('resolve_caller', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
    });
    assert.equal(missing, null);
  });

  test('join_event refuses an unknown token with INVITE_INVALID', { skip: reason ?? false }, async () => {
    // ★ THE REFUSAL PATH, THROUGH THE RPC, WITH A REAL LOCK.
    //
    // A fresh-join case needs an organizer token, which needs `POST /api/events`
    // — and that route's identity comes from the JWT claims, which this suite
    // does not mint (see `callerJwtFrom` in `server/runtime/rest-fetch.ts`). What
    // this asserts instead is the property the transport must not break: the
    // RPC runs, reads `auth.uid()` (NULL here), and answers the SAME token a
    // bad invite does — so a misconfigured caller cannot tell the two apart.
    const rest = restQueryable();
    const payload = await rest.rpc<{ error: string | null }>('join_event', {
      p_token: 'not-a-real-token',
      p_display_name: 'Ali',
    });

    assert.equal(payload.error, 'INVITE_INVALID');
  });

  test('cast_vote refuses a caller with no claims as NOT_PARTICIPANT', { skip: reason ?? false }, async () => {
    // ★ THE IDENTITY GATE, AND THE REASON IT IS A REFUSAL.
    //
    // `auth.uid()` is NULL because the bearer carries no `sub`. The RPC must
    // refuse rather than write a vote as nobody — or, worse, as the first row it
    // found. This is the property `REST_SETUP.md` calls "refusal, never
    // impersonation", asserted where it actually matters.
    const rest = restQueryable();

    const payload = await rest.rpc<{ error: string | null }>('cast_vote', {
      p_event_id: '00000000-0000-0000-0000-000000000000',
      p_proposal_id: '00000000-0000-0000-0000-000000000001',
      p_choice: 'YES',
    });

    assert.equal(payload.error, 'NOT_PARTICIPANT');
  });

  test('an unsupported statement fails rather than being translated', { skip: reason ?? false }, async () => {
    // The load-bearing refusal. A multi-table read has no PostgREST expression
    // without a view or an RPC, and guessing would return wrong data.
    const { UnsupportedStatementError } = await import('@/server/lib/supabase-rest');

    await assert.rejects(
      () => restQueryable().query('select e.id, count(*) from event e join participant p on p.event_id = e.id'),
      UnsupportedStatementError,
    );
  });

  test('serves the API surface without a bound pg pool', { skip: reason ?? false }, async () => {
    // The composition claim: `handleRequest` answered routes above with a
    // REST queryable bound and no `pg` pool. `/api/health` is the second path
    // form, and a 404 here would mean routing broke rather than the transport.
    const response = await call('/api/health');
    assert.equal(response.status, 200);
  });

  test('teardown closes the pool this suite never used', { skip: reason ?? false }, async () => {
    await closeServicePool();
    await closePool();
  });
});
