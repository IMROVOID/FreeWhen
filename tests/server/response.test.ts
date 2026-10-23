/**
 * `Response` → platform result (Plan 40 T3).
 *
 * ★ WHAT IS BEING PROVEN HERE.
 *
 * The translation is invisible when correct and corrupting when wrong, so each
 * assertion corresponds to a specific way it can be wrong:
 *
 *  - a `204` producing the string `"null"` instead of an empty body
 *  - `isBase64Encoded` being omitted, so an event-object runtime one day decodes a PNG as UTF-8
 *  - header names arriving at API Gateway in mixed case and being duplicated
 *  - a health answer being cacheable, which would let a 200 outlive an outage
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CACHE_HEADER,
  NO_STORE,
  isBinary,
  resultHeaders,
  toDescriptorResult,
  toEventResult,
} from '@/server/runtime/response';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

describe('Response → event-object result', () => {
  it('passes a JSON body through byte-identically', async () => {
    const response = jsonResponse({ ok: true, db: 'up' });
    const expected = await response.clone().text();

    const result = await toEventResult(response);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body, expected);
    assert.equal(result.isBase64Encoded, false);
    assert.equal(JSON.parse(result.body).ok, true);
  });

  it('always states isBase64Encoded, even for text', async () => {
    // The failure this guards: omitting the flag works for JSON and silently
    // corrupts the first binary body ever served.
    const result = await toEventResult(new Response('hello'));
    assert.equal(result.isBase64Encoded, false);
    assert.ok('isBase64Encoded' in result);
  });

  it('emits an empty body for 204, never the string "null"', async () => {
    const result = await toEventResult(new Response(null, { status: 204 }));

    assert.equal(result.statusCode, 204);
    assert.equal(result.body, '');
    assert.notEqual(result.body, 'null');
    assert.equal(result.isBase64Encoded, false);
  });

  it('preserves the status the handler chose for a preflight', async () => {
    // `server/app.ts:219-221` answers OPTIONS with 204, not 200.
    const result = await toEventResult(new Response(null, { status: 204, headers: { 'access-control-allow-origin': 'https://app.test' } }));

    assert.equal(result.statusCode, 204);
    assert.equal(result.headers['access-control-allow-origin'], 'https://app.test');
  });

  it('lower-cases every header name', async () => {
    const result = await toEventResult(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc' } }),
    );

    assert.ok(Object.keys(result.headers).every((name) => name === name.toLowerCase()));
    assert.equal(result.headers['x-request-id'], 'abc');
    assert.equal(result.headers['content-type'], 'application/json');
  });

  it('marks a 503 no-store, and keeps a header that already set the policy', async () => {
    const unavailable = await toEventResult(jsonResponse({ error: 'internal' }, 503));
    assert.equal(unavailable.headers[CACHE_HEADER], NO_STORE);

    const explicit = await toEventResult(jsonResponse({ ok: true }, 200, { 'cache-control': 'max-age=60' }));
    assert.equal(explicit.headers[CACHE_HEADER], 'max-age=60', 'an explicit policy wins');
  });

  it('base64-encodes a binary body and decodes back to the same bytes', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    const result = await toEventResult(new Response(bytes, { headers: { 'content-type': 'image/png' } }));

    assert.equal(result.isBase64Encoded, true);

    const decoded = new Uint8Array(
      atob(result.body)
        .split('')
        .map((char) => char.charCodeAt(0)),
    );
    assert.deepEqual(decoded, bytes);
  });
});

describe('isBinary', () => {
  it('treats JSON, text, XML and forms as text', () => {
    for (const type of [
      'application/json',
      'application/json; charset=utf-8',
      'text/plain',
      'text/html; charset=utf-8',
      'application/xml',
      'application/javascript',
      'application/x-www-form-urlencoded',
    ]) {
      assert.equal(isBinary(type), false, `${type} is UTF-8 safe`);
    }
  });

  it('treats images, PDFs and octet-streams as binary', () => {
    for (const type of ['image/png', 'application/pdf', 'application/octet-stream', 'application/zip']) {
      assert.equal(isBinary(type), true, `${type} must be base64`);
    }
  });

  it('treats an absent content type as text, and an unknown one as binary', () => {
    assert.equal(isBinary(null), false);
    assert.equal(isBinary(undefined), false);
    // Guessing "text" for an unknown type is the corrupting direction.
    assert.equal(isBinary('application/vnd.freewhen.v1+proto'), true);
  });
});

describe('resultHeaders', () => {
  it('applies no-store when the response said nothing about caching', () => {
    const headers = resultHeaders(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    assert.equal(headers[CACHE_HEADER], NO_STORE);
  });
});

describe('Response → context/handler result', () => {
  it('carries status, headers and body bytes', async () => {
    const result = await toDescriptorResult(jsonResponse({ ok: true, db: 'up' }));

    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(new TextDecoder().decode(result.body as Uint8Array), '{"ok":true,"db":"up"}');
  });

  it('emits an empty body for 204', async () => {
    const result = await toDescriptorResult(new Response(null, { status: 204 }));
    assert.equal(result.status, 204);
    assert.equal((result.body as Uint8Array).length, 0);
  });
});
