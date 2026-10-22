/**
 * The local auth service's entry point.
 *
 * ★ IT IS A SEPARATE PROCESS, AND THAT IS DELIBERATE.
 *
 * On the Supabase backend, GoTrue is a separate service and the host
 * routes `/auth/v1/*` to it (PRD-18 §4, row 10). The local backend
 * replaces GoTrue with this service, and it keeps the same shape: a
 * separate process behind the same path.
 *
 * Keeping it separate rather than folding it into the API server avoids
 * two problems at once:
 *
 *  - The API server is owned by another phase. Adding routes to it would
 *    put two plans in one file, which is the conflict the ownership
 *    frontmatter exists to prevent.
 *  - The auth service has a different trust profile. It holds the
 *    signing secret and the service role, and it does one job. A process
 *    that does one job has one blast radius.
 *
 * ```bash
 * DATABASE_BACKEND=local_pg npm run server:auth
 * ```
 */

import { createServer } from 'node:http';

import { AuthService, createAnonymousHandler, createHealthHandler } from './routes';
import { postgresUserStore } from './store';

const DEFAULT_PORT = 8789;

/** Reads the request body into a buffer. Empty for GET and HEAD. */
async function readBody(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * The service.
 *
 * ★ IT IS BUILT AT START-UP, so a missing or weak `JWT_SECRET` stops the
 * process rather than failing at the first request.
 */
function buildService(): AuthService {
  return new AuthService(postgresUserStore);
}

async function main(): Promise<void> {
  const service = buildService();
  const port = Number(process.env.AUTH_PORT ?? DEFAULT_PORT);

  const handleAnonymous = createAnonymousHandler(service);
  const handleHealth = createHealthHandler(service);

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        const authority = incoming.headers.host ?? `127.0.0.1:${port}`;
        const url = new URL(incoming.url ?? '/', `http://${authority}`);
        const method = incoming.method ?? 'GET';
        const path = url.pathname;

        const body = await readBody(incoming);
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

        // ★ THE PATHS ARE GOTRUE'S (PRD-18 §4, row 10).
        let response: Response;

        if (path === '/auth/v1/anonymous' && method === 'POST') {
          response = await handleAnonymous(request);
        } else if (path === '/auth/v1/health' && method === 'GET') {
          response = await handleHealth(request);
        } else {
          response = new Response(null, { status: 404 });
        }

        const payload = Buffer.from(await response.arrayBuffer());

        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(payload);
      } catch {
        // The adapter itself failed — never the request's fault, so it
        // says nothing about it. A stack trace here would publish server
        // internals.
        if (!outgoing.headersSent) {
          outgoing.writeHead(500, { 'content-type': 'application/json' });
        }
        outgoing.end(JSON.stringify({ error: 'unexpected_failure' }));
      }
    })();
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`freewhen auth listening on http://127.0.0.1:${port}\n`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `freewhen auth could not start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exit(1);
});
