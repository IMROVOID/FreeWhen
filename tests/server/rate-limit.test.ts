/**
 * The invite limiter (Plan 05 Task 12, PRD-08 FR-8.34).
 *
 * Every case drives a local `RateLimiter` with an injected clock, so the suite
 * is deterministic and cannot leak a bucket into another file's assertions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RATE_LIMIT_WINDOW_MS,
  REDEEM_PER_IP,
  REDEEM_PER_TOKEN,
  RateLimiter,
  clientIp,
} from '@/server/lib/rate-limit';

/** A clock the test advances by hand. */
function clockFrom(start: number): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test('the first ten redemptions from one address are allowed, the eleventh is not', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(REDEEM_PER_IP, RATE_LIMIT_WINDOW_MS, clock.now);

  for (let index = 1; index <= REDEEM_PER_IP; index++) {
    const result = limiter.check('203.0.113.7');
    assert.equal(result.allowed, true, `redemption ${index} should be allowed`);
    assert.equal(result.remaining, REDEEM_PER_IP - index);
  }

  const eleventh = limiter.check('203.0.113.7');
  assert.equal(eleventh.allowed, false);
  assert.equal(eleventh.remaining, 0);
  assert.ok(eleventh.retryAfterSeconds > 0);
});

test('one address exhausting its budget does not affect another', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(REDEEM_PER_IP, RATE_LIMIT_WINDOW_MS, clock.now);

  for (let index = 0; index < REDEEM_PER_IP; index++) limiter.check('198.51.100.1');
  assert.equal(limiter.check('198.51.100.1').allowed, false);

  assert.equal(limiter.check('198.51.100.2').allowed, true);
});

test('a rejected hit is not recorded — the penalty does not extend itself', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(2, RATE_LIMIT_WINDOW_MS, clock.now);

  limiter.check('k');
  limiter.check('k');
  assert.equal(limiter.check('k').allowed, false);

  // Half a window later the original two hits are still in the window, so the
  // caller is still blocked — but the rejections did not push the release out.
  clock.advance(RATE_LIMIT_WINDOW_MS / 2);
  assert.equal(limiter.check('k').allowed, false);

  // A full window after the originals, the budget is back.
  clock.advance(RATE_LIMIT_WINDOW_MS / 2 + 1);
  assert.equal(limiter.check('k').allowed, true);
});

test('the window slides, so a fixed-window boundary cannot double the limit', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(REDEEM_PER_IP, RATE_LIMIT_WINDOW_MS, clock.now);

  // Spend the budget at the very end of the first wall-clock hour.
  clock.advance(RATE_LIMIT_WINDOW_MS - 1);
  for (let index = 0; index < REDEEM_PER_IP; index++) limiter.check('k');

  // One millisecond later is a fixed-window boundary. A fixed window would
  // hand out a fresh ten; a sliding window must not.
  clock.advance(2);
  assert.equal(limiter.check('k').allowed, false);
});

test('a token has its own budget, separate from the address', () => {
  const clock = clockFrom(0);
  const byIp = new RateLimiter(REDEEM_PER_IP, RATE_LIMIT_WINDOW_MS, clock.now);
  const byToken = new RateLimiter(REDEEM_PER_TOKEN, RATE_LIMIT_WINDOW_MS, clock.now);

  // Ten addresses, one token: the token budget absorbs 10 of its 30.
  for (let index = 0; index < REDEEM_PER_IP; index++) {
    byIp.check(`ip-${index}`);
    byToken.check('token-hash');
  }

  assert.equal(byToken.check('token-hash').remaining, REDEEM_PER_TOKEN - REDEEM_PER_IP - 1);
});

test('retryAfterSeconds never reports zero for a blocked caller', () => {
  const clock = clockFrom(1_000);
  const limiter = new RateLimiter(1, RATE_LIMIT_WINDOW_MS, clock.now);

  limiter.check('k');
  // One millisecond before the bucket clears, a truthful answer is still 1s.
  clock.advance(RATE_LIMIT_WINDOW_MS - 1);

  const blocked = limiter.check('k');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
});

test('forget clears one bucket and reset clears all of them', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(1, RATE_LIMIT_WINDOW_MS, clock.now);

  limiter.check('a');
  limiter.check('b');
  assert.equal(limiter.size(), 2);

  limiter.forget('a');
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, false);

  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test('the tracked-key map is bounded, so chosen keys cannot exhaust memory', () => {
  const clock = clockFrom(0);
  const limiter = new RateLimiter(10, RATE_LIMIT_WINDOW_MS, clock.now);

  // Well past the cap. The limiter must evict rather than grow without bound.
  for (let index = 0; index < 20_000; index++) limiter.check(`key-${index}`);

  assert.ok(limiter.size() <= 5000, `tracked ${limiter.size()} keys`);
});

test('clientIp reads the left-most forwarded-for entry, not the proxy', () => {
  assert.equal(
    clientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 172.16.0.1' }),
    '203.0.113.7',
  );
  assert.equal(clientIp({ 'X-Forwarded-For': '203.0.113.8' }), '203.0.113.8');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.2' })), '203.0.113.9');
});

test('clientIp falls back to x-real-ip, and to a shared bucket when neither is present', () => {
  assert.equal(clientIp({ 'x-real-ip': '203.0.113.10' }), '203.0.113.10');
  assert.equal(clientIp({}), 'unknown');
  assert.equal(clientIp({ 'x-forwarded-for': '   ' }), 'unknown');
});
