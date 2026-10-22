/**
 * The `node:http` adapter (Plan 05).
 *
 * The whole adapter — everything below — exists so that `server/app.ts` can be
 * a pure `Request => Response` function. Nothing about the API's behaviour lives
 * here: no validation, no error shaping, no route knowledge. If this file grows
 * a condition about the domain, the seam has moved and the in-process tests no
 * longer prove anything.
 *
 * Node ≥ 20 has global `Request`, `Response` and `Headers`, so no polyfill and
 * no framework are needed for a nine-endpoint API.
 */

import { createServer } from 'node:http';

import { handleRequest } from './app';
import { ensureServerSql } from './lib/server-sql';
import { closeServicePool } from './lib/supabase';

const DEFAULT_PORT = 8787;

/** Reads the request body into a buffer. Empty for GET and HEAD. */
async function readBody(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const server = createServer((incoming, outgoing) => {
  void (async () => {
    try {
      const authority = incoming.headers.host ?? `127.0.0.1:${DEFAULT_PORT}`;
      const url = new URL(incoming.url ?? '/', `http://${authority}`);

      const body = await readBody(incoming);
      const method = incoming.method ?? 'GET';
      const sendsBody = method !== 'GET' && method !== 'HEAD' && body.length > 0;

      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }

      const request = new Request(url, {
        method,
        headers,
        body: sendsBody ? new Uint8Array(body) : undefined,
      });

      const response = await handleRequest(request);
      const payload = Buffer.from(await response.arrayBuffer());

      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(payload);
    } catch {
      // The adapter itself failed — never the request's fault, so it says
      // nothing about it. A stack trace here would publish server internals.
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'VALIDATION_FAILED' }));
    }
  })();
});

const port = Number(process.env.PORT ?? DEFAULT_PORT);

/**
 * The bind address.
 *
 * `127.0.0.1` by default, which is right for a deployment behind Caddy — the
 * proxy is the only thing that should reach the API. `API_HOST` overrides it,
 * and an Android emulator needs the override: it reaches the host machine
 * through the `10.0.2.2` alias, and a loopback-only listener is invisible
 * from the device.
 */
const host = process.env.API_HOST ?? '127.0.0.1';

// The join function is this phase's SQL and lives in `server/sql/`. Applying it
// before the listener opens means the first real join cannot race the DDL.
void ensureServerSql()
  .then(() => {
    server.listen(port, host, () => {
      process.stdout.write(`freewhen api listening on http://${host}:${port}\n`);
    });
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `freewhen api could not start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exit(1);
  });

const shutdown = (): void => {
  server.close(() => {
    void closeServicePool().finally(() => process.exit(0));
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
