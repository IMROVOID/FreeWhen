/**
 * A custom domain must work without a rebuild.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * Two independent failures made a verified custom domain unusable:
 *
 *  1. `EXPO_PUBLIC_API_URL` is INLINED at build time. Deploying to Vercel bakes
 *     in the `*.vercel.app` host, so a page served from the custom domain kept
 *     calling the old origin — cross-origin, for no reason, since the API is
 *     same-origin behind every supported host.
 *  2. `APP_ORIGIN` is a SINGLE exact-match string, so a request whose `Origin`
 *     is the custom domain matched nothing and got no CORS headers back. The
 *     browser reported "No 'Access-Control-Allow-Origin' header is present".
 *
 * Fixing only one of the two leaves the app broken: pointing the client at the
 * right origin still fails the preflight, and allowing the origin in CORS still
 * leaves the client calling the wrong host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBaseUrlFrom } from '@/src/lib/api-base-url';
import { isAllowedOrigin, parseAllowedOrigins } from '@/server/lib/cors';

// ──────────────────────────────────────────────────────────────────────────
// The client must not pin itself to the origin it was built on
// ──────────────────────────────────────────────────────────────────────────

test('on web, the page origin is used instead of a build-time origin', () => {
  // Arrange — what a deploy bakes in, and what the browser reports.
  const env = { EXPO_PUBLIC_API_URL: 'https://freewhen-orpin.vercel.app' };
  const page = 'https://freewhen.rovoid.tech';

  // Act
  const base = resolveBaseUrlFrom(env, undefined, 'web', page);

  // Assert — same-origin is the whole point: the API is served from the site
  // the page came from, so a custom domain needs no rebuild.
  assert.equal(base, page);
});

test('on web with no page origin (static render), the configured origin is used', () => {
  // Arrange — `expo export` renders in Node, where `location` does not exist.
  const env = { EXPO_PUBLIC_API_URL: 'https://freewhen-orpin.vercel.app' };

  // Act
  const base = resolveBaseUrlFrom(env, undefined, 'web', undefined);

  // Assert — the build-time value is still the fallback, not a hard failure.
  assert.equal(base, 'https://freewhen-orpin.vercel.app');
});

test('a native build keeps using the configured origin', () => {
  // Arrange — a native app has no page origin; there is nothing to derive.
  const env = { EXPO_PUBLIC_API_URL: 'https://freewhen.ir' };

  // Act
  const base = resolveBaseUrlFrom(env, undefined, 'android', undefined);

  // Assert
  assert.equal(base, 'https://freewhen.ir');
});

// ──────────────────────────────────────────────────────────────────────────
// The server must accept more than one origin
// ──────────────────────────────────────────────────────────────────────────

test('a comma-separated APP_ORIGIN allows each listed origin', () => {
  // Arrange
  const allowed = parseAllowedOrigins('https://freewhen.ir,https://freewhen.rovoid.tech');

  // Act / Assert
  assert.equal(isAllowedOrigin(allowed, 'https://freewhen.ir'), true);
  assert.equal(isAllowedOrigin(allowed, 'https://freewhen.rovoid.tech'), true);
});

test('an origin that is not listed stays rejected — this is not a wildcard', () => {
  // Arrange
  const allowed = parseAllowedOrigins('https://freewhen.rovoid.tech');

  // Act / Assert — reflected `Origin` headers are a credential-leak vector, so
  // an unlisted origin must still get nothing.
  assert.equal(isAllowedOrigin(allowed, 'https://evil.example'), false);
});

test('whitespace and trailing slashes around entries are tolerated', () => {
  // Arrange — a hand-edited CI variable very often carries both.
  const allowed = parseAllowedOrigins(' https://a.example/ , https://b.example ');

  // Act / Assert
  assert.equal(isAllowedOrigin(allowed, 'https://a.example'), true);
  assert.equal(isAllowedOrigin(allowed, 'https://b.example'), true);
});

test('an empty or unset APP_ORIGIN allows nothing', () => {
  // Arrange / Act
  const fromEmpty = parseAllowedOrigins('');
  const fromUndefined = parseAllowedOrigins(undefined);

  // Assert — fail closed, so a missing variable cannot open the API to all.
  assert.equal(isAllowedOrigin(fromEmpty, 'https://freewhen.rovoid.tech'), false);
  assert.equal(isAllowedOrigin(fromUndefined, 'https://freewhen.rovoid.tech'), false);
});

test('a missing Origin header is not treated as an allowed origin', () => {
  // Arrange — a same-origin navigation sends no Origin at all; CORS does not
  // apply to it, and answering with `allow-origin` would be meaningless.
  const allowed = parseAllowedOrigins('https://freewhen.rovoid.tech');

  // Act / Assert
  assert.equal(isAllowedOrigin(allowed, null), false);
});
