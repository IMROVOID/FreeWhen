/**
 * `GET /health` — public, unauthenticated, and deliberately boring.
 *
 * ★ A HEALTH ENDPOINT IS PUBLIC BY NECESSITY, SO ITS BODY IS A CONTRACT.
 *
 * It answers the only question a proxy, an uptime check or a reviewer needs —
 * "is this process able to serve?" — and nothing else. No connection string, no
 * driver version, no migration name, no error text. `pg`'s own errors carry the
 * host, the database and often the user; echoing one here publishes the shape
 * of the deployment to any caller that can reach the port.
 *
 * ★ IT ALSO MAKES THE DEMO HOST WARM.
 *
 * The statement is a real round trip to Postgres, so a check that fires every
 * minute keeps a pooled connection open. The demo being cold at exactly the
 * moment a reviewer opens it is PRD-13's "demo database idle-paused" risk, and
 * a pre-warm is a cheaper answer than a retry on the first screen.
 *
 * ★ TWO CALLS, ONE FUNCTION.
 *
 * Caddy routes `/health`; the API routes `/api/health`. Both reach
 * `healthHandler`, because a deployment that serves one and not the other is a
 * deployment where the operator's check and the proxy's check disagree.
 */

import { json } from '../lib/http';
import { scopedQueryable } from '../lib/supabase';

/** The body. Two fields, both non-identifying. */
interface HealthBody {
  ok: boolean;
  /** The database round trip, when it happened. Absent on failure. */
  db?: 'up';
}

/**
 * Runs one trivial statement against the shared pool.
 *
 * `select 1` rather than a table read: it proves the connection, the
 * authentication and the pool are alive without depending on any schema this
 * deployment may or may not have migrated yet. A health check that fails
 * because a table is missing is reporting a deployment bug as an outage.
 */
async function databaseReachable(): Promise<boolean> {
  try {
    await scopedQueryable().query('select 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * The handler.
 *
 * 200 when the database answers, 503 when it does not. The status code IS the
 * diagnosis — a load balancer removes the instance on 503, and the body adds
 * nothing it could act on. In particular there is no `error` field: the only
 * useful distinction, "reachable" or not, is already in the status.
 */
export async function healthHandler(): Promise<Response> {
  const reachable = await databaseReachable();

  if (!reachable) {
    const body: HealthBody = { ok: false };
    // `no-store` on both branches: a cached 200 from a minute ago is a health
    // check that reports the past.
    return json(body, 503, { 'cache-control': 'no-store' });
  }

  const body: HealthBody = { ok: true, db: 'up' };
  return json(body, 200, { 'cache-control': 'no-store' });
}
