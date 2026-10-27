/**
 * Every Postgres connection must carry TLS and real timeouts.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * `servicePool()` built `new Pool({ connectionString, max: 10 })` — no `ssl`, no
 * connect timeout, no statement timeout, no keepalive. `.github/scripts/db-migrate.sh`
 * appends `sslmode=require` for a managed provider because Neon and Supabase
 * refuse a connection without TLS, and its header notes the refusal "reads as
 * `password authentication failed`". The MIGRATION path therefore had TLS and the
 * RUNTIME path did not.
 *
 * The Vercel function opens a `Client` per request (`runWithClient`), so the
 * first request on a cold function pays a full TLS handshake. A handshake that
 * fails — because the URL has no `sslmode` — escapes the request scope and
 * surfaces as a bare `{"error":"internal"}` 500 from `driver.ts`, retried ten
 * seconds later by the poller. That is the reported symptom exactly: "some pages
 * get an error and only load after a second Retry".
 *
 * ★ WHY ONE BUILDER FOR BOTH PATHS.
 *
 * Two connection paths that each construct their own options is how they drifted
 * apart in the first place. `connectionOptions()` is the single place that decides
 * TLS and timeouts, and both the pool and the per-request client consume it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectionOptions, withRequiredTls } from '@/server/lib/connection-options';

test('TLS is appended to a managed-provider URL that names none', () => {
  // Arrange
  const url = 'postgres://user:pw@db.example.com:5432/freewhen';

  // Act
  const result = withRequiredTls(url);

  // Assert — the same rule the migration script applies.
  assert.ok(result.includes('sslmode=require'), `no sslmode was appended: ${result}`);
});

test('an existing sslmode is never overridden', () => {
  // Arrange
  const url = 'postgres://user:pw@db.example.com:5432/freewhen?sslmode=verify-full';

  // Act
  const result = withRequiredTls(url);

  // Assert — a deliberate operator choice wins over the default.
  assert.equal(result, url);
  assert.ok(!result.includes('require'), 'sslmode=verify-full was rewritten');
});

test('a loopback host is left alone, because a local Postgres has no certificate', () => {
  // Arrange
  const urls = [
    'postgres://user:pw@localhost:5432/freewhen',
    'postgres://user:pw@127.0.0.1:5432/freewhen',
    'postgres://user:pw@[::1]:5432/freewhen',
  ];

  // Act / Assert — guarding every one, since the migration script guards all three.
  for (const url of urls) {
    assert.equal(withRequiredTls(url), url, `a loopback host was rewritten: ${url}`);
  }
});

test('sslmode is joined onto a URL that already has a query string', () => {
  // Arrange
  const url = 'postgres://user:pw@db.example.com:5432/freewhen?application_name=freewhen';

  // Act
  const result = withRequiredTls(url);

  // Assert — `&`, not a second `?`.
  assert.ok(result.includes('&sslmode=require'), `query string was not respected: ${result}`);
  assert.ok(!result.includes('?application_name=freewhen?sslmode'), result);
});

test('the options carry a connect timeout, a statement timeout and keepalive', () => {
  // Arrange
  const url = 'postgres://user:pw@db.example.com:5432/freewhen';

  // Act
  const options = connectionOptions(url);

  // Assert — a handshake that hangs forever is a request that never answers.
  assert.ok(
    typeof options.connectionTimeoutMillis === 'number' && options.connectionTimeoutMillis > 0,
    'no connect timeout — a dead route hangs the request instead of failing it',
  );
  assert.ok(
    typeof options.statement_timeout === 'number' && options.statement_timeout > 0,
    'no statement timeout — one slow query pins the connection',
  );
  assert.equal(options.keepAlive, true, 'keepalive is off, so an idle socket dies silently');
});

test('the options ask for TLS when the URL was rewritten for it', () => {
  // Arrange
  const url = 'postgres://user:pw@db.example.com:5432/freewhen';

  // Act
  const options = connectionOptions(url);

  // Assert — `ssl` is what actually turns the handshake on in `pg`.
  assert.ok(options.ssl !== undefined, 'no ssl option, so the connection is cleartext');
});

test('a loopback URL asks for no TLS', () => {
  // Arrange
  const url = 'postgres://user:pw@localhost:5432/freewhen';

  // Act
  const options = connectionOptions(url);

  // Assert — a local Postgres commonly has no certificate, and demanding one
  // breaks `npm run db:local:up`.
  assert.equal(options.ssl, undefined, 'a loopback connection was forced to use TLS');
});
