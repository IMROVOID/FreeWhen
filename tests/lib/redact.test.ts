import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTED,
  UNREADABLE,
  isSensitiveKey,
  logSafe,
  normaliseKey,
  redactObject,
  redactString,
  toLatinDigits,
} from '@/src/lib/redact';

test('redacts a flat forbidden key', () => {
  // Arrange
  const props = { lat: 35.7, name: 'x' };

  // Act
  const out = redactObject(props);

  // Assert
  assert.equal(out.lat, REDACTED);
  assert.equal(out.name, 'x');
});

test('redacts a coordinate nested in an object', () => {
  // Arrange
  const props = { event: { start_point: { lat: 35.7 } } };

  // Act
  const out = redactObject(props);

  // Assert: `start_point` is itself a forbidden key, so the whole subtree is
  // replaced — the nested coordinate cannot survive.
  const nested = out.event as Record<string, unknown>;
  assert.equal(nested.start_point, REDACTED);
});

test('redacts a coordinate inside an array', () => {
  // Arrange
  const props = { points: [{ lng: 51.4 }] };

  // Act
  const out = redactObject(props);

  // Assert
  const points = out.points as Array<Record<string, unknown>>;
  assert.equal(points[0]?.lng, REDACTED);
});

test('redacts a coordinate nested under a permitted key', () => {
  // Arrange: the parent key is not forbidden, so the child must still be caught
  const props = { event: { place: { lat: 35.7, lng: 51.4 } } };

  // Act
  const out = redactObject(props);

  // Assert
  const event = out.event as Record<string, Record<string, unknown>>;
  const place = event.place as Record<string, unknown>;
  assert.equal(place.lat, REDACTED);
  assert.equal(place.lng, REDACTED);
});

test('redacts a coordinate nested three levels deep', () => {
  // Arrange
  const props = { a: { b: { c: { lat: 35.7 } } } };

  // Act
  const out = redactObject(props);

  // Assert
  const a = out.a as Record<string, Record<string, Record<string, unknown>>>;
  const b = a.b as Record<string, Record<string, unknown>>;
  const c = b.c as Record<string, unknown>;
  assert.equal(c.lat, REDACTED);
});

test('redacts every forbidden key in the hostile fixture', () => {
  // Arrange: every forbidden key, plus nested coordinates and an array
  const props = {
    lat: 35.7,
    lng: 51.4,
    lat_rounded: 35.7,
    lng_rounded: 51.4,
    latitude: 35.7,
    longitude: 51.4,
    coordinate: [35.7, 51.4],
    coords: { lat: 35.7, lng: 51.4 },
    start_point: { lat: 35.7 },
    accuracy_m: 12,
    token: 'abc123',
    invite_token: 'abc123',
    invite_token_hash: 'deadbeef',
    auth_header: 'Bearer abc',
    text: 'پیام کاربر',
    pasted_text: 'متن چسبانده‌شده',
    body: 'متن پیام',
    phone: '+989123456789',
    display_name: 'داریا',
    event_id: 'e-1',
    context: 'home',
  };

  // Act
  const out = redactObject(props);

  // Assert: no forbidden key retains its original value
  const forbidden = [
    'lat', 'lng', 'lat_rounded', 'lng_rounded', 'latitude', 'longitude',
    'coordinate', 'coords', 'start_point', 'accuracy_m', 'token', 'invite_token',
    'invite_token_hash', 'auth_header', 'text', 'pasted_text', 'body', 'phone',
    'display_name',
  ];
  for (const key of forbidden) {
    assert.equal(out[key], REDACTED, `${key} should be redacted`);
  }

  // Assert: permitted keys survive
  assert.equal(out.event_id, 'e-1');
  assert.equal(out.context, 'home');
});

test('survives a hostile fixture with zero sensitive values in the output', () => {
  // Arrange
  const props = {
    lat: 35.7,
    lng: 51.4,
    token: 'secret-token-value',
    text: 'متن حساس کاربر',
    nested: { deeper: { start_point: { lat: 35.7, lng: 51.4 } } },
    list: [{ token: 'another-secret' }],
  };

  // Act
  const serialised = JSON.stringify(redactObject(props));

  // Assert
  assert.ok(!serialised.includes('35.7'));
  assert.ok(!serialised.includes('51.4'));
  assert.ok(!serialised.includes('secret-token-value'));
  assert.ok(!serialised.includes('another-secret'));
  assert.ok(!serialised.includes('متن حساس کاربر'));
});

// --- C2: the key match is normalised, not exact ---------------------------

test('redacts a coordinate under a differently-cased key', () => {
  // Act
  assert.equal(redactObject({ Lat: 35.7 }).Lat, REDACTED);
  assert.equal(redactObject({ LAT: 35.7 }).LAT, REDACTED);
});

test('redacts a coordinate under a prefixed key', () => {
  // Act
  assert.equal(redactObject({ user_lat: 35.7 }).user_lat, REDACTED);
  assert.equal(redactObject({ userLat: 35.7 }).userLat, REDACTED);
  assert.equal(redactObject({ latLng: 51.4 }).latLng, REDACTED);
});

test('redacts a token under a differently-spelled key', () => {
  // Act
  assert.equal(redactObject({ accessToken: 'abc' }).accessToken, REDACTED);
  assert.equal(redactObject({ access_token: 'abc' }).access_token, REDACTED);
  assert.equal(redactObject({ tokenValue: 'abc' }).tokenValue, REDACTED);
});

test('redacts a key that uses a Cyrillic homoglyph', () => {
  // Arrange — 'l' + Cyrillic 'а' + 't'
  const props = { 'l\u0430t': 35.7 };

  // Act
  const out = redactObject(props);

  // Assert
  assert.equal(out['l\u0430t'], REDACTED);
});

test('keeps a key that merely contains a fragment as a substring', () => {
  // Act — 'template' contains 'text' but is not a whole word
  assert.equal(redactObject({ template: 'balanced_floor' }).template, 'balanced_floor');
  assert.equal(redactObject({ latencies: 3 }).latencies, 3);
});

test('normaliseKey collapses spelling variants', () => {
  // Act / Assert
  assert.equal(normaliseKey('user_lat'), 'userlat');
  assert.equal(normaliseKey('userLat'), 'userlat');
  assert.equal(normaliseKey('USER-LAT'), 'userlat');
});

test('isSensitiveKey identifies the sensitive names', () => {
  // Act / Assert
  assert.equal(isSensitiveKey('lat'), true);
  assert.equal(isSensitiveKey('accessToken'), true);
  assert.equal(isSensitiveKey('display_name'), true);
  assert.equal(isSensitiveKey('event_id'), false);
  assert.equal(isSensitiveKey('context'), false);
});

// --- C3: string values are scrubbed ---------------------------------------

test('redacts a coordinate inside a string value', () => {
  // Act
  const out = redactObject({ note: '35.700000, 51.400000' });

  // Assert
  assert.ok(!String(out.note).includes('35.700000'));
  assert.ok(!String(out.note).includes('51.400000'));
});

test('redacts a coordinate inside a free-text chat message', () => {
  // Act
  const out = redactObject({ message: 'meet me at 35.7000, 51.4000' });

  // Assert
  assert.ok(!String(out.message).includes('35.7000'));
});

test('redacts a coordinate inside a nested string value', () => {
  // Act
  const out = redactObject({ a: { b: { c: 'at 35.700000, 51.400000' } } });
  const serialised = JSON.stringify(out);

  // Assert
  assert.ok(!serialised.includes('35.700000'));
});

// --- C4: the coordinate patterns -------------------------------------------

test('converts Persian and Arabic-Indic digits to Latin', () => {
  // Act / Assert
  assert.equal(toLatinDigits('\u06f3\u06f5.\u06f7'), '35.7');
  assert.equal(toLatinDigits('\u0663\u0665.\u0667'), '35.7');
});

test('strips a coordinate pair from free text', () => {
  // Arrange
  const text = 'موقعیت من 35.700000, 51.400000 است';

  // Act
  const out = redactString(text);

  // Assert
  assert.ok(!out.includes('35.700000'));
  assert.ok(!out.includes('51.400000'));
  assert.match(out, /موقعیت من/);
});

test('strips a negative coordinate pair', () => {
  // Act
  const out = redactString('-35.7000, -51.4000');

  // Assert
  assert.ok(!out.includes('35.7000'));
  assert.ok(!out.includes('51.4000'));
});

test('strips a coordinate pair with three decimals', () => {
  // Act
  const out = redactString('35.700, 51.400');

  // Assert
  assert.ok(!out.includes('35.700'));
  assert.ok(!out.includes('51.400'));
});

test('strips a coordinate pair with seven decimals', () => {
  // Act
  const out = redactString('35.7000000, 51.4000000');

  // Assert
  assert.ok(!out.includes('35.7000000'));
});

test('strips a space-separated coordinate pair', () => {
  // Act
  const out = redactString('35.700000 51.400000');

  // Assert
  assert.ok(!out.includes('35.700000'));
  assert.ok(!out.includes('51.400000'));
});

test('strips a coordinate pair behind a label', () => {
  // Act
  const out = redactString('lat: 35.7000, lng: 51.4000');

  // Assert
  assert.ok(!out.includes('35.7000'));
  assert.ok(!out.includes('51.4000'));
});

test('strips a Persian-digit coordinate pair', () => {
  // Act
  const out = redactString('\u06f3\u06f5.\u06f7\u06f0\u06f0\u06f0, \u06f5\u06f1.\u06f4\u06f0\u06f0\u06f0');

  // Assert
  assert.ok(!out.includes('35.7000'));
  assert.ok(!out.includes('51.4000'));
});

test('strips a degrees-minutes-seconds coordinate', () => {
  // Act
  const out = redactString('35\u00b041\'22"N 51\u00b024\'31"E');

  // Assert
  assert.ok(!out.includes('22'));
  assert.ok(!out.includes('31'));
});

test('leaves ordinary text untouched', () => {
  // Arrange
  const text = 'یک جلسه ساعت 19:00 است';

  // Act / Assert
  assert.equal(redactString(text), text);
});

test('leaves a short decimal that is not a coordinate pair alone', () => {
  // Arrange — a lone price, not a location
  const text = 'the total is 19.99';

  // Act / Assert
  assert.equal(redactString(text), text);
});

// --- H4: redaction never throws -------------------------------------------

test('does not throw on a getter that throws', () => {
  // Arrange
  const props = {
    bad: {
      get boom(): never {
        throw new Error('kaboom');
      },
    },
  };

  // Act / Assert — the value becomes UNREADABLE, the call does not throw
  const out = redactObject(props);
  assert.equal((out.bad as Record<string, unknown>).boom, UNREADABLE);
});

test('does not throw on a circular reference', () => {
  // Arrange
  const circular: Record<string, unknown> = { lat: 1 };
  circular.self = circular;

  // Act
  const out = redactObject(circular);

  // Assert
  assert.equal(out.lat, REDACTED);
  assert.equal(out.self, '[CIRCULAR]');
});

test('truncates a deeply nested payload instead of overflowing the stack', () => {
  // Arrange
  let deep: Record<string, unknown> = { value: 1 };
  for (let i = 0; i < 5000; i += 1) {
    deep = { next: deep };
  }

  // Act / Assert
  const out = redactObject(deep);
  assert.ok(JSON.stringify(out).includes('TRUNCATED'));
});

// --- H5: no prototype pollution -------------------------------------------

test('does not pollute the prototype of the result', () => {
  // Arrange
  const payload = JSON.parse('{"__proto__":{"isAdmin":true},"a":1}');

  // Act
  const out = redactObject(payload);

  // Assert — the result has NO prototype, so nothing is inherited
  assert.equal(Object.getPrototypeOf(out), null);
  assert.equal((out as Record<string, unknown>).isAdmin, undefined);
  assert.equal((Object.prototype as Record<string, unknown>).isAdmin, undefined);
  assert.equal(out.a, 1);
  // The `__proto__` key is recorded as redacted, not used as a prototype.
  assert.equal(out.__proto__, REDACTED);
});

test('the result has no prototype', () => {
  // Act / Assert
  assert.equal(Object.getPrototypeOf(redactObject({ a: 1 })), null);
});

// --- L1: value types are handled with intent -------------------------------

test('preserves a Date as an ISO string', () => {
  // Act
  const out = redactObject({ at: new Date('2026-08-02T12:00:00Z') });

  // Assert
  assert.equal(out.at, '2026-08-02T12:00:00.000Z');
});

test('drops a Map or a Set wholesale', () => {
  // Act
  const out = redactObject({
    m: new Map([['lat', 35.7]]),
    s: new Set([35.7]),
  });

  // Assert
  assert.equal(out.m, '[COLLECTION]');
  assert.equal(out.s, '[COLLECTION]');
});

// --- the logging path ------------------------------------------------------

test('logSafe redacts before writing anything', () => {
  // Arrange
  const original = console.log;
  const written: unknown[] = [];
  console.log = (...args: unknown[]) => {
    written.push(args);
  };

  try {
    // Act
    logSafe('test_event', { lat: 35.7, token: 'secret', event_id: 'e-1' });
  } finally {
    console.log = original;
  }

  // Assert
  const serialised = JSON.stringify(written);
  assert.ok(!serialised.includes('35.7'));
  assert.ok(!serialised.includes('secret'));
});
