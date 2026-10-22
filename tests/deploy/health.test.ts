/**
 * The health endpoint's failure branch (PRD-13 §8, Plan 12 Task 2).
 *
 * ★ THE 503 IS THE ONE PATH A RUNNING SERVER CANNOT REACH.
 *
 * `server/index.ts` refuses to start at all when the database is unreachable, so
 * a live `/health` can only ever answer 200 — the branch that matters most to a
 * load balancer is the branch no smoke test can produce. It is therefore
 * exercised here, against the real handler, by pointing the pool at nothing.
 *
 * ★ AND THE BODY IS THE ASSERTION, NOT JUST THE STATUS.
 *
 * A health endpoint is public by necessity. The one thing it must never do is
 * echo the driver's message, which names the host, the database and often the
 * user. `pg`'s ECONNREFUSED text is exactly that, so the test asserts its
 * absence rather than trusting the `catch` to stay empty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { healthHandler } from '../../server/routes/health';
import { closeServicePool } from '../../server/lib/supabase';

test('GET /health answers 200 with a database round trip when the pool works', async () => {
  // Arrange — the dev database, if it is reachable. Without one the handler has
  // nothing to prove, and the failure case below still runs.
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    // The suite must not invent a database. This is a documented skip.
    return;
  }

  // Act
  const response = await healthHandler();
  const body = (await response.json()) as Record<string, unknown>;

  // Assert
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.db, 'up');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  await closeServicePool();
});

test('GET /health answers 503 and leaks nothing when the database is unreachable', async () => {
  // Arrange — the pool is built from DATABASE_URL on first use, so this test
  // points it somewhere nothing listens and then closes it again.
  const original = process.env.DATABASE_URL;
  const originalFallback = process.env.SUPABASE_DB_URL;
  process.env.DATABASE_URL = 'postgres://user:mismatched@127.0.0.1:59999/nothing';

  try {
    await closeServicePool();

    // Act
    const response = await healthHandler();
    const text = await response.text();

    // Assert — the status and the body, and nothing else in the body.
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(text), { ok: false });
    assert.equal(response.headers.get('cache-control'), 'no-store');

    // The driver's error names the host, the port and the role. None of it may
    // reach an anonymous caller.
    for (const fragment of ['127.0.0.1', '59999', 'ECONNREFUSED', 'mismatched', 'postgres://']) {
      assert.ok(!text.includes(fragment), `the body leaked "${fragment}": ${text}`);
    }
  } finally {
    process.env.DATABASE_URL = original;
    if (originalFallback === undefined) delete process.env.SUPABASE_DB_URL;
    await closeServicePool();
  }
});
