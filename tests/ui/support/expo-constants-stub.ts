/**
 * A minimal `expo-constants` stand-in.
 *
 * ★ THE REAL ONE PULLS IN `expo-modules-core`.
 *
 * Which reads `globalThis.expo.EventEmitter` at import time and throws in Node
 * before any test body runs. The transport (`src/lib/api.ts`) uses Constants for
 * exactly one thing — the dev-server host — and everything else it reads is the
 * environment, so an empty manifest is the honest stub for a Node run: there is
 * no dev server, and `EXPO_PUBLIC_*` values come from `process.env`.
 */

const Constants = {
  expoConfig: null,
  expoGoConfig: null,
  manifest: null,
  manifest2: null,
  platform: null,
  executionEnvironment: 'bare',
};

export default Constants;
