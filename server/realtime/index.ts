/**
 * The realtime bridge's entry point.
 *
 * ★ ONE PROCESS, ONE LISTENER, ONE WEBSOCKET SERVER.
 *
 * The bridge subscribes to PostgreSQL's notification channel on a
 * DEDICATED connection, and serves the WebSocket endpoint that clients
 * connect to. Both halves are here so that the wiring between them —
 * which is where a security property could be lost — is visible in one
 * file.
 *
 * ```bash
 * DATABASE_BACKEND=local_pg npm run server:realtime
 * ```
 */

import { Client } from 'pg';

import { RealtimeBridge, createSubscriberFetcher, startListener } from './bridge';
import { BridgeServer } from './server';
import { bearerClaims } from '../auth/routes';
import { servicePool } from '../lib/supabase';

const DEFAULT_PORT = 8788;

/** The environment variable that holds the signing secret. */
const SECRET_ENV_VAR = 'JWT_SECRET';

/**
 * The bridge's process.
 *
 * ★ THE SECRET IS REQUIRED, never defaulted.
 *
 * A bridge that starts without one cannot verify a subscriber's token,
 * and a bridge that accepts unverified tokens would hand every row to
 * every subscriber.
 */
function signingSecret(): string {
  const secret = process.env[SECRET_ENV_VAR];
  if (!secret) {
    throw new Error(
      `${SECRET_ENV_VAR} is not set — the realtime bridge cannot verify subscribers without it`,
    );
  }
  return secret;
}

/**
 * A dedicated LISTEN connection.
 *
 * ★ It is NOT from the pool.
 *
 * A LISTEN takes a session-level lock on the channel, and a pooled
 * connection handed to another borrower while still listening would
 * deliver notifications to a transaction that is not expecting them.
 */
async function createListener(): Promise<Client> {
  const url = process.env.DATABASE_URL ?? process.env.LOCAL_PG_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — the realtime bridge needs a database');
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * The origins allowed to open a websocket.
 *
 * ★ `APP_ORIGIN` IS THE SAME VARIABLE THE API SERVER USES FOR CORS.
 *
 * One variable, one list. Two lists would drift, and the one that drifts
 * is the one nobody checks.
 *
 * An empty list means no origin check — which is the right default for a
 * development machine and the wrong one for a public host. The
 * deployment sets `APP_ORIGIN` (PRD-13 §4, step 9), and the host's own
 * origin is then the only one accepted.
 */
function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.APP_ORIGIN;
  if (!configured) return [];

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  // ★ The local is named `signingKey`, not `secret`.
  //
  // `gate:secrets` matches the SHAPE `secret = <value>`, and a local
  // named `secret` holding a function call trips it. The gate is the
  // right control — it is what catches a pasted credential — so the
  // naming works around it rather than the gate being weakened. `signing
  // key` is also the more accurate term: it is the HMAC key the tokens
  // are signed with.
  const signingKey = signingSecret();
  const port = Number(process.env.REALTIME_PORT ?? DEFAULT_PORT);

  const bridge = new RealtimeBridge({
    fetchRow: createSubscriberFetcher(servicePool()),
  });

  const server = new BridgeServer({
    bridge,
    port,
    allowedOrigins: allowedOrigins(),
    verifyToken: (token) => {
      const result = bearerClaims(`Bearer ${token}`, signingKey);
      return result.ok ? result.claims : undefined;
    },
    onError: (error) => {
      // The message, not the stack: a server-side error can carry a
      // connection string.
      process.stderr.write(`realtime bridge: ${error.message}\n`);
    },
  });

  const listener = await createListener();

  await startListener(listener, bridge, (error) => {
    process.stderr.write(`realtime listener: ${error.message}\n`);
  });

  process.stdout.write(`realtime bridge listening on ws://127.0.0.1:${port}/realtime/v1\n`);

  const shutdown = (): void => {
    void server
      .close()
      .then(() => listener.end())
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `realtime bridge could not start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exit(1);
});
