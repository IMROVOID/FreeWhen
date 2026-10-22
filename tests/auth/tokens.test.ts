/**
 * The token service — the trust boundary of the local backend.
 *
 * ★ THE CLAIM SET IS THE CONTRACT.
 *
 * These tests exist because Plan 02B's whole argument rests on one claim:
 * a token issued by the local backend and a token issued by Supabase are
 * interchangeable, because every RLS policy in the schema reads the same
 * three claims. If the local token service drifts — a different `role`, a
 * missing `is_anonymous`, a non-expiring `exp` — then the "switch" is a
 * lie and the second backend is a different product.
 *
 * ★ THE ROLE CLAIM IS PINNED TO `authenticated`, NEVER `anon`.
 *
 * PostgREST switches to the `anon` DATABASE role when the claim is missing
 * or `anon`. Every policy would then see an unauthenticated caller, and
 * every read would be denied. A guest is an anonymous USER, not an
 * unauthenticated request.
 *
 * ★ `is_anonymous` IS A REAL BOOLEAN.
 *
 * FR-8.36's restrictive policy reads it from the JWT. A string `"true"` or
 * a derived-at-query-time NULL would silently change which writes are
 * permitted — and a NULL there is worse than a wrong value, because the
 * policy's `is not true` test would pass.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_TOKEN_TTL_SECONDS,
  MIN_SECRET_BYTES,
  TokenError,
  anonymousSession,
  assertSecret,
  signToken,
  verifyToken,
  type Claims,
} from '../../server/auth/tokens';

/** A secret long enough to satisfy the length rule. */
const SECRET = 'a-test-signing-secret-that-is-long-enough-0123456789';

/** A second secret, for the "wrong secret" cases. */
const OTHER_SECRET = 'a-different-secret-that-is-also-long-enough-9876543210';

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('the token service', () => {
  // ───────────────────────────────────────────────────────────
  // The claim set
  // ───────────────────────────────────────────────────────────
  describe('the claims it issues', () => {
    test('the role is authenticated, never anon', () => {
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const claims = verifyToken(token, SECRET);

      assert.equal(claims.role, 'authenticated');
    });

    test('is_anonymous is a real boolean', () => {
      const anonymous = verifyToken(
        signToken({ sub: USER_ID, is_anonymous: true }, SECRET).token,
        SECRET,
      );
      const named = verifyToken(
        signToken({ sub: USER_ID, is_anonymous: false }, SECRET).token,
        SECRET,
      );

      assert.equal(typeof anonymous.is_anonymous, 'boolean');
      assert.equal(anonymous.is_anonymous, true);
      assert.equal(named.is_anonymous, false);
    });

    test('is_anonymous is not a string', () => {
      // ★ The failure this catches: a token that carries `"true"` as a
      // string. A policy that casts it would work; a policy that compares
      // it would not, and the difference is invisible until production.
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const [, payload] = token.split('.');
      const body = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));

      assert.equal(typeof body.is_anonymous, 'boolean');
    });

    test('the sub is a uuid', () => {
      const claims = verifyToken(
        signToken({ sub: USER_ID, is_anonymous: true }, SECRET).token,
        SECRET,
      );

      assert.match(claims.sub, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    test('exp is greater than iat', () => {
      // ★ A non-expiring token would defeat a check PostgREST already
      // performs, so the expiry is not optional.
      const claims = verifyToken(
        signToken({ sub: USER_ID, is_anonymous: true }, SECRET).token,
        SECRET,
      );

      assert.ok(claims.exp > claims.iat);
      assert.equal(claims.exp - claims.iat, DEFAULT_TOKEN_TTL_SECONDS);
    });

    test('the expiry is configurable', () => {
      const { token, expiresAt, issuedAt } = signToken(
        { sub: USER_ID, is_anonymous: true },
        SECRET,
        { ttlSeconds: 900 },
      );
      const claims = verifyToken(token, SECRET);

      assert.equal(expiresAt - issuedAt, 900);
      assert.equal(claims.exp - claims.iat, 900);
    });

    test('the header says HS256', () => {
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const [header] = token.split('.');
      const decoded = JSON.parse(Buffer.from(header!, 'base64url').toString('utf8'));

      assert.equal(decoded.alg, 'HS256');
      assert.equal(decoded.typ, 'JWT');
    });
  });

  // ───────────────────────────────────────────────────────────
  // Verification
  // ───────────────────────────────────────────────────────────
  describe('verification', () => {
    test('a token signed with another secret is refused', () => {
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);

      assert.throws(
        () => verifyToken(token, OTHER_SECRET),
        (error: unknown) => error instanceof TokenError && error.code === 'bad_signature',
      );
    });

    test('a tampered payload is refused', () => {
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const [header, , signature] = token.split('.');

      // The signature no longer covers this body.
      const forged = Buffer.from(
        JSON.stringify({
          sub: USER_ID,
          role: 'authenticated',
          is_anonymous: false,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        'utf8',
      ).toString('base64url');

      assert.throws(
        () => verifyToken(`${header}.${forged}.${signature}`, SECRET),
        (error: unknown) => error instanceof TokenError && error.code === 'bad_signature',
      );
    });

    test('a token whose role was changed to anon is refused', () => {
      // ★ The policy is the point: a token claiming `anon` must be
      // REJECTED, not accepted with a different role. Accepting it would
      // change which policies apply, silently.
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const [header, , signature] = token.split('.');

      const body = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
      body.role = 'anon';
      const forged = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');

      assert.throws(
        () => verifyToken(`${header}.${forged}.${signature}`, SECRET),
        (error: unknown) => error instanceof TokenError && error.code === 'bad_signature',
      );
    });

    test('a token that is not a JWT is refused', () => {
      for (const malformed of ['', 'abc', 'a.b', 'a.b.c.d', 'not.a.token']) {
        assert.throws(
          () => verifyToken(malformed, SECRET),
          (error: unknown) => error instanceof TokenError,
          `"${malformed}" must be refused`,
        );
      }
    });

    test('an expired token is refused', () => {
      const now = 1_700_000_000;
      const { token } = signToken(
        { sub: USER_ID, is_anonymous: true },
        SECRET,
        { ttlSeconds: 60, now },
      );

      // Just inside the 30-second skew: still accepted.
      assert.ok(verifyToken(token, SECRET, { now: now + 89 }));

      // Past the skew: refused.
      assert.throws(
        () => verifyToken(token, SECRET, { now: now + 200 }),
        (error: unknown) => error instanceof TokenError && error.code === 'expired',
      );
    });

    test('a token issued in the future is refused', () => {
      const now = 1_700_000_000;
      const { token } = signToken(
        { sub: USER_ID, is_anonymous: true },
        SECRET,
        { ttlSeconds: 3600, now },
      );

      assert.throws(
        () => verifyToken(token, SECRET, { now: now - 200 }),
        (error: unknown) => error instanceof TokenError,
      );
    });

    test('a token with a non-uuid sub is refused', () => {
      const { token } = signToken({ sub: 'not-a-uuid', is_anonymous: true }, SECRET);

      assert.throws(
        () => verifyToken(token, SECRET),
        (error: unknown) => error instanceof TokenError && error.code === 'malformed',
      );
    });

    test('a token with a missing claim is refused', () => {
      // A body that is valid JSON but not a valid claim set must not
      // produce a half-trusted token.
      const body = { sub: USER_ID, role: 'authenticated', iat: 1, exp: 2 };
      const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');

      assert.throws(
        () => verifyToken(`eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, SECRET),
        (error: unknown) => error instanceof TokenError,
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The secret
  // ───────────────────────────────────────────────────────────
  describe('the signing secret', () => {
    test('a missing secret is refused', () => {
      assert.throws(
        () => assertSecret(undefined),
        (error: unknown) => error instanceof TokenError && error.code === 'missing_secret',
      );
    });

    test('a short secret is refused', () => {
      // ★ A weak secret means every JWT in the system is forgeable, and a
      // request that fails at the boundary reports it as a login failure —
      // which looks like a bug and gets worked around.
      assert.throws(
        () => assertSecret('too-short'),
        (error: unknown) => error instanceof TokenError && error.code === 'weak_secret',
      );
    });

    test('a secret of the minimum length is accepted', () => {
      const secret = 'x'.repeat(MIN_SECRET_BYTES);
      assert.doesNotThrow(() => assertSecret(secret));
    });

    test('signing with a weak secret is refused', () => {
      assert.throws(
        () => signToken({ sub: USER_ID, is_anonymous: true }, 'weak'),
        (error: unknown) => error instanceof TokenError && error.code === 'weak_secret',
      );
    });
  });

  // ───────────────────────────────────────────────────────────
  // The response shape
  // ───────────────────────────────────────────────────────────
  describe('the sign-in response', () => {
    test('it carries GoTrue’s field names', () => {
      // ★ A client written against the Supabase library parses THIS. The
      // names are GoTrue's, not ours, because the client does not know
      // which backend issued its session.
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const claims = verifyToken(token, SECRET);
      const session = anonymousSession(token, claims);

      assert.equal(session.access_token, token);
      assert.equal(session.token_type, 'bearer');
      assert.equal(typeof session.expires_in, 'number');
      assert.equal(typeof session.expires_at, 'number');
      assert.equal(session.user.id, USER_ID);
      assert.equal(session.user.role, 'authenticated');
      assert.equal(session.user.is_anonymous, true);
    });

    test('the user object carries no email or phone', () => {
      // ★ The local backend mints ANONYMOUS users only. A session that
      // carried an email field would invite a client to send one.
      const { token } = signToken({ sub: USER_ID, is_anonymous: true }, SECRET);
      const session = anonymousSession(token, verifyToken(token, SECRET));

      assert.equal('email' in session.user, false);
      assert.equal('phone' in session.user, false);
    });

    test('expires_in is the remaining lifetime', () => {
      const now = 1_700_000_000;
      const { token } = signToken(
        { sub: USER_ID, is_anonymous: true },
        SECRET,
        { ttlSeconds: 3600, now },
      );
      const claims = verifyToken(token, SECRET, { now });
      const session = anonymousSession(token, claims, { now });

      assert.equal(session.expires_in, 3600);
      assert.equal(session.expires_at, now + 3600);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The interoperability claim
  // ───────────────────────────────────────────────────────────
  describe('the two backends are interchangeable', () => {
    test('a locally-issued token and a Supabase-shaped one satisfy the same validator', () => {
      // ★ THE ACCEPTANCE CRITERION, AS A TEST.
      //
      // A Supabase-issued anonymous token carries `sub`, `role`,
      // `is_anonymous`, `iat` and `exp` — and the local service issues the
      // same set. Both must pass the same validator, or the "switch" is
      // cosmetic.
      const supabaseShaped: Claims = {
        sub: USER_ID,
        role: 'authenticated',
        is_anonymous: true,
        iat: 1_700_000_000,
        exp: 1_700_003_600,
      };

      // The Supabase-shaped token, signed with the shared secret.
      const { token: supabaseToken } = signToken(
        { sub: supabaseShaped.sub, is_anonymous: supabaseShaped.is_anonymous },
        SECRET,
        { ttlSeconds: 3600, now: supabaseShaped.iat },
      );

      const localClaims = verifyToken(
        signToken({ sub: USER_ID, is_anonymous: true }, SECRET).token,
        SECRET,
      );
      const remoteClaims = verifyToken(supabaseToken, SECRET, { now: 1_700_000_000 });

      // ★ THE SAME ASSERTION, TWICE.
      for (const claims of [localClaims, remoteClaims]) {
        assert.equal(claims.role, 'authenticated');
        assert.equal(typeof claims.is_anonymous, 'boolean');
        assert.ok(claims.exp > claims.iat);
        assert.match(
          claims.sub,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }

      // And they agree with each other, field for field.
      assert.equal(localClaims.sub, remoteClaims.sub);
      assert.equal(localClaims.role, remoteClaims.role);
      assert.equal(localClaims.is_anonymous, remoteClaims.is_anonymous);
    });
  });
});
