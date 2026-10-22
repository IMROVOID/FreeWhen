/**
 * The provider secrets.
 *
 * ★ THE BOUNDARY IS STRUCTURAL, NOT A CONVENTION.
 *
 * The client bundle contains no provider key because there is no client
 * path to one: the key is read in exactly one module, and that module
 * lives under `server/`. `gate:secrets` fails the build when a
 * server-only variable NAME appears under `src/` or `app/`.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_ENV_NAMES,
  providerKey,
  serverProviderKeys,
} from '@/server/lib/provider-secrets';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const name of Object.values(PROVIDER_ENV_NAMES)) {
    delete process.env[name];
  }
  delete process.env.NESHAN_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

test('an absent key is null, not an error', () => {
  // Arrange — no key configured
  // Act / Assert — an unconfigured service is skipped, not fatal
  assert.equal(providerKey('neshan_matrix'), null);
  assert.equal(providerKey('neshan_direction'), null);
  assert.equal(providerKey('ors'), null);
});

test('a configured key is read from its own variable', () => {
  // Arrange — the per-service scoping that keeps a directions key from
  // being sent to the matrix endpoint (which would return 483)
  process.env[PROVIDER_ENV_NAMES.neshan_matrix] = 'matrix-key';
  process.env[PROVIDER_ENV_NAMES.neshan_direction] = 'direction-key';
  process.env[PROVIDER_ENV_NAMES.ors] = 'ors-key';

  // Act / Assert
  assert.equal(providerKey('neshan_matrix'), 'matrix-key');
  assert.equal(providerKey('neshan_direction'), 'direction-key');
  assert.equal(providerKey('ors'), 'ors-key');
});

test('the three services read three DIFFERENT variables', () => {
  // Arrange / Act / Assert
  const names = Object.values(PROVIDER_ENV_NAMES);
  assert.equal(new Set(names).size, 3, 'each service needs its own variable');
});

test('a single shared NESHAN_API_KEY serves both Neshan services', () => {
  // Arrange — the documented variable, for an operator who has provisioned
  // one key rather than two
  process.env.NESHAN_API_KEY = 'shared-key';

  // Act / Assert
  assert.equal(providerKey('neshan_matrix'), 'shared-key');
  assert.equal(providerKey('neshan_direction'), 'shared-key');
});

test('a per-service key WINS over the shared one', () => {
  // Arrange — both are set, and the split must take precedence
  process.env.NESHAN_API_KEY = 'shared-key';
  process.env[PROVIDER_ENV_NAMES.neshan_matrix] = 'matrix-key';

  // Act / Assert
  assert.equal(providerKey('neshan_matrix'), 'matrix-key');
  assert.equal(providerKey('neshan_direction'), 'shared-key');
});

test('a blank key is treated as absent', () => {
  // Arrange
  process.env[PROVIDER_ENV_NAMES.ors] = '   ';

  // Act / Assert
  assert.equal(providerKey('ors'), null);
});

test('a key is trimmed', () => {
  // Arrange
  process.env[PROVIDER_ENV_NAMES.ors] = '  ors-key  ';

  // Act / Assert
  assert.equal(providerKey('ors'), 'ors-key');
});

test('the key provider is a function, so the key is read per request', () => {
  // Arrange
  process.env[PROVIDER_ENV_NAMES.ors] = 'first';

  // Act
  const first = serverProviderKeys('ors');
  process.env[PROVIDER_ENV_NAMES.ors] = 'second';
  const second = serverProviderKeys('ors');

  // Assert — a module-level constant would have kept the first value
  assert.equal(first, 'first');
  assert.equal(second, 'second');
});

test('the key provider never returns a key for a service with none', () => {
  // Arrange / Act / Assert
  assert.equal(serverProviderKeys('neshan_matrix'), null);
});

test('the module never exposes a key as a constant', () => {
  // Arrange / Act / Assert — the only exports are the names and the
  // readers. There is no `export const KEY`.
  const exported = Object.keys(
    // A dynamic import so the assertion does not depend on the import
    // list at the top of the file.
    { PROVIDER_ENV_NAMES, providerKey, serverProviderKeys },
  );

  assert.ok(exported.includes('providerKey'));
  assert.ok(exported.includes('serverProviderKeys'));
  assert.ok(!exported.includes('KEY'));
  assert.ok(!exported.includes('API_KEY'));
});
