/**
 * The test environment.
 *
 * The React Native runtime injects `__DEV__` as a global. Node does not, and
 * `expo`'s own bootstrap reads it, so it is defined here before any test
 * module is loaded.
 */

const globals = globalThis as unknown as { __DEV__?: boolean };

if (globals.__DEV__ === undefined) {
  globals.__DEV__ = true;
}

export {};
