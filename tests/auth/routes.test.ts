/**
 * The auth routes and the sign-in rate limit.
 *
 * ★ THE RATE LIMIT IS 30 PER HOUR PER IP (FR-8.35), AND IT IS CONFIGURABLE.
 *
 * The limit has to exist on both backends, or the local one would be the
 * more permissive of the two — which is exactly the drift D22 exists to
 * prevent. FR-8.35 calls the platform default "adjustable", and the reason
 * is practical: a demo behind one NAT address has every attendee behind
 * one IP.
 *
 * ★ THE ORDER IS RATE LIMIT → CREATE USER → SIGN TOKEN.
 *
 * A client that has exhausted its budget must not create a user row.
 * Creating one and then refusing the token would leave an orphan
 * `auth.users` row per rejected request, and the cleanup job would have to
 * sweep rows that were never used.
 *
 * ★ THE ERROR BODY IS GOTRUE'S.
 *
 * `{ code, message, error_code, error }` — a client that reads
 * `error_code` for a rate-limited sign-in expects `rate_limit_exceeded`
 * and not an HTTP-status-only signal.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ANONYMOUS_PATH,
  AuthService,
  HEALTH_PATH,
  createAnonymousHandler,
  createHealthHandler,
  parseSignInBody,
  readConfig,
  type UserStore,
} from '../../server/auth/routes';
import {
  DEFAULT_SIGN_IN_LIMIT_PER_HOUR,
  readSignInLimit,
  resetSignInLimiter,
  signInRateLimitHeaders,
} from '../../server/auth/rate-limit';
import { verifyToken } from '../../server/auth/tokens';

const SECRET = 'a-test-signing-secret-that-is-long-enough-0123456789';
const USER_ID = '11111111-1111-1111-1111-111111111111';

/** A store that records what it was asked to do. */
function fakeStore(options: { fail?: boolean; reachable?: boolean } = {}) {
  const created: string[] = [];

  const store: UserStore = {
    async createAnonymousUser() {
      if (options.fail) throw new Error('the database is unreachable');
      created.push(USER_ID);
      return USER_ID;
    },
    async ping() {
      return options.reachable ?? true;
    },
  };

  return { store, created };
}

describe('the auth routes', () => {
  // ───────────────────────────────────────────────────────────
  // Configuration
  // ───────────────────────────────────────────────────────────
  describe('configuration', () => {
    test('a missing secret stops the service from starting', () => {
      // ★ AT CONSTRUCTION, NOT AT THE FIRST REQUEST.
      //
      // A service that starts without a signing secret fails later as a
      // login error the user cannot diagnose.
      assert.throws(
        () => readConfig({ env: {} }),
        /JWT_SECRET is not set/,
      );
    });

    test('a weak secret stops the service from starting', () => {
      assert.throws(
        () => readConfig({ env: { JWT_SECRET: 'short' } }),
        /at least 32 bytes/,
      );
    });

    test('the token lifetime is configurable and defaults to an hour', () => {
      assert.equal(readConfig({ env: { JWT_SECRET: SECRET } }).ttlSeconds, 3600);
      assert.equal(
        readConfig({ env: { JWT_SECRET: SECRET, ANON_TOKEN_TTL_SECONDS: '900' } }).ttlSeconds,
        900,
      );
    });

    test('an unparseable lifetime falls back to the default', () => {
      assert.equal(
        readConfig({ env: { JWT_SECRET: SECRET, ANON_TOKEN_TTL_SECONDS: 'soon' } }).ttlSeconds,
        3600,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The rate limit
  // ───────────────────────────────────────────────────────────
  describe('the sign-in rate limit', () => {
    test('it defaults to 30 per hour', () => {
      assert.equal(readSignInLimit({}), DEFAULT_SIGN_IN_LIMIT_PER_HOUR);
      assert.equal(DEFAULT_SIGN_IN_LIMIT_PER_HOUR, 30);
    });

    test('it is configurable', () => {
      assert.equal(readSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: '100' }), 100);
    });

    test('an unparseable limit falls back to the default', () => {
      // A limit of zero would refuse every sign-in; a limit of Infinity
      // would remove the protection. Neither is what a typo means.
      assert.equal(readSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: 'lots' }), 30);
      assert.equal(readSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: '0' }), 30);
      assert.equal(readSignInLimit({ ANON_SIGNIN_LIMIT_PER_HOUR: '-5' }), 30);
    });

    test('the 31st request in an hour is refused', async () => {
      const { store, created } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '30' });

      for (let attempt = 1; attempt <= 30; attempt += 1) {
        const response = await handler(
          new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
        );
        assert.equal(response.status, 200, `request ${attempt} should succeed`);
      }

      const refused = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );
      assert.equal(refused.status, 429);

      // ★ The limit is checked BEFORE the user is created, so a refused
      // request leaves no orphan row behind.
      assert.equal(created.length, 30);
    });

    test('the limit is per IP, not global', async () => {
      const { store } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '2' });

      const from = (ip: string) =>
        handler(
          new Request(`http://localhost${ANONYMOUS_PATH}`, {
            method: 'POST',
            headers: { 'x-forwarded-for': ip },
          }),
        );

      assert.equal((await from('10.0.0.1')).status, 200);
      assert.equal((await from('10.0.0.1')).status, 200);
      assert.equal((await from('10.0.0.1')).status, 429);

      // A different address has its own budget.
      assert.equal((await from('10.0.0.2')).status, 200);
    });

    test('the rate-limited response carries GoTrue’s error shape', async () => {
      const { store } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '1' });

      await handler(new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }));

      const refused = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );
      const body = (await refused.json()) as Record<string, unknown>;

      assert.equal(refused.status, 429);
      assert.equal(body.error_code, 'rate_limit_exceeded');
      assert.equal(body.error, 'rate_limit_exceeded');
      assert.equal(body.code, 429);
    });

    test('a rate-limited response says when to retry', async () => {
      const { store } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '1' });

      await handler(new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }));

      const refused = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );

      assert.ok(refused.headers.get('retry-after'));
      assert.ok(Number(refused.headers.get('retry-after')) > 0);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The sign-in response
  // ───────────────────────────────────────────────────────────
  describe('the sign-in response', () => {
    test('it returns a usable token', async () => {
      const { store } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '30' });

      const response = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );

      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        user: { id: string; role: string; is_anonymous: boolean };
      };

      assert.equal(body.token_type, 'bearer');
      assert.equal(body.user.id, USER_ID);
      assert.equal(body.user.role, 'authenticated');
      assert.equal(body.user.is_anonymous, true);

      // The token verifies, and its claims are the contract.
      const claims = verifyToken(body.access_token, SECRET);
      assert.equal(claims.sub, USER_ID);
      assert.equal(claims.role, 'authenticated');
      assert.equal(claims.is_anonymous, true);
    });

    test('an empty body is accepted — GoTrue accepts one', async () => {
      const { store } = fakeStore();
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '30' });

      const response = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );

      assert.equal(response.status, 200);
    });

    test('a malformed body is refused', async () => {
      const parsed = parseSignInBody('{not json');

      assert.equal(parsed.ok, false);
      assert.equal(!parsed.ok && parsed.error.error_code, 'validation_failed');
    });

    test('an empty body parses as valid', () => {
      assert.equal(parseSignInBody('').ok, true);
      assert.equal(parseSignInBody('   ').ok, true);
    });

    test('an unknown field in the body is ignored, not refused', async () => {
      // A client that adds a field must not break on one backend.
      const parsed = parseSignInBody('{"data":{},"something_new":true}');
      assert.equal(parsed.ok, true);
    });

    test('a store failure answers 500 without echoing the error', async () => {
      const { store } = fakeStore({ fail: true });
      const service = new AuthService(store, { secret: SECRET });
      const handler = createAnonymousHandler(service);

      resetSignInLimiter({ ANON_SIGNIN_LIMIT_PER_HOUR: '30' });

      const response = await handler(
        new Request(`http://localhost${ANONYMOUS_PATH}`, { method: 'POST' }),
      );

      assert.equal(response.status, 500);

      // The message must not publish the database's host or user.
      const body = (await response.json()) as { message: string };
      assert.ok(!/postgres|database|127\.0\.0\.1|5433/i.test(body.message));
    });
  });

  // ───────────────────────────────────────────────────────────
  // Health
  // ───────────────────────────────────────────────────────────
  describe('the health endpoint', () => {
    test('it reports a reachable database', async () => {
      const { store } = fakeStore({ reachable: true });
      const service = new AuthService(store, { secret: SECRET });
      const handler = createHealthHandler(service);

      const response = await handler(
        new Request(`http://localhost${HEALTH_PATH}`, { method: 'GET' }),
      );

      assert.equal(response.status, 200);

      const body = (await response.json()) as { status: string; backend: string };
      assert.equal(body.status, 'ok');
      assert.equal(body.backend, 'local_pg');
    });

    test('it reports an unreachable database as degraded', async () => {
      const { store } = fakeStore({ reachable: false });
      const service = new AuthService(store, { secret: SECRET });
      const handler = createHealthHandler(service);

      const response = await handler(
        new Request(`http://localhost${HEALTH_PATH}`, { method: 'GET' }),
      );

      assert.equal(response.status, 503);

      const body = (await response.json()) as { status: string };
      assert.equal(body.status, 'degraded');
    });
  });

  // ───────────────────────────────────────────────────────────
  // The headers
  // ───────────────────────────────────────────────────────────
  describe('the rate-limit headers', () => {
    test('an allowed request reports what is left', () => {
      const headers = signInRateLimitHeaders({ allowed: true, remaining: 29, retryAfterSeconds: 0 });

      assert.equal(headers['X-RateLimit-Remaining'], '29');
      assert.equal(headers['Retry-After'], undefined);
    });

    test('a refused request says when to retry', () => {
      const headers = signInRateLimitHeaders({ allowed: false, remaining: 0, retryAfterSeconds: 42 });

      assert.equal(headers['X-RateLimit-Remaining'], '0');
      assert.equal(headers['Retry-After'], '42');
    });
  });
});
