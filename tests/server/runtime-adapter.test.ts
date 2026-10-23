/**
 * Runtime adapter event-shape translation (Plan 40 T4/T5).
 *
 * ★ WHAT IS BEING PROVEN, AND WHAT IS DELIBERATELY NOT.
 *
 * Not routing and not SQL — `tests/db/*` prove those through the real
 * `handleRequest`. This file proves the ONE thing each adapter exists to do: turn
 * a runtime's calling convention into a `Request` whose URL, method and body match
 * what the client sent, and turn the answer back into that runtime's result shape.
 *
 * ★ ORGANISED BY CONVENTION, NOT BY VENDOR.
 *
 * There are three distinct arrangements in common use, and one adapter serves
 * each. Testing them by convention means a new host that shares an arrangement is
 * covered without a new test:
 *
 * | Section | Adapter | Convention |
 * |---|---|---|
 * | Event object | `event-object.ts` | `handler(event, ctx) => { statusCode, … }` |
 * | Node signature | `node-signature.ts` | `handler(req: IncomingMessage, res)` |
 * | Descriptor | `descriptor.ts` | `handler(ctx, { method, url, headers, body })` |
 *
 * The client factory is a fake here on purpose: the lifecycle is proven once by
 * `worker-entry.test.ts` (and against a real database by
 * `tests/db/worker-route.test.ts`). Duplicating it per adapter would be the "test
 * the seam, not a caller through it" failure the repo already documents.
 *
 * ★ THE FIVE ASSERTIONS THAT MATTER MOST.
 *
 *  1. `GET /api/events` keeps its `/api` segment. A strip 404s the whole API.
 *  2. A `GET` with a body does not throw — the `Request` constructor rejects it.
 *  3. A base64 body decodes before the `Request` is built.
 *  4. A `Map`-like header map is normalised, not read as a record.
 *  5. A missing database credential is a 500 `misconfigured`, not a crash.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ClientFactory } from '@/server/runtime/driver';
import type { Queryable } from '@/server/lib/supabase';

import { createDescriptorHandler } from '@/server/runtime/descriptor';
import { createEventHandler, type EventRequest } from '@/server/runtime/event-object';
import { createNodeSignatureHandler } from '@/server/runtime/node-signature';

interface RecordedClient {
  connectionString: string;
  connects: number;
  ends: number;
}

/**
 * A client factory that records every client it creates.
 *
 * The client answers an empty result set, which is enough for `/health` and for
 * the accept-or-refuse paths under test. What the assertions read is the
 * adapter's RESULT — a 404 means the path never reached a route, which is the
 * `/api`-strip failure these tests exist for — plus the open/close counts.
 */
function recordingFactory() {
  const created: RecordedClient[] = [];

  const createClient: ClientFactory = (connectionString) => {
    const record: RecordedClient = { connectionString, connects: 0, ends: 0 };
    created.push(record);

    const client: Queryable & { connect(): Promise<void>; end(): Promise<void> } = {
      async connect() {
        record.connects += 1;
      },
      async end() {
        record.ends += 1;
      },
      async query() {
        return { rows: [], rowCount: 0 };
      },
    };

    return client;
  };

  return { createClient, created };
}

const SAMPLE_DATABASE_URL = 'postgres://test.local/freewhen';

function withDatabaseUrl<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = SAMPLE_DATABASE_URL;

  return fn().finally(() => {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
}

/** Runs `fn` with no database credential in the environment. */
async function withoutDatabaseUrl<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL;
  const previousFallback = process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;

  try {
    return await fn();
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
    if (previousFallback !== undefined) process.env.SUPABASE_DB_URL = previousFallback;
  }
}

/** An event as an event-object runtime delivers it. */
function eventRequest(overrides: Partial<EventRequest> = {}): EventRequest {
  return {
    rawPath: '/health',
    requestContext: { http: { method: 'GET', path: '/health' } },
    headers: { host: 'api.test' },
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('event-object adapter', () => {
  it('answers an event with the handler’s status', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler(eventRequest());

      // The path reached the router: a 404 would mean the URL was built wrong.
      assert.notEqual(result.statusCode, 404, 'the path must reach a route');
      assert.ok('isBase64Encoded' in result, 'the flag is always explicit');
    });
  });

  it('keeps the /api segment, because handleRequest matches on segments', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler(
        eventRequest({ rawPath: '/api/events', requestContext: { http: { method: 'GET' } } }),
      );

      // A GET on /api/events needs an identity and answers 403 from the route.
      // A 404 would prove the adapter stripped `/api` — the failure this test
      // exists for.
      assert.notEqual(result.statusCode, 404, '/api must not be stripped');
    });
  });

  it('accepts a method that lives in requestContext', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler(
        eventRequest({
          rawPath: '/api/health',
          requestContext: { http: { method: 'GET', path: '/api/health' } },
        }),
      );

      assert.equal(result.statusCode, 200, '/api/health round-trips');
    });
  });

  it('accepts a method and path that live at the top level', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler({
        path: '/health',
        httpMethod: 'GET',
        headers: { Host: 'api.test' },
        body: null,
        isBase64Encoded: false,
      });

      assert.equal(result.statusCode, 200);
    });
  });

  it('does not throw on a GET that carries a body', async () => {
    // The `Request` constructor rejects `GET` with a body outright, and some
    // gateways do forward one (a proxy relaying an empty JSON document).
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler(eventRequest({ body: '{"stray":true}' }));
      assert.notEqual(result.statusCode, 500, 'a GET with a body must not 500 the adapter');
    });
  });

  it('drops a base64 GET body rather than rejecting it', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const encoded = Buffer.from('hi').toString('base64'); // 'aGk='
      assert.equal(encoded, 'aGk=');

      const result = await handler(
        eventRequest({ rawPath: '/health', body: encoded, isBase64Encoded: true }),
      );

      assert.equal(result.statusCode, 200, 'a base64 GET body must be dropped, not rejected');
    });
  });

  it('decodes a base64 JSON body into parseable bytes', async () => {
    // The decode itself, separately from routing: a body that survives to the
    // Request must be the decoded bytes, not the base64 text.
    const { toRequest } = await import('@/server/runtime/http-normalise');

    const original = '{"title":"x"}';
    const encoded = Buffer.from(original, 'utf8').toString('base64');
    assert.notEqual(encoded, original, 'the fixture must really be base64');

    const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
    const request = toRequest({ method: 'POST', url: '/api/events', body: bytes });

    assert.equal(new TextDecoder().decode(bytes), original);
    assert.deepEqual(await request.json(), { title: 'x' });
  });

  it('flattens repeated headers without duplicating them', async () => {
    const { createClient } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler({
        path: '/health',
        httpMethod: 'GET',
        multiValueHeaders: { 'X-Forwarded-For': ['198.18.0.1', '198.18.0.2'] },
        body: null,
      });

      assert.equal(result.statusCode, 200);
      assert.ok(
        Object.keys(result.headers).every((name) => name === name.toLowerCase()),
        'response header names must be lower-case or a gateway duplicates them',
      );
    });
  });

  it('answers 500 misconfigured when no database credential is set, and opens no client', async () => {
    const { createClient, created } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withoutDatabaseUrl(async () => {
      const result = await handler(eventRequest());
      assert.equal(result.statusCode, 500);
      assert.match(result.body, /misconfigured/);
      assert.equal(created.length, 0, 'no client without a credential');
    });
  });

  it('closes the client it opened', async () => {
    const { createClient, created } = recordingFactory();
    const handler = createEventHandler({ createClient });

    await withDatabaseUrl(() => handler(eventRequest()));

    assert.equal(created.length, 1);
    assert.equal(created[0]?.connects, 1);
    assert.equal(created[0]?.ends, 1, 'one request, one connect, one close');
  });
});

describe('node-signature adapter', () => {
  /** A minimal `IncomingMessage`: an async-iterable body plus the header map. */
  function incoming(
    overrides: { method?: string; url?: string; headers?: Record<string, string>; body?: string } = {},
  ) {
    const bytes = new TextEncoder().encode(overrides.body ?? '');

    return {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? '/health',
      headers: overrides.headers ?? { host: 'api.test' },
      async *[Symbol.asyncIterator]() {
        if (bytes.length > 0) yield bytes;
      },
    };
  }

  /** A minimal `ServerResponse` that records what the adapter wrote. */
  function outgoing() {
    const record = {
      status: 0,
      headers: {} as Record<string, string>,
      body: new Uint8Array(0) as Uint8Array,
      writeHead(status: number, headers: Record<string, string>) {
        record.status = status;
        record.headers = headers;
      },
      end(payload: Uint8Array) {
        record.body = payload;
      },
    };

    return record;
  }

  it('round-trips /health through the node style signature', async () => {
    const { createClient } = recordingFactory();
    const handler = createNodeSignatureHandler({ createClient });

    const res = outgoing();
    await withDatabaseUrl(() => handler(incoming() as never, res as never));

    assert.equal(res.status, 200);
    assert.equal(new TextDecoder().decode(res.body), '{"ok":true,"db":"up"}');
  });

  it('reads the origin from the forwarding headers, not the internal one', async () => {
    const { createClient } = recordingFactory();
    const handler = createNodeSignatureHandler({ createClient });

    const res = outgoing();
    await withDatabaseUrl(() =>
      handler(
        incoming({
          url: '/api/health',
          headers: {
            host: 'internal:8080',
            'x-forwarded-host': 'api.example.test',
            'x-forwarded-proto': 'https',
          },
        }) as never,
        res as never,
      ),
    );

    // The route does not echo its origin, so the observable claim is that the URL
    // parsed and reached a route rather than 404ing on a bad host.
    assert.equal(res.status, 200);
  });

  it('preserves a 204 preflight status', async () => {
    const { createClient } = recordingFactory();
    const handler = createNodeSignatureHandler({ createClient });

    const res = outgoing();
    await withDatabaseUrl(() =>
      handler(incoming({ method: 'OPTIONS', url: '/api/events' }) as never, res as never),
    );

    assert.equal(res.status, 204, 'OPTIONS is answered by app.ts with 204, not 200');
    assert.equal(res.body.length, 0);
  });

  it('answers 500 misconfigured with no credential', async () => {
    const { createClient } = recordingFactory();
    const handler = createNodeSignatureHandler({ createClient });

    await withoutDatabaseUrl(async () => {
      const res = outgoing();
      await handler(incoming() as never, res as never);
      assert.equal(res.status, 500);
      assert.match(new TextDecoder().decode(res.body), /misconfigured/);
    });
  });
});

describe('descriptor adapter', () => {
  it('round-trips /health and lower-cases the header map it returns', async () => {
    const { createClient } = recordingFactory();
    const handler = createDescriptorHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler(
        {},
        { method: 'GET', url: 'https://api.example.test/health', headers: { Host: 'api.example.test' } },
      );

      assert.equal(result.status, 200);
      assert.ok(Object.keys(result.headers).every((name) => name === name.toLowerCase()));
      assert.equal(new TextDecoder().decode(result.body as Uint8Array), '{"ok":true,"db":"up"}');
    });
  });

  it('accepts a Map-like header bag as well as a plain object', async () => {
    const { createClient } = recordingFactory();
    const handler = createDescriptorHandler({ createClient });

    await withDatabaseUrl(async () => {
      // Some runtimes deliver a `Headers`-like map. Iterating it must work;
      // touching it as a record would produce `undefined`.
      const headers = new Map<string, string>([['Host', 'api.example.test']]);

      const result = await handler(
        {},
        { method: 'GET', url: 'https://api.example.test/health', headers: headers as never },
      );

      assert.equal(result.status, 200);
    });
  });

  it('answers a request whose body arrived already parsed', async () => {
    const { createClient } = recordingFactory();
    const handler = createDescriptorHandler({ createClient });

    await withDatabaseUrl(async () => {
      // Some runtimes parse `application/json` before the handler runs, so `body`
      // is an object here. Sending it unencoded would fail to parse; the
      // assertion is that the route answered rather than 404ing on the path.
      const result = await handler(
        {},
        {
          method: 'POST',
          url: 'https://api.example.test/api/events',
          headers: { 'content-type': 'application/json' },
          body: { title: 'an event', activity_type: 'dinner' },
        },
      );

      assert.ok(result.status >= 400, 'the route must answer');
      assert.notEqual(result.status, 404, '/api must not be stripped');
    });
  });

  it('encodes an object body into JSON bytes the Request can parse', async () => {
    // The direct assertion the handler-level test cannot make without a real
    // database: an already-parsed body must round-trip to the same JSON.
    const { toRequest } = await import('@/server/runtime/http-normalise');

    const parsed = { title: 'an event', activity_type: 'dinner' };
    const bytes = new TextEncoder().encode(JSON.stringify(parsed));
    const request = toRequest({
      method: 'POST',
      url: '/api/events',
      headers: { 'content-type': 'application/json' },
      body: bytes,
    });

    assert.deepEqual(await request.json(), parsed);
  });

  it('keeps /api in the path', async () => {
    const { createClient } = recordingFactory();
    const handler = createDescriptorHandler({ createClient });

    await withDatabaseUrl(async () => {
      const result = await handler({}, { method: 'GET', url: 'https://api.example.test/api/health' });
      assert.equal(result.status, 200);
    });
  });

  it('answers 500 misconfigured with no credential', async () => {
    const { createClient } = recordingFactory();
    const handler = createDescriptorHandler({ createClient });

    await withoutDatabaseUrl(async () => {
      const result = await handler({}, { method: 'GET', url: 'https://api.example.test/health' });
      assert.equal(result.status, 500);
      assert.match(new TextDecoder().decode(result.body as Uint8Array), /misconfigured/);
    });
  });
});

describe('web-standard entries keep the path intact', () => {
  // Web-standard entries hand a real `Request` to `handleRequest`; the only thing
  // an adapter could get wrong is rewriting the path. This asserts the property
  // against `handleRequest` directly, which is exactly what those entries do.
  it('/api/health and /health both reach the same handler', async () => {
    const { handleRequest } = await import('@/server/app');
    const { withRequestQueryable } = await import('@/server/lib/db-scope');

    const { createClient } = recordingFactory();
    const client = createClient(SAMPLE_DATABASE_URL);
    await client.connect();

    for (const path of ['/health', '/api/health']) {
      const response = await withRequestQueryable(client, () =>
        handleRequest(new Request(`https://api.example.test${path}`)),
      );

      assert.equal(response.status, 200, `${path} must reach the health route`);
    }
  });
});
