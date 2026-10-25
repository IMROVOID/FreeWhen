import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { extractInviteToken } from '@/src/features/events/utils/invite-token';

describe('extractInviteToken', () => {
  const VALID_TOKEN = 'aB3_dE5-gH7_jK9-mN1_pQ'; // 22 chars base64url

  test('extracts bare 22-character token with valid chars', () => {
    assert.equal(extractInviteToken(VALID_TOKEN), VALID_TOKEN);
    assert.equal(extractInviteToken(`  ${VALID_TOKEN}  `), VALID_TOKEN);
  });

  test('extracts token from standard https URL', () => {
    assert.equal(
      extractInviteToken(`https://freewhen.app/e/${VALID_TOKEN}`),
      VALID_TOKEN,
    );
    assert.equal(
      extractInviteToken(`http://localhost:8081/e/${VALID_TOKEN}`),
      VALID_TOKEN,
    );
  });

  test('extracts token from custom scheme freewhen:// URL', () => {
    assert.equal(
      extractInviteToken(`freewhen://e/${VALID_TOKEN}`),
      VALID_TOKEN,
    );
  });

  test('extracts token from URL with trailing slash, query params, or hash', () => {
    assert.equal(
      extractInviteToken(`https://freewhen.app/e/${VALID_TOKEN}/`),
      VALID_TOKEN,
    );
    assert.equal(
      extractInviteToken(`https://freewhen.app/e/${VALID_TOKEN}?utm_source=chat`),
      VALID_TOKEN,
    );
    assert.equal(
      extractInviteToken(`https://freewhen.app/e/${VALID_TOKEN}#top`),
      VALID_TOKEN,
    );
  });

  test('returns null for empty or whitespace-only input', () => {
    assert.equal(extractInviteToken(''), null);
    assert.equal(extractInviteToken('   '), null);
  });

  test('returns null for invalid length or invalid characters', () => {
    assert.equal(extractInviteToken('short-token'), null);
    assert.equal(extractInviteToken('too-long-token-exceeding-22-characters'), null);
    assert.equal(extractInviteToken('invalid!char$in*token#22'), null);
  });

  test('returns null for URLs without /e/ segment', () => {
    assert.equal(extractInviteToken('https://freewhen.app/about'), null);
    assert.equal(extractInviteToken('https://google.com'), null);
  });
});
