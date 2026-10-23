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
      /nested\/concurrent binding/,
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

  it('rejects a concurrent binding of a different queryable while one is in flight', async () => {
    const first = fakeQueryable('first');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = withRequestQueryable(first, async () => {
      await held;
      return 'first-done';
    });

    await assert.rejects(
      withRequestQueryable(fakeQueryable('second'), async () => 'second-done'),
      /nested\/concurrent binding/,
    );

    release();
    assert.equal(await running, 'first-done');
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
