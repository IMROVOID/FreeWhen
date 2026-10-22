/**
 * The calling platform, for the funnel's `platform` field (PRD-12 §8.1).
 *
 * ★ WHY THIS IS A MODULE AND NOT A `Platform.OS` CHECK AT EACH CALL SITE.
 *
 * Nine services send `platform`. Hardcoding `'app'` in each of them made every
 * browser visitor indistinguishable from an app user in the funnel — the web
 * reviewer path would be invisible in the one dataset used to decide whether
 * the web surface is worth keeping. One resolver, one place to be right.
 *
 * `src/platform/environment.ts` holds the interface and its two suffixes, so
 * this module never imports React Native and stays importable from the Node
 * test runner.
 */

import { runtimePlatform } from '@/src/platform/environment';

export type RequestPlatform = 'web' | 'app';

/** `'web'` in a browser bundle, `'app'` on iOS and Android. */
export const REQUEST_PLATFORM: RequestPlatform =
  runtimePlatform() === 'web' ? 'web' : 'app';
