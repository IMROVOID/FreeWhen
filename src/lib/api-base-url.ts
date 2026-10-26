/**
 * The API origin resolver, kept free of React Native imports.
 *
 * ★ WHY THIS IS A SEPARATE MODULE FROM `api.ts`.
 *
 * `src/lib/api.ts` imports `expo-constants` and `react-native` — and the Node
 * test runner cannot transform that (it fails with `Unexpected "typeof"`).
 * Anything a unit test needs to import therefore cannot live beside it, or
 * the test cannot run at all.
 *
 * This module has no imports. `api.ts` reads the environment, the dev-server
 * host, and platform, then calls in here, so the decision is testable and the
 * transport stays where it is.
 */

/** The development API port `server/index.ts` listens on. */
export const DEV_API_PORT = 8787;

/** The environment shape the resolver reads. Narrow on purpose. */
export interface ApiEnv {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_APP_BASE_URL?: string;
}

/**
 * The API origin, from the environment, the page's own origin, the dev-server
 * host, and platform.
 *
 * ★ ON WEB, THE PAGE ORIGIN WINS — AND THAT IS THE CUSTOM-DOMAIN FIX.
 *
 * `EXPO_PUBLIC_API_URL` is INLINED at build time. Deploying therefore bakes in
 * whichever host the build named (`*.vercel.app`), and a page later served from
 * a verified custom domain kept calling that old origin: cross-origin, and
 * refused by CORS because the allowlist named a single host.
 *
 * The API is served SAME-ORIGIN on every supported host (behind Caddy on the
 * VPS, and by a rewrite on the serverless targets), so the page's own origin is
 * always the right answer. Deriving it at RUNTIME means adding or changing a
 * domain needs no rebuild and no redeploy — the app simply calls the host it
 * was loaded from.
 *
 * `pageOrigin` is `undefined` during static rendering (`expo export` runs in
 * Node, with no `location`) and on native, where there is no page to derive
 * from; both fall through to the configured value.
 *
 * ★ `EXPO_PUBLIC_APP_BASE_URL` IS THE NATIVE RUNG THAT MATTERS.
 *
 * `EXPO_PUBLIC_API_URL` was the only supported name and it appeared in no
 * document in this repository — not `.env.example`, not `docs/ENV.md`, not the
 * README. A release APK built from the documented variable set therefore fell
 * through to the dev branch and shipped pointing at `http://<dev host>:8787`,
 * which on a participant's phone is the phone itself.
 *
 * `/api` is deliberately not appended: every call site already prefixes its
 * path, and appending here would produce `/api/api/events`.
 *
 * The dev-server host stays as the next rung, because an Android emulator
 * reaching the host machine through `10.0.2.2` has no configured origin.
 */
export function resolveBaseUrlFrom(
  env: ApiEnv,
  hostUri: string | undefined,
  platform?: string,
  pageOrigin?: string,
): string {
  // ★ FIRST, BECAUSE IT IS THE ONLY RUNTIME-TRUTHFUL ANSWER ON WEB.
  // A trailing slash is stripped so call sites can concatenate directly.
  if (platform === 'web' && pageOrigin) return pageOrigin.replace(/\/$/, '');

  // An empty string is a variable that exists and was left blank — treated as
  // unset rather than as an empty origin, which would produce `/api/events`
  // against the app's own page.
  if (env.EXPO_PUBLIC_API_URL) return env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  if (env.EXPO_PUBLIC_APP_BASE_URL) return env.EXPO_PUBLIC_APP_BASE_URL.replace(/\/$/, '');

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${DEV_API_PORT}`;

  if (platform === 'android') return `http://10.0.2.2:${DEV_API_PORT}`;

  return `http://127.0.0.1:${DEV_API_PORT}`;
}
