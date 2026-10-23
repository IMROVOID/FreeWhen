/**
 * The Workers entry adapter (Plan 39 T3).
 *
 * ★ WHAT IS ACTUALLY BEING TESTED HERE.
 *
 * Not routing, not SQL — `tests/db/*` already prove those through the real
 * `handleRequest`. This file proves the lifecycle contract that only exists on
 * Workers:
 *
 *   one client created per request, always closed, never leaked on a throw,
 *   and the request body answered even when the database is unreachable.
 *
 * A leaked client on Workers is not a slow leak — it is an unreclaimable
 * connection against the database's `max_connections`, so this is the property
 * worth pinning.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWorkerHandler, type Env } from '@/server/worker';
import type { Queryable } from '@/server/lib/supabase';

interface FakeClient extends Queryable {
  connectionString: string;
  connects: number;
  ends: number;
  connect(): Promise<void>;
  end(): Promise<void>;
}

function makeFactory(options: { failConnect?: boolean } = {}) {
  const created: FakeClient[] = [];

  const createClient = (connectionString: string): FakeClient => {
    const client: FakeClient = {
      connectionString,
      connects: 0,
      ends: 0,
      async connect() {
        client.connects += 1;
        if (options.failConnect) throw new Error('boom: connection refused');
      },
      async end() {
        client.ends += 1;
      },
      async query() {
        // Every route that reaches the DB through this fake sees an empty result
        // set. Enough for `/health` and for the 500/403 paths under test.
        return { rows: [], rowCount: 0 };
      },
    };
    created.push(client);
    return client;
  };

  return { createClient, created };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    HYPERDRIVE: { connectionString: 'postgres://hyperdrive/test' },
    ...overrides,
  } as Env;
}

describe('Workers entry adapter', () => {
  it('creates exactly one client per request and closes it', async () => {
    const { createClient, created } = makeFactory();
    const fetch = createWorkerHandler({ createClient });

    await fetch(new Request('https://app.test/health'), env());
    await fetch(new Request('https://app.test/health'), env());

    assert.equal(created.length, 2, 'one client per request, not one per isolate');
    for (const client of created) {
      assert.equal(client.connects, 1, 'each client connects once');
      assert.equal(client.ends, 1, 'each client is closed once');
    }
  });

  it('passes the Hyperdrive connection string through untouched', async () => {
    const { createClient, created } = makeFactory();
    const fetch = createWorkerHandler({ createClient });

    await fetch(new Request('https://app.test/health'), env());

    assert.ok(created[0]);
    assert.equal(created[0].connectionString, 'postgres://hyperdrive/test');
  });

  it('answers 500 and leaks nothing when the binding is missing', async () => {
    const { createClient, created } = makeFactory();
    const fetch = createWorkerHandler({ createClient });

    const response = await fetch(
      new Request('https://app.test/health'),
      {} as Env,
    );

    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'misconfigured');
    assert.equal(created.length, 0, 'no client should be created without a binding');
  });

  it('closes the client and returns 500 when connect() throws', async () => {
    const { createClient, created } = makeFactory({ failConnect: true });
    const fetch = createWorkerHandler({ createClient });

    const response = await fetch(new Request('https://app.test/health'), env());

    assert.equal(response.status, 500);
    // ★ The critical assertion: a failed connect must still close, or the
    // socket is leaked before the request even ran.
    assert.ok(created[0]);
    assert.equal(created[0].ends, 1, 'a client that failed to connect must still be closed');
  });

  it('never puts the driver message in the response body', async () => {
    const { createClient } = makeFactory({ failConnect: true });
    const fetch = createWorkerHandler({ createClient });

    const response = await fetch(new Request('https://app.test/health'), env());
    const text = await response.text();

    // The fake throws 'boom: connection refused'; a real pg error carries the
    // host and role. Neither belongs in a body a stranger can read.
    assert.doesNotMatch(text, /boom/i);
    assert.doesNotMatch(text, /connection refused/i);
    assert.match(text, /internal/);
  });

  it('binds the environment onto process.env for the routes that read it', async () => {
    const { createClient } = makeFactory();
    const fetch = createWorkerHandler({ createClient });

    const previous = process.env.PUBLIC_BASE_URL;
    try {
      delete process.env.PUBLIC_BASE_URL;
      await fetch(
        new Request('https://app.test/health'),
        env({ PUBLIC_BASE_URL: 'https://freewhen.example' }),
      );
      assert.equal(process.env.PUBLIC_BASE_URL, 'https://freewhen.example');
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = previous;
    }
  });

  it('leaves the scope unbound after the request so the next one starts clean', async () => {
    const { createClient } = makeFactory();
    const fetch = createWorkerHandler({ createClient });

    await fetch(new Request('https://app.test/health'), env());

    const { currentQueryable } = await import('@/server/lib/db-scope');
    assert.equal(
      currentQueryable(),
      undefined,
      'a finished request must not leave its client bound',
    );
  });
});
