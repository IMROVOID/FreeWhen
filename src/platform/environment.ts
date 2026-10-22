/**
 * The runtime environment, as a platform capability.
 *
 * ★ THE INTERFACE FILE. Metro substitutes `environment.native.ts` or
 * `environment.web.ts`; `tsc` resolves this one. Its body must therefore stay
 * pure — no `react-native`, no Expo — or it is evaluated in the web bundle and
 * in the Node test runner before the substitution is ever consulted.
 *
 * `'node'` exists because the test runner imports the shared modules directly.
 * A Node process is neither a browser nor a phone, and reporting it as either
 * would make a test assert the wrong thing.
 */

export type RuntimePlatform = 'web' | 'native' | 'node';

/**
 * Where this code is running.
 *
 * The type-system fallback answers `'node'`: it is the one value that is never
 * a claim about a user's device, so a caller that somehow reaches this body
 * gets an obviously-wrong answer rather than a plausible one.
 */
export function runtimePlatform(): RuntimePlatform {
  return 'node';
}
