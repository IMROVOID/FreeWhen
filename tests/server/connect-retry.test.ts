/**
 * A readable failure is worth one cheap retry, and only one kind is.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * Opening a page occasionally showed a 500 from `GET
 * /api/events/:id/messages`, and a manual retry always worked. That signature —
 * intermittent, transient, gone on the second try — is a cold connection, not a
 * bug in the query: the serverless driver opens a fresh `pg` Client per request
 * (`server/runtime/driver.ts`), and the first attempt from a cold isolate can
 * lose its TCP/TLS handshake to the managed Postgres. The handler had never run,
 * nothing had been read or written, and the request was perfectly safe to repeat.
 *
 * ★ SO THE RETRY IS DELIBERATELY NARROW.
 *
 * Only a failure that happens BEFORE the handler runs is retried: the handshake
 * itself, or a connection that died under a socket the pool had already closed.
 * A statement timeout, a constraint violation, an application throw — anything
 * that means the work started — is surfaced immediately, because retrying work
 * that may have committed is how a double-write is born.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isTransientConnectFailure, withConnectRetry } from '@/server/runtime/connect-retry';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('a handshake that timed out or was refused is transient', () => {
  // Arrange — the messages that a cold isolate actually sees.
  const errors = [
    new Error('Connection terminated unexpectedly'),
    new Error('timeout expired'),
    new Error('connect ETIMEDOUT 10.0.0.1:5432'),
    new Error('connect ECONNREFUSED 10.0.0.1:5432'),
    new Error('Connection terminated due to connection timeout'),
    new Error('read ECONNRESET'),
    new Error('ssl3_get_record:wrong version number'),
  ];

  // Act / Assert
  for (const error of errors) {
    assert.ok(isTransientConnectFailure(error), `${error.message} is not treated as transient`);
  }
});

test('a statement timeout is NOT transient — the handler had already run', () => {
  // Arrange — `statement_timeout` fires after the query started; replaying it
  // could duplicate a write.
  const errors = [
    new Error('canceling statement due to statement timeout'),
    new Error('duplicate key value violates unique constraint "participant_pkey"'),
    new Error('permission denied for table event_message'),
    new Error('syntax error at or near "slect"'),
  ];

  // Act / Assert
  for (const error of errors) {
    assert.ok(!isTransientConnectFailure(error), `${error.message} must not be retried`);
  }
});

test('a non-error is never retried', () => {
  // Act / Assert — a string, a null and a plain object are not failures we can
  // classify, and guessing costs a double request.
  assert.equal(isTransientConnectFailure('boom'), false);
  assert.equal(isTransientConnectFailure(null), false);
  assert.equal(isTransientConnectFailure(undefined), false);
  assert.equal(isTransientConnectFailure({ message: 'timeout expired' }), false);
});

test('the retry runs the operation again exactly once', async () => {
  // Arrange
  let attempts = 0;

  // Act
  const result = await withConnectRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Connection terminated unexpectedly');
    return 'ok';
  });

  // Assert — one retry, and the second answer is the one returned.
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('a second identical failure is surfaced, not retried forever', async () => {
  // Arrange
  let attempts = 0;

  // Act / Assert
  await assert.rejects(
    withConnectRetry(async () => {
      attempts += 1;
      throw new Error('timeout expired');
    }),
    /timeout expired/,
  );
  assert.equal(attempts, 2, `the operation ran ${attempts} times, expected exactly 2`);
});

test('a non-transient failure is not retried at all', async () => {
  // Arrange
  let attempts = 0;

  // Act / Assert
  await assert.rejects(
    withConnectRetry(async () => {
      attempts += 1;
      throw new Error('duplicate key value violates unique constraint');
    }),
    /duplicate key/,
  );
  assert.equal(attempts, 1, `the operation ran ${attempts} times, expected 1`);
});

test('a successful call is not delayed or repeated', async () => {
  // Arrange
  let attempts = 0;

  // Act
  const value = await withConnectRetry(async () => {
    attempts += 1;
    return 42;
  });

  // Assert
  assert.equal(value, 42);
  assert.equal(attempts, 1);
});

test('the driver routes its connect through the retry', () => {
  // Arrange — a helper nothing calls fixes nothing.
  const driver = code('server/runtime/driver.ts');

  // Act / Assert
  assert.ok(/withConnectRetry/.test(driver), 'the serverless driver does not retry a cold handshake');
  assert.ok(
    /handleRequest\(request\)|withRequestQueryable/.test(driver),
    'the driver no longer routes requests through the scoped queryable',
  );
});
