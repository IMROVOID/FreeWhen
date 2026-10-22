import type { RuntimePlatform } from './environment';

/**
 * This file only ever runs in a browser bundle, so the answer is a constant.
 *
 * Deliberately does not consult `Platform.OS` from `react-native-web`: that
 * would make the web build depend on a module it does not otherwise need, for
 * an answer it already knows.
 */
export function runtimePlatform(): RuntimePlatform {
  return 'web';
}
