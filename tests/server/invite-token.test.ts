/**
 * The token contract (Plan 05 Task 2, PRD-01 §13.1).
 *
 * These assertions ARE the security requirement: entropy, one-way storage,
 * constant-time comparison, and a lifetime that never outlives the evening.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INVITE_GRACE_MS,
  INVITE_TOKEN_HASH_LENGTH,
  INVITE_TOKEN_LENGTH,
  INVITE_TTL_MS,
  generateInviteToken,
  hashToken,
  inviteExpiresAt,
  inviteUrl,
  isTokenShaped,
  tokensMatch,
} from '@/server/lib/invite-token';

test('a token is 22 base64url characters — 128 bits of CSPRNG entropy', () => {
  const token = generateInviteToken();

  assert.equal(token.length, INVITE_TOKEN_LENGTH);
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
});

test('10 000 tokens are all distinct', () => {
  const seen = new Set<string>();
  for (let index = 0; index < 10_000; index++) {
    seen.add(generateInviteToken());
  }

  assert.equal(seen.size, 10_000);
});

test('the hash is 64 lowercase hex characters', () => {
  const hash = hashToken(generateInviteToken());

  assert.equal(hash.length, INVITE_TOKEN_HASH_LENGTH);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('the hash is deterministic and does not contain the token', () => {
  const token = 'abcdefghijklmnopqrstuv';

  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(`${token}x`));
  assert.equal(hashToken(token).includes(token), false);
});

test('tokensMatch is true only for the matching token', () => {
  const token = generateInviteToken();
  const hash = hashToken(token);

  assert.equal(tokensMatch(token, hash), true);
  assert.equal(tokensMatch(generateInviteToken(), hash), false);
  assert.equal(tokensMatch('', hash), false);
});

test('tokensMatch rejects a malformed stored hash without throwing', () => {
  const token = generateInviteToken();

  // A truncated or non-hex stored value must read as "no match", never crash
  // the request. A throw here would be a 500 an attacker can distinguish.
  assert.equal(tokensMatch(token, ''), false);
  assert.equal(tokensMatch(token, 'deadbeef'), false);
});

test('isTokenShaped accepts a real token and rejects everything else', () => {
  assert.equal(isTokenShaped(generateInviteToken()), true);

  assert.equal(isTokenShaped(''), false);
  assert.equal(isTokenShaped('a'.repeat(21)), false);
  assert.equal(isTokenShaped('a'.repeat(23)), false);
  assert.equal(isTokenShaped('a'.repeat(21) + '!'), false);
  // Padding is never produced by base64url, so a padded value is a probe.
  assert.equal(isTokenShaped('a'.repeat(20) + '=='), false);
});

test('expiry is the event end plus a day when that is sooner than a week', () => {
  const issued = new Date('2026-11-01T10:00:00.000Z');
  const windowEnd = new Date('2026-11-02T20:00:00.000Z');

  const expiry = inviteExpiresAt(windowEnd, issued);

  assert.equal(expiry.toISOString(), new Date(windowEnd.getTime() + INVITE_GRACE_MS).toISOString());
  assert.ok(expiry.getTime() < issued.getTime() + INVITE_TTL_MS);
});

test('expiry is a week out when the event is further away than that', () => {
  const issued = new Date('2026-11-01T10:00:00.000Z');
  const windowEnd = new Date('2027-03-01T20:00:00.000Z');

  const expiry = inviteExpiresAt(windowEnd, issued);

  assert.equal(expiry.toISOString(), new Date(issued.getTime() + INVITE_TTL_MS).toISOString());
});

test('the invite URL is rooted at the base and carries the token as the path', () => {
  const token = generateInviteToken();

  assert.equal(inviteUrl(token, 'https://freewhen.example'), `https://freewhen.example/e/${token}`);
  assert.equal(inviteUrl(token, 'https://freewhen.example/'), `https://freewhen.example/e/${token}`);
});
