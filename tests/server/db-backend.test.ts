/**
 * The database transport switch (Plan 40 T2).
 *
 * ★ WHAT IS BEING PROVEN.
 *
 * Two properties, and both are about failure modes rather than happy paths:
 *
 *  1. `DATABASE_BACKEND` unset keeps today's behaviour. That is `D5` — the Node
 *     path stays byte-identical, so an operator who deploys this build without
 *     touching their environment must not observe a change.
 *  2. An unknown value throws at startup. A typo that silently fell back to the
 *     default would leave the operator believing they had deployed the REST
 *     transport while the host opened a TCP socket instead, and the mismatch
 *     would surface as a production connection error.
 *
 * The alias cases are the third thing worth pinning: `supabase` and `local_pg`
 * were already in use for "which stack", and both are Postgres over TCP. If
 * they stopped resolving to `pg`, every existing `.env` would fail to boot.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BACKENDS,
  DEFAULT_BACKEND,
  PG_ALIASES,
  UnknownTransportError,
  resolveBackend,
  usesRestTransport,
} from '@/server/lib/db-backend';

describe('database transport switch', () => {
  it('defaults to pg when the variable is absent', () => {
    assert.equal(resolveBackend(undefined), 'pg');
    assert.equal(DEFAULT_BACKEND, 'pg');
  });

  it('treats an empty or whitespace value as absent', () => {
    assert.equal(resolveBackend(''), 'pg');
    assert.equal(resolveBackend('   '), 'pg');
  });

  it('accepts the two transport names', () => {
    assert.equal(resolveBackend('pg'), 'pg');
    assert.equal(resolveBackend('supabase_rest'), 'supabase_rest');
    assert.deepEqual([...BACKENDS], ['pg', 'supabase_rest']);
  });

  it('resolves the pre-existing stack values to pg, so an old .env still boots', () => {
    for (const alias of PG_ALIASES) {
      assert.equal(resolveBackend(alias), 'pg', `${alias} must keep resolving to the TCP transport`);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    assert.equal(resolveBackend('  LOCAL_PG  '), 'pg');
    assert.equal(resolveBackend('SUPABASE_REST'), 'supabase_rest');
  });

  it('throws on an unknown value, naming every accepted one', () => {
    assert.throws(
      () => resolveBackend('nonsense'),
      (error: unknown) => {
        assert.ok(error instanceof UnknownTransportError);
        assert.match(error.message, /pg, supabase_rest/);
        assert.match(error.message, /local_pg/);
        // The rejected value is echoed so a log line identifies the typo.
        assert.match(error.message, /"nonsense"/);
        return true;
      },
    );
  });

  it('does not silently fall back for a near-miss spelling', () => {
    // The failure this guards: `supabase-rest` (hyphen) is not the transport
    // name, and accepting it as `pg` would open a socket the operator did not
    // want.
    for (const wrong of ['supabase-rest', 'rest', 'postgres', 'supabaseRest']) {
      assert.throws(() => resolveBackend(wrong), UnknownTransportError, `${wrong} must not resolve`);
    }
  });

  it('reports whether the REST transport is active', () => {
    assert.equal(usesRestTransport('supabase_rest'), true);
    assert.equal(usesRestTransport('pg'), false);
    assert.equal(usesRestTransport(undefined), false);
    assert.equal(usesRestTransport('local_pg'), false);
  });

  it('throws through usesRestTransport too, rather than answering false', () => {
    // A `false` here would mean "use pg", which is precisely the silent
    // fallback the whole module exists to prevent.
    assert.throws(() => usesRestTransport('nonsense'), UnknownTransportError);
  });
});
