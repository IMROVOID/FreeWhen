import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, runGate, withProbeFile } from './harness';

/**
 * Every gate must FAIL on a known-bad input.
 *
 * A gate that has only ever been observed reporting "clean" is a gate nobody
 * can trust — the Phase 1 review found five gates that passed on a tree
 * containing the exact leak they exist to prevent.
 */

test('gate:logs passes on a clean tree', () => {
  // Act
  const result = runGate('logs.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:logs fails on a direct console call', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    "export const f = () => console.warn('at', { lat: 35.7 });\n",
    () => runGate('logs.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /console\.warn/);
});

test('gate:logs fails on a sensitive key passed to a logger', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    "export const f = () => logSafe('event', {\n  lat: 35.7,\n  token: 'secret',\n});\n",
    () => runGate('logs.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /sensitive key/);
});

test('gate:logs fails on an aliased console call', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    "export const f = () => { const logger = console.log; logger({ lat: 35.7 }); };\n",
    () => runGate('logs.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /lat/);
});

test('gate:engine-purity passes when the engine does not exist yet', () => {
  // Act — the engine arrives in Phase 3, so an absent directory is not a
  // failure: there is nothing to be impure yet.
  const result = runGate('engine-purity.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:engine-purity fails on a React Native import', () => {
  // Act
  const result = withProbeFile(
    'src/engine/__gate_probe__.ts',
    "import { View } from 'react-native';\nexport const v = View;\n",
    () => runGate('engine-purity.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /react-native/);
});

test('gate:engine-purity fails on an Expo sub-package import', () => {
  // Act — the bare `expo` package was the only one the rule caught
  const result = withProbeFile(
    'src/engine/__gate_probe__.ts',
    "import { File } from 'expo-file-system';\nexport const f = File;\n",
    () => runGate('engine-purity.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /expo-file-system/);
});

test('gate:engine-purity fails on a require', () => {
  // Act
  const result = withProbeFile(
    'src/engine/__gate_probe__.ts',
    "const RN = require('react-native');\nexport const x = RN;\n",
    () => runGate('engine-purity.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /requires/);
});

test('gate:secrets passes on a clean tree', () => {
  // Act
  const result = runGate('secrets.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:secrets fails on a credential VALUE, not only its variable name', () => {
  // Act — the name `SUPABASE_SECRET_KEY` is harmless; the value is not
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    "export const k = 'sb_secret_9f8e7d6c5b4a2e1f3d9c';\n",
    () => runGate('secrets.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /Supabase key/);
});

test('gate:secrets fails on a JWT', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    "export const k = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VjcmV0';\n",
    () => runGate('secrets.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /JWT/);
});

test('gate:secrets fails on a server-only variable name in client code', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.ts',
    'export const key = process.env.NESHAN_API_KEY;\n',
    () => runGate('secrets.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /NESHAN_API_KEY/);
});

test('gate:design passes on a clean tree', () => {
  // Act
  const result = runGate('design.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:design fails on a hardcoded colour', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.tsx',
    "export const s = { backgroundColor: '#FF0000' };\n",
    () => runGate('design.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /hardcodes a colour/);
});

test('gate:design fails on a hardcoded spacing value', () => {
  // Act
  const result = withProbeFile(
    'src/__gate_probe__/probe.tsx',
    'export const s = { padding: 16 };\n',
    () => runGate('design.ts'),
  );

  // Assert
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, /spacing or radius/);
});

test('gate:i18n passes on a clean tree', () => {
  // Act
  const result = runGate('i18n.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:i18n fails when a key is missing from one catalogue', () => {
  // Act — a key is added to the Persian catalogue only
  const result = withProbeFile(
    'src/i18n/__gate_probe__.json',
    '{ "probe": { "onlyInOne": "x" } }\n',
    () => runGate('i18n.ts'),
  );

  // Assert — the probe file is not a catalogue, so the gate is unaffected.
  // This case documents that the gate reads ONLY the two catalogues.
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:i18n fails when the catalogues disagree', () => {
  // Arrange — the Persian catalogue gains a key the English one lacks
  const faPath = join(REPO_ROOT, 'src', 'i18n', 'fa.json');
  const original = readFileSync(faPath, 'utf8');

  try {
    const catalogue = JSON.parse(original) as Record<string, unknown>;
    catalogue.probe = { onlyInPersian: 'x' };
    writeFileSync(faPath, JSON.stringify(catalogue, null, 2), 'utf8');

    // Act
    const result = runGate('i18n.ts');

    // Assert
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /missing from en\.json/);
  } finally {
    writeFileSync(faPath, original, 'utf8');
  }
});

test('gate:location passes on a clean tree', () => {
  // Act
  const result = runGate('location.ts');

  // Assert
  assert.equal(result.exitCode, 0, result.output);
});

test('gate:location fails when a plugin enables background location', () => {
  // Arrange — the Expo-native configuration that actually turns background
  // location on, which a substring scan cannot see.
  const appJsonPath = join(REPO_ROOT, 'app.json');
  const original = readFileSync(appJsonPath, 'utf8');

  try {
    const config = JSON.parse(original) as { expo: { plugins: unknown } };
    config.expo.plugins = [['expo-location', { isAndroidBackgroundLocationEnabled: true }]];
    writeFileSync(appJsonPath, JSON.stringify(config, null, 2), 'utf8');

    // Act
    const result = runGate('location.ts');

    // Assert
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.output, /background location/);
  } finally {
    writeFileSync(appJsonPath, original, 'utf8');
  }
});

test('gate:web passes on a clean export', () => {
  // Act
  const result = runGate('web.ts');

  // Assert — the export must exist for this gate to be meaningful
  assert.equal(result.exitCode, 0, result.output);
});
