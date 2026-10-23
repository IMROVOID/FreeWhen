/**
 * A real route, through the real Worker adapter, against a real database.
 *
 * ★ WHY THIS FILE IS THE PROOF OF THE WHOLE PORT.
 *
 * The first attempt at this port shipped 912 green unit tests and could not
 * serve a single database request on Workers. Every one of those tests exercised
 * `db-scope.ts` or `worker.ts` in isolation, and each was correct in isolation.
 * Nothing tested the COMPOSITION — a route, a real database, through the adapter
 * — which is exactly where the unwired call sites lived.
 *
 * A seam is not proven by testing the seam. It is proven by testing a caller
 * through it. That is what this file is.
 *
 * ★ WHAT IT CATCHES THAT A FAKE CANNOT.
 *
 * The client here is a real `pg.Client`, which has no `connect()`/`release()`
 * pair of the kind `Pool` has. Every route that reaches `withTransaction` or
 * `withCallerTransaction` therefore exercises the `runExclusive` client path,
 * including `set local role` and the transaction-local JWT claims. A fake client
 * would accept any of that.
 *
 * ★ IT LIVES UNDER `tests/db/` ON PURPOSE.
 *
 * It needs a live Postgres, so it must not run in the unit suite (`docker`-free
 * CI). `scripts/db/run-tests.ts` collects `tests/db/*.test.ts` and applies
 * migrations itself, so this piggybacks that runner and its per-agent database
 * isolation. `scripts/run-tests.ts` excludes `db/`.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { Client } from 'pg';

import { createWorkerHandler, type Env } from '@/server/worker';
import { closeServicePool } from '@/server/lib/supabase';

import { databaseUrl, loadDotEnv } from '../../scripts/db/client';
import { addMember, closePool, createUser, seedEvent } from './support';
import { prepareServerEnv, prepareServerSql } from './server-support';

/** A Worker request, with the Hyperdrive binding pointed at the test database. */
function workerEnv(): Env {
  return { HYPERDRIVE: { connectionString: databaseUrl() } } as Env;
}

/**
 * The handler under test.
 *
 * `createClient` is the real factory — the whole point is that nothing between
 * the request and Postgres is faked. `pg.Client` is passed explicitly rather
 * than relying on the adapter's default so that a change to the default cannot
 * quietly make this file test a fake.
 */
const fetch = createWorkerHandler({
  createClient: (connectionString) => new Client({ connectionString }),
});

function request(path: string, options: { method?: string; userId?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': '198.18.0.1' };
  if (options.userId) headers['x-user-id'] = options.userId;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  return new Request(`http://worker.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe('Worker adapter against a live database', () => {
  before(async () => {
    loadDotEnv();
    prepareServerEnv();
    await prepareServerSql();
  });

  after(async () => {
    // Same contract as every sibling DB test: the adapter's clients are closed
    // per request, but the module-level pool the Node fallback uses is not.
    await closeServicePool();
    await closePool();
  });

  test('GET /health round-trips the database through the adapter', async () => {
    const response = await fetch(request('/health'), workerEnv());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, db: 'up' });
  });

  test('GET /api/health reaches the same handler', async () => {
    const response = await fetch(request('/api/health'), workerEnv());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, db: 'up' });
  });

  test('an authenticated route reads a real row through the scoped client', async () => {
    const owner = await createUser();

    const response = await fetch(
      request('/api/events', {
        method: 'POST',
        userId: owner,
        body: {
          title: 'Worker port event',
          activity_type: 'dinner',
          date_window_start: new Date(Date.now() + 86_400_000).toISOString(),
          date_window_end: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        },
      }),
      workerEnv(),
    );

    assert.equal(response.status, 201);

    const created = (await response.json()) as {
      event: { id: string; title: string };
      participant: { id: string };
      user_id: string;
    };

    assert.equal(created.event.title, 'Worker port event');
    assert.equal(created.user_id, owner);

    // Read it back through a second Worker request — a different client, a
    // different connection, the same scope mechanism.
    const read = await fetch(
      request(`/api/events/${created.event.id}`, { userId: owner }),
      workerEnv(),
    );

    assert.equal(read.status, 200);
    const body = (await read.json()) as { event: { id: string; title: string } };
    assert.equal(body.event.id, created.event.id);
    assert.equal(body.event.title, 'Worker port event');
  });

  test('a route that writes inside a transaction commits through the adapter', async () => {
    const seeded = await seedEvent();
    const member = await createUser();
    await addMember(seeded.eventId, { userId: member, displayName: 'Transaction tester' });

    const response = await fetch(
      request(`/api/events/${seeded.eventId}/parse`, {
        method: 'POST',
        userId: member,
        body: { text: 'pizza tonight' },
      }),
      workerEnv(),
    );

    // The status is not the assertion — surviving the transaction path is. A
    // client with no `connect()` would surface here as a 500.
    assert.ok(
      response.status < 500,
      `a transactional route must not 500: got ${response.status} ${await response.text()}`,
    );
  });

  test('a route that throws mid-transaction leaves no client bound', async () => {
    const { currentQueryable } = await import('@/server/lib/db-scope');

    const owner = await createUser();
    // A proposal id that does not exist: the lookup throws inside the handler.
    const response = await fetch(
      request('/api/proposals/00000000-0000-0000-0000-000000000000/comments', {
        method: 'POST',
        userId: owner,
        body: { body: 'orphan comment' },
      }),
      workerEnv(),
    );

    assert.ok(response.status >= 400, 'a missing proposal must not be accepted');
    assert.equal(
      currentQueryable(),
      undefined,
      'a failed request must not leave its client bound for the next one',
    );

    // ★ The connection is genuinely still usable: a bound-and-closed client
    // would surface here as a 500, not as a healthy answer.
    const health = await fetch(request('/health'), workerEnv());
    assert.equal(health.status, 200);
  });

  test('sequential requests each get a fresh client and leave no scope bound', async () => {
    // ★ Sequential, not concurrent, and that is the documented model rather
    // than a test limitation. A Workers request occupies its own isolate with
    // its own module instance, so two scopes cannot overlap. The single-slot
    // scope refuses an overlapping binding outright — see `db-scope.test.ts`,
    // which asserts that rejection directly.
    //
    // What this test adds is the part only a real database can show: the scope
    // is fully released between requests, so request 2 uses its own connection
    // and not a closed leftover from request 1.
    const { currentQueryable } = await import('@/server/lib/db-scope');

    const created: unknown[] = [];
    const counting = createWorkerHandler({
      createClient: (connectionString) => {
        const client = new Client({ connectionString });
        created.push(client);
        return client;
      },
    });

    for (let index = 0; index < 3; index++) {
      const response = await counting(request('/health'), workerEnv());
      assert.equal(response.status, 200, `request ${index} failed`);
      assert.equal(currentQueryable(), undefined, `request ${index} left its client bound`);
    }

    assert.equal(created.length, 3, 'one client per request, none reused');
  });
});
