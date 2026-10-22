/**
 * The backend switch (PRD-10 D22, PRD-09 §4.0.1).
 *
 * ★ WHAT THE SWITCH MAY AND MAY NOT DO.
 *
 * It selects the UPSTREAM. It never selects the contract. The paths, the
 * token shape and the event contract are identical on both backends
 * (PRD-18 §4), and that is the property that makes the local backend a
 * peer rather than a fork.
 *
 * ★ SUPABASE IS THE DEFAULT, AND AN UNKNOWN VALUE FAILS LOUDLY.
 *
 * A typo in `DATABASE_BACKEND` must not silently select the default: the
 * host would serve the Supabase paths while the operator believed they had
 * deployed the local one, and the failure would surface as a 404 in
 * production.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BACKENDS,
  DEFAULT_BACKEND,
  UnknownBackendError,
  currentBackend,
  endpointsFor,
  isLocalPg,
  issuesTokensLocally,
  parseBackend,
  usesRealtimeBridge,
} from '../../scripts/db/backends';

describe('the backend switch', () => {
  // ───────────────────────────────────────────────────────────
  // The selection
  // ───────────────────────────────────────────────────────────
  describe('the selection', () => {
    test('there are exactly two backends', () => {
      assert.deepEqual([...BACKENDS].sort(), ['local_pg', 'supabase']);
    });

    test('supabase is the default', () => {
      // ★ Supabase is the backend that is tested together and pinned.
      // The local one exists for hosts that cannot run the stack.
      assert.equal(DEFAULT_BACKEND, 'supabase');
      assert.equal(parseBackend(undefined), 'supabase');
      assert.equal(parseBackend(null), 'supabase');
      assert.equal(parseBackend(''), 'supabase');
      assert.equal(parseBackend('   '), 'supabase');
    });

    test('local_pg selects the local backend', () => {
      assert.equal(parseBackend('local_pg'), 'local_pg');
      assert.equal(parseBackend('LOCAL_PG'), 'local_pg');
      assert.equal(parseBackend('  local_pg  '), 'local_pg');
    });

    test('supabase selects the default backend', () => {
      assert.equal(parseBackend('supabase'), 'supabase');
    });

    test('an unknown value fails loudly', () => {
      // ★ A typo must not silently select the default.
      for (const value of ['local', 'postgres', 'supabse', 'true', '1']) {
        assert.throws(
          () => parseBackend(value),
          (error: unknown) => error instanceof UnknownBackendError,
          `"${value}" must be rejected`,
        );
      }
    });

    test('the error names the value and the valid options', () => {
      assert.throws(
        () => parseBackend('local'),
        (error: unknown) =>
          error instanceof UnknownBackendError &&
          error.value === 'local' &&
          /local_pg/.test(error.message) &&
          /supabase/.test(error.message),
      );
    });

    test('the current backend is read from the environment', () => {
      assert.equal(currentBackend({}), 'supabase');
      assert.equal(currentBackend({ DATABASE_BACKEND: 'local_pg' }), 'local_pg');
      assert.equal(isLocalPg({ DATABASE_BACKEND: 'local_pg' }), true);
      assert.equal(isLocalPg({}), false);
    });
  });

  // ───────────────────────────────────────────────────────────
  // ★ THE CONTRACT DOES NOT CHANGE
  // ───────────────────────────────────────────────────────────
  describe('the contract is identical on both backends', () => {
    test('the paths are the same', () => {
      // ★ THE ROUTE TABLE IS BACKEND-AGNOSTIC (PRD-18 §4).
      //
      // The paths are what the client and the proxy both use, and they
      // never change. Only the upstream behind them differs.
      const supabase = endpointsFor('supabase', {
        supabaseUrl: 'http://supabase.test',
        localPgUrl: 'http://local.test',
      });
      const local = endpointsFor('local_pg', {
        supabaseUrl: 'http://supabase.test',
        localPgUrl: 'http://local.test',
      });

      assert.equal(supabase.authPath, local.authPath);
      assert.equal(supabase.restPath, local.restPath);
      assert.equal(supabase.realtimePath, local.realtimePath);

      assert.equal(supabase.authPath, '/auth/v1');
      assert.equal(supabase.restPath, '/rest/v1');
      assert.equal(supabase.realtimePath, '/realtime/v1');
    });

    test('only the base URL differs', () => {
      const supabase = endpointsFor('supabase', {
        supabaseUrl: 'http://supabase.test',
        localPgUrl: 'http://local.test',
      });
      const local = endpointsFor('local_pg', {
        supabaseUrl: 'http://supabase.test',
        localPgUrl: 'http://local.test',
      });

      assert.equal(supabase.baseUrl, 'http://supabase.test');
      assert.equal(local.baseUrl, 'http://local.test');
    });

    test('the token issuer swaps, and only on local_pg', () => {
      // ★ GoTrue issues the tokens on Supabase; this repository's token
      // service issues them on local Postgres. The CLAIM SET is the same
      // on both — that is the contract.
      assert.equal(issuesTokensLocally('supabase'), false);
      assert.equal(issuesTokensLocally('local_pg'), true);
    });

    test('the realtime transport swaps, and only on local_pg', () => {
      assert.equal(usesRealtimeBridge('supabase'), false);
      assert.equal(usesRealtimeBridge('local_pg'), true);
    });
  });
});
