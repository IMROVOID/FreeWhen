/**
 * The API origin resolver (Plan 41, Task 6).
 *
 * ★ WHY THIS TEST EXISTS AT ALL.
 *
 * `EXPO_PUBLIC_API_URL` was the only name `src/lib/api.ts` supported, and it
 * appears in no document in this repository. A release APK built from the
 * documented variable set fell through to the dev-host branch and
 * shipped pointing at 127.0.0.1:8787 (the phone itself) — an app that opens to
 * "load failed" on "My Events" because Android blocks cleartext and 127.0.0.1
 * is not the development host.
 *
 * ★ IMPORTED FROM `api-base-url`, NOT `api`.
 *
 * `api.ts` imports `expo-constants` and `react-native`, which the Node test
 * runner cannot transform. The resolver lives in its own import-free
 * module precisely so this file can run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBaseUrlFrom } from '@/src/lib/api-base-url';

test('EXPO_PUBLIC_API_URL wins when set', () => {
  // Arrange
  const env = {
    EXPO_PUBLIC_API_URL: 'https://api.example.test',
    EXPO_PUBLIC_APP_BASE_URL: 'https://app.example.test',
  };

  // Act
  const base = resolveBaseUrlFrom(env, '192.168.1.5:8081');

  // Assert
  assert.equal(base, 'https://api.example.test');
});

test('EXPO_PUBLIC_APP_BASE_URL is the fallback, and a trailing slash is stripped', () => {
  // Arrange
  const env = { EXPO_PUBLIC_APP_BASE_URL: 'https://freewhen.ir/' };

  // Act
  const base = resolveBaseUrlFrom(env, undefined);

  // Assert
  assert.equal(base, 'https://freewhen.ir');
});

test('the API path is not appended — call sites already prefix it', () => {
  // Arrange
  const env = { EXPO_PUBLIC_APP_BASE_URL: 'https://freewhen.ir' };

  // Act
  const base = resolveBaseUrlFrom(env, undefined);

  // Assert
  assert.ok(!base.endsWith('/api'), `base ends with /api: ${base}`);
});

test('the dev-server host is used when no origin is configured', () => {
  // Arrange — dev-server host with port
  const env = {};

  // Act
  const base = resolveBaseUrlFrom(env, '192.168.1.50:8081');

  // Assert
  assert.equal(base, 'http://192.168.1.50:8787');
});

test('on Android without configured origin or dev-server host, 10.0.2.2 is used', () => {
  // Arrange — Android release build running locally against host dev machine
  const env = {};

  // Act
  const base = resolveBaseUrlFrom(env, undefined, 'android');

  // Assert
  assert.equal(base, 'http://10.0.2.2:8787');
});

test('127.0.0.1 is the last resort on non-Android platforms', () => {
  // Arrange
  const env = {};

  // Act
  const base = resolveBaseUrlFrom(env, undefined, 'web');

  // Assert
  assert.equal(base, 'http://127.0.0.1:8787');
});

test('an empty string is treated as unset, not as an empty origin', () => {
  // Arrange
  const env = { EXPO_PUBLIC_API_URL: '', EXPO_PUBLIC_APP_BASE_URL: 'https://freewhen.ir' };

  // Act
  const base = resolveBaseUrlFrom(env, undefined);

  // Assert
  assert.equal(base, 'https://freewhen.ir');
});
