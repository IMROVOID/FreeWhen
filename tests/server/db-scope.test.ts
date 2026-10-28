/**
 * Request-scoped database binding (Plan 39 T2).
 *
 * The properties that matter:
 *
 *  1. `scopedQueryable()` returns the bound client inside a scope and the shared
 *     pool outside it — this is what keeps the Node server byte-identical.
 *  2. A throw must not leak a dead connection into the next request.
 *  3. Two overlapping scopes must THROW, not silently share one slot. A shared
 *     slot means request A's queries run on request B's connection with B's JWT
 *     claims, which is a cross-user identity leak, not a performance problem.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { currentQueryable, resetDbScope, withRequestQueryable } from '@/server/lib/db-scope';
import { scopedQueryable } from '@/server/lib/supabase';
import type { Queryable } from '@/server/lib/supabase';

/** A stand-in for a per-request `pg.Client`. */
function fakeQueryable(tag: string): Queryable & { tag: string } {
  return {
    tag,
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('request-scoped queryable', () => {
  // A test that fails mid-scope would otherwise leave the module bound and
  // poison every later test in the file.
  afterEach(() => {
    resetDbScope();
  });

  it('falls through to the shared pool when nothing is bound', () => {
    assert.equal(currentQueryable(), undefined);

    // `new Pool` is lazy — it does not connect until a query runs — so a
    // syntactically valid URL is enough to observe the fallthrough without a
    // database. This is the property that keeps the Node server working: with
    // no scope bound, `scopedQueryable()` must be the process-wide pool.
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:1/none';
    try {
      const outside = scopedQueryable() as unknown as { connect?: unknown };
      assert.equal(
        typeof outside.connect,
        'function',
        'unbound scopedQueryable() must return the shared Pool, not a Client',
      );
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it('returns the bound queryable inside the scope', async () => {
    const req = fakeQueryable('req-1');

    await withRequestQueryable(req, async () => {
      assert.equal(scopedQueryable(), req);
      assert.equal(currentQueryable(), req);
    });
  });

  it('unbinds even when the callback throws', async () => {
    const req = fakeQueryable('req-throws');

    await assert.rejects(
      withRequestQueryable(req, async () => {
        throw new Error('handler blew up');
      }),
      /handler blew up/,
    );

    // A stale binding here would hand a closed client to the next request.
    assert.equal(
      currentQueryable(),
      undefined,
      'a thrown handler must not leave a client bound',
    );
  });

  it('propagates the callback return value', async () => {
    const req = fakeQueryable('req-value');
    const value = await withRequestQueryable(req, async () => 42);
    assert.equal(value, 42);
  });

  it('rejects a nested binding of a DIFFERENT queryable', async () => {
    const outer = fakeQueryable('outer');
    const inner = fakeQueryable('inner');

    await assert.rejects(
      withRequestQueryable(outer, async () => {
        await withRequestQueryable(inner, async () => {
          assert.fail('the inner scope must never run');
        });
      }),
      /nested binding/,
    );

    // The outer scope's own `finally` still runs, so the slot is clean.
    assert.equal(currentQueryable(), undefined);
  });

  it('allows overlapping scopes on the SAME queryable, and unbinds after the last', async () => {
    // ★ This is the Node shape: every request binds the one shared Pool, so an
    // overlapping scope has no second connection to confuse it with. The DB
    // suite's concurrency tests depend on this — the cap race and the
    // concurrent double-write issue simultaneous requests on purpose.
    const shared = fakeQueryable('shared');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withRequestQueryable(shared, async () => {
      await held;
      return scopedQueryable();
    });

    // Starts while the first is still open, on the identical object.
    const second = await withRequestQueryable(shared, async () => scopedQueryable());

    assert.equal(second, shared, 'a sharing scope must see the bound queryable');

    release();
    assert.equal(await first, shared);
    assert.equal(currentQueryable(), undefined, 'the last scope out must clear the slot');
  });

  /**
   * ★ THE OLD GUARD WAS WRONG ABOUT CONCURRENCY, AND THIS TEST WAS THE PROOF.
   *
   * This asserted that a second scope opening on a different queryable while the
   * first was in flight MUST reject. That is exactly the warm-isolate 500: two
   * concurrent Vercel requests, each with its own client. Concurrency across
   * scopes is legitimate; only a NESTED scope on a different queryable is a bug
   * (covered by the test above, which runs the inner scope INSIDE the outer one).
   *
   * A concurrent sibling scope is a separate async context, so it must succeed
   * and read its own client.
   */
  it('allows a concurrent sibling scope on a different queryable', async () => {
    const first = fakeQueryable('first');
    const second = fakeQueryable('second');

    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const running = withRequestQueryable(first, async () => {
      await held;
      return scopedQueryable();
    });

    const sibling = await withRequestQueryable(second, async () => scopedQueryable());
    assert.equal(sibling, second, 'a concurrent sibling must read its own queryable');

    releaseFirst();
    assert.equal(await running, first, 'the first scope must be unaffected');
    assert.equal(currentQueryable(), undefined, 'the first scope must still unwind cleanly');
  });

  it('does not let a binding escape to a later caller', async () => {
    const req = fakeQueryable('req-escapes');
    await withRequestQueryable(req, async () => {
      assert.equal(currentQueryable(), req);
    });

    // A second, unrelated "request" must start clean.
    const second = fakeQueryable('req-second');
    await withRequestQueryable(second, async () => {
      assert.equal(currentQueryable(), second);
    });
    assert.equal(currentQueryable(), undefined);
  });

  /**
   * ★ THE WARM-ISOLATE REGRESSION (the production 500).
   *
   * Vercel keeps a function alive between requests and runs them concurrently.
   * Each request builds its own `pg.Client`, so two in-flight requests bind two
   * DIFFERENT queryables. The scope used to be one module-level slot with a guard
   * that threw "nested/concurrent binding" on the second bind, which surfaced as
   * an intermittent 500 from `GET /api/events/:id/proposals` and
   * `/decision-status` — the client retried and eventually landed alone.
   *
   * The property that fixes it: overlapping requests must each read back THEIR OWN
   * binding. Not merely "no throw" — a shared slot would serve request A's
   * connection to request B, which on Workers carries B's JWT claims.
   */
  it('gives two concurrent requests their own queryable instead of rejecting the second', async () => {
    const first = fakeQueryable('request-a');
    const second = fakeQueryable('request-b');

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let releaseSecond!: () => void;
    const secondHeld = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    // Request A binds its client and stays in flight.
    const a = withRequestQueryable(first, async () => {
      await firstHeld;
      // Must still see ITS client after B has come and gone.
      return scopedQueryable();
    });

    // Request B starts while A is still running, on a different client. This
    // used to throw, which is the 500.
    const b = withRequestQueryable(second, async () => {
      await secondHeld;
      return scopedQueryable();
    });

    releaseSecond();
    assert.equal(await b, second, 'request B must read its own client');

    releaseFirst();
    assert.equal(await a, first, 'request A must still read its own client');

    assert.equal(currentQueryable(), undefined, 'both scopes must unwind cleanly');
  });

  it('does not leak a binding across many interleaved requests', async () => {
    const clients = Array.from({ length: 5 }, (_, index) => fakeQueryable(`req-${index}`));

    // All five in flight at once, each with a distinct client, each yielding a
    // different number of times so their lifetimes overlap unpredictably.
    const seen = await Promise.all(
      clients.map((client, index) =>
        withRequestQueryable(client, async () => {
          for (let tick = 0; tick <= index; tick++) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          return scopedQueryable();
        }),
      ),
    );

    assert.deepEqual(seen, clients, 'every request must observe its own client');
    assert.equal(currentQueryable(), undefined);
  });

  it('two sequential scopes are independent', async () => {
    const a = fakeQueryable('a');
    const b = fakeQueryable('b');

    const seen: Array<Queryable | undefined> = [];
    await withRequestQueryable(a, async () => {
      seen.push(scopedQueryable());
    });
    await withRequestQueryable(b, async () => {
      seen.push(scopedQueryable());
    });

    assert.deepEqual(seen, [a, b]);
  });
});
