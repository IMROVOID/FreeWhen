/**
 * gate:location — no background-location capability is declared.
 *
 * The app is foreground-only. A background-location permission would be
 * rejected by Play and is a privacy violation (PRD-08, PRD-13 §7).
 *
 * `app.json` is PARSED, not grepped. A substring scan cannot see the
 * Expo-native configuration that actually enables background location —
 * `expo-location` with `isAndroidBackgroundLocationEnabled`, or
 * `expo-build-properties` with the permission in `android.permissions`.
 */

import { join } from 'node:path';

import { PROJECT_ROOT, exists, fail, pass, readFile } from './shared';

const GATE = 'gate:location';

/**
 * Background location only. A foreground location permission is a legitimate
 * later-phase capability (the user picks a start point); background tracking
 * never is.
 */
const FORBIDDEN_PERMISSIONS = [
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE_LOCATION',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
];

const failures: string[] = [];
let scannedFiles = 0;

// --- app.json, parsed structurally ----------------------------------------

const appJsonPath = join(PROJECT_ROOT, 'app.json');
if (exists(appJsonPath)) {
  scannedFiles += 1;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFile(appJsonPath)) as Record<string, unknown>;
  } catch (error) {
    failures.push(`app.json is not valid JSON: ${(error as Error).message}`);
    config = {};
  }

  const expo = (config.expo ?? {}) as Record<string, unknown>;

  // A plugin that turns background location on.
  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  for (const plugin of plugins) {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    const options = Array.isArray(plugin) ? (plugin[1] ?? {}) : {};

    if (typeof name === 'string' && options && typeof options === 'object') {
      const flags = options as Record<string, unknown>;

      if (
        flags.isAndroidBackgroundLocationEnabled === true ||
        flags.isAndroidBackgroundLocationEnabled === 'true' ||
        flags.allowsBackgroundLocationUpdates === true ||
        flags.allowsBackgroundLocationUpdates === 'true'
      ) {
        failures.push(`app.json enables background location through the \`${name}\` plugin`);
      }

      // `expo-build-properties` can inject the permission directly.
      const android = (flags.android ?? {}) as Record<string, unknown>;
      const permissions = Array.isArray(android.permissions) ? android.permissions : [];
      for (const permission of permissions) {
        if (typeof permission !== 'string') continue;
        if (FORBIDDEN_PERMISSIONS.some((forbidden) => permission.includes(forbidden))) {
          failures.push(
            `app.json declares the background-location permission \`${permission}\` through the \`${name}\` plugin`,
          );
        }
      }
    }
  }

  // A permission declared directly on the android block.
  const androidBlock = (expo.android ?? {}) as Record<string, unknown>;
  const androidPermissions = Array.isArray(androidBlock.permissions)
    ? androidBlock.permissions
    : [];
  for (const permission of androidPermissions) {
    if (typeof permission !== 'string') continue;
    if (FORBIDDEN_PERMISSIONS.some((forbidden) => permission.includes(forbidden))) {
      failures.push(`app.json declares the background-location permission \`${permission}\``);
    }
  }
}

// --- The prebuilt native projects, when they exist ------------------------

const manifestPath = join(PROJECT_ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (exists(manifestPath)) {
  scannedFiles += 1;
  const manifest = readFile(manifestPath);
  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    if (manifest.includes(forbidden)) {
      failures.push(`AndroidManifest.xml declares \`${forbidden}\``);
    }
  }
}

const plistPath = join(PROJECT_ROOT, 'ios', 'FreeWhen', 'Info.plist');
if (exists(plistPath)) {
  scannedFiles += 1;
  const plist = readFile(plistPath);
  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    if (plist.includes(forbidden)) {
      failures.push(`Info.plist declares \`${forbidden}\``);
    }
  }
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, 'no background-location capability declared', scannedFiles);
