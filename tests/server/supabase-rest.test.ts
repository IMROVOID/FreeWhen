/**
 * The PostgREST transport (Plan 40 T6).
 *
 * ★ WHAT THIS FILE PROVES, AND WHY IT IS A STUB AND NOT A SERVER.
 *
 * The properties under test are about the REQUEST this module builds: which
 * URL, which headers, how a response becomes `{ rows, rowCount }`, and — most
 * importantly — that a statement the registry does not cover FAILS rather than
 * being translated into something plausible. All of those are visible from the
 * `fetch` call alone.
 *
 * The end-to-end proof that a real route works over this transport is
 * `tests/db/supabase-backend.test.ts`, which runs against a live database. A
 * stub cannot prove that, and `tests/db/worker-route.test.ts:14-21` documents
 * exactly why: a fake accepts anything.
 *
 * ★ THE ASSERTION THAT MATTERS MOST.
 *
 * `apikey` must be sent as well as `Authorization: Bearer`. Supabase's gateway
 * answers 401 to a request carrying only the bearer, and that failure looks like
 * a bad credential rather than a missing header.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REST_RPCS,
  REST_UNITS,
  assertUnitsCovered,
  RestRequestError,
  RestTransactionUnavailableError,
  UnsupportedStatementError,
  createRestQueryable,
  isRestQueryable,
} from '@/server/lib/supabase-rest';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A `fetch` stub that records every call and replays a queued answer. */
function stubFetch(answers: Array<{ status?: number; body?: string }> = []) {
  const calls: Captured[] = [];
  let index = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers((init?.headers as Record<string, string> | undefined) ?? {});

    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const answer = answers[index] ?? { status: 200, body: '[]' };
    index += 1;

    return new Response(answer.body ?? '', {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, calls };
}

const KEY = 'service-role-key-under-test';
const URL_BASE = 'https://project.supabase.co';

function queryable(answers: Array<{ status?: number; body?: string }> = []) {
  const stub = stubFetch(answers);
  const rest = createRestQueryable({ url: URL_BASE, key: KEY, fetchImpl: stub.fetchImpl });
  return { rest, calls: stub.calls };
}

describe('PostgREST transport — credentials and headers', () => {
  it('sends both apikey and Authorization, which Supabase requires together', async () => {
    const { rest, calls } = queryable([{ body: '{"ok":true}' }]);

    await rest.rpc('resolve_caller', { p_user_id: 'abc' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.headers.apikey, KEY, 'apikey is mandatory and is not the bearer');
    assert.equal(calls[0]?.headers.authorization, `Bearer ${KEY}`);
  });

  it('uses the caller JWT as the bearer when one is supplied, keeping the service key as apikey', async () => {
    // ★ THIS IS WHAT MAKES auth.uid() WORK OVER REST.
    //
    // PostgREST populates `request.jwt.claims` from the bearer, and the
    // `auth.uid()` shim reads that GUC. There is no `set_config` over HTTP, so
    // the caller's identity has to arrive here or every RPC sees a null uid.
    const stub = stubFetch([{ body: '{"error":null}' }]);
    const rest = createRestQueryable({
      url: URL_BASE,
      key: KEY,
      callerJwt: 'caller.jwt.token',
      fetchImpl: stub.fetchImpl,
    });

    await rest.rpc('join_event', { p_token: 't', p_display_name: 'Ali' });

    assert.equal(stub.calls[0]?.headers.authorization, 'Bearer caller.jwt.token');
    assert.equal(stub.calls[0]?.headers.apikey, KEY);
  });

  it('asks for a representation so a write is not silently empty', async () => {
    const { rest, calls } = queryable([{ body: '[{"id":"1"}]' }]);
    await rest.rpc('cast_vote', { p_event_id: 'e' });

    assert.equal(calls[0]?.headers.prefer, 'return=representation');
  });

  it('never includes the key in a thrown error', async () => {
    const { rest } = queryable([{ status: 401, body: '{"message":"JWT invalid"}' }]);

    await assert.rejects(
      () => rest.rpc('resolve_caller', {}),
      (error: unknown) => {
        assert.ok(error instanceof RestRequestError);
        assert.doesNotMatch(error.message, new RegExp(KEY));
        assert.match(error.message, /401/);
        return true;
      },
    );
  });
});

describe('PostgREST transport — RPC calls', () => {
  it('posts to /rest/v1/rpc/<name> with the args as JSON', async () => {
    const { rest, calls } = queryable([{ body: '{"error":"EVENT_FULL"}' }]);

    const payload = await rest.rpc('join_event', { p_token: 'tok', p_display_name: 'Ali' });

    assert.equal(calls[0]?.url, `${URL_BASE}/rest/v1/rpc/join_event`);
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { p_token: 'tok', p_display_name: 'Ali' });
    assert.deepEqual(payload, { error: 'EVENT_FULL' });
  });

  it('unwraps a jsonb scalar rather than returning a one-element array', async () => {
    // PostgREST returns a `returns jsonb` scalar as the raw value, not an array.
    // Handing the array back would make `payload.error` undefined at every call
    // site — the join would look successful when it was refused.
    const { rest } = queryable([{ body: '{"error":null,"created":true}' }]);

    const payload = await rest.rpc<{ error: string | null; created: boolean }>('join_event', {});

    assert.equal(Array.isArray(payload), false);
    assert.equal(payload.created, true);
  });

  it('returns null for an empty body', async () => {
    const { rest } = queryable([{ body: '' }]);
    assert.equal(await rest.rpc('resolve_caller', {}), null);
  });

  it('trailing slashes on the base URL do not double up', async () => {
    const stub = stubFetch([{ body: '{}' }]);
    const rest = createRestQueryable({ url: `${URL_BASE}///`, key: KEY, fetchImpl: stub.fetchImpl });

    await rest.rpc('resolve_caller', {});

    assert.equal(stub.calls[0]?.url, `${URL_BASE}/rest/v1/rpc/resolve_caller`);
  });

  it('every RPC name the transport advertises is addressable', async () => {
    const { rest, calls } = queryable(REST_RPCS.map(() => ({ body: '{}' })));

    for (const name of REST_RPCS) await rest.rpc(name, {});

    assert.equal(calls.length, REST_RPCS.length);
    for (const [index, name] of REST_RPCS.entries()) {
      assert.equal(calls[index]?.url, `${URL_BASE}/rest/v1/rpc/${name}`);
    }
  });
});

describe('PostgREST transport — the Queryable contract', () => {
  it('answers select 1 with a one-row result', async () => {
    const { rest, calls } = queryable([{ body: '{"openapi":"3.0.0"}' }]);

    const result = await rest.query('select 1');

    assert.equal(result.rowCount, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(calls[0]?.url, `${URL_BASE}/`);
  });

  it('answers the anonymous read through an RPC, because auth.users is not exposed', async () => {
    const { rest, calls } = queryable([{ body: '{"is_anonymous":true}' }]);

    const result = await rest.query<{ is_anonymous: boolean }>(
      'select is_anonymous from auth.users where id = $1',
      ['11111111-1111-1111-1111-111111111111'],
    );

    assert.equal(calls[0]?.url, `${URL_BASE}/rest/v1/rpc/resolve_caller`);
    assert.deepEqual(result.rows, [{ is_anonymous: true }]);
    assert.equal(result.rowCount, 1);
  });

  it('returns rowCount 0 — not null — for a zero-row read', async () => {
    const { rest } = queryable([{ body: 'null' }]);

    const result = await rest.query('select is_anonymous from auth.users where id = $1', ['x']);

    assert.equal(result.rowCount, 0);
    assert.notEqual(result.rowCount, null);
    assert.deepEqual(result.rows, []);
  });

  it('throws REST_UNSUPPORTED_STATEMENT for anything outside the registry', async () => {
    // ★ THE CRITICAL FAILURE MODE.
    //
    // A multi-table aggregate read cannot be expressed over PostgREST without a
    // view or an RPC. Guessing at a translation would return wrong data; this
    // throws instead, naming the statement.
    const { rest, calls } = queryable();

    await assert.rejects(
      () => rest.query('select e.id, count(*) from event e join participant p on p.event_id = e.id group by e.id'),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedStatementError);
        assert.match(error.message, /REST_UNSUPPORTED_STATEMENT/);
        assert.match(error.message, /join participant/);
        return true;
      },
    );

    assert.equal(calls.length, 0, 'an unsupported statement must not reach the network');
  });

  it('does not silently accept a write statement', async () => {
    const { rest } = queryable();

    for (const statement of [
      'insert into vote (proposal_id) values ($1) returning updated_at',
      'update proposal set status = $1 where id = $2',
      'delete from start_point where participant_id = $1',
      'begin',
      'commit',
    ]) {
      await assert.rejects(() => rest.query(statement), UnsupportedStatementError, statement);
    }
  });
});

describe('PostgREST transport — transactionality', () => {
  it('the begin/commit statements are unsupported, which is the whole point', async () => {
    // `withExclusiveTransaction` issues these three as separate round trips.
    // PostgREST executes one request as one transaction, so replaying them
    // would be silently non-atomic. They must not be translatable.
    const { rest } = queryable();

    for (const statement of ['begin', 'commit', 'rollback', 'set local role service_role']) {
      await assert.rejects(() => rest.query(statement), UnsupportedStatementError, statement);
    }
  });

  it('RestTransactionUnavailableError names the unit and never suggests a fallback', () => {
    const error = new RestTransactionUnavailableError('cast_vote');

    assert.match(error.message, /REST_TRANSACTION_UNAVAILABLE/);
    assert.match(error.message, /cast_vote/);
    assert.match(error.message, /one request as one transaction/);
  });
});

describe('isRestQueryable', () => {
  it('recognises a handle from this module', () => {
    const { rest } = queryable();
    assert.equal(isRestQueryable(rest), true);
  });

  it('does not mistake a pool-shaped object for one', () => {
    assert.equal(isRestQueryable({ query: async () => ({ rows: [], rowCount: 0 }) }), false);
    assert.equal(isRestQueryable(undefined), false);
    assert.equal(isRestQueryable(null), false);
  });
});

describe('the unit registry covers every transactional unit', () => {
  it('every declared unit names an RPC the transport can call', () => {
    // ★ THE LOAD-TIME GUARD.
    //
    // A unit added to a route without an RPC would fail at request time on a
    // REST deployment — on the join or voting path, in production, as a 500.
    // This makes it a red test instead.
    assert.doesNotThrow(() => assertUnitsCovered());
  });

  it('every unit name is also a real RPC name', () => {
    for (const [unit, rpc] of Object.entries(REST_UNITS)) {
      assert.ok(
        (REST_RPCS as readonly string[]).includes(rpc),
        `${unit} names ${rpc}, which is not in REST_RPCS`,
      );
    }
  });

  it('the registry covers the five transactional units plus the two identity reads', () => {
    assert.deepEqual(Object.keys(REST_UNITS).sort(), [
      'cast_vote',
      'confirm_decision',
      'create_anonymous_user',
      'join_event',
      'reopen_event',
      'resolve_caller',
    ]);
  });
});
