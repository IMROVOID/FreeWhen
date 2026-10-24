/**
 * The API origin resolver, kept free of React Native imports.
 *
 * ★ WHY THIS IS A SEPARATE MODULE FROM `api.ts`.
 *
 * `src/lib/api.ts` imports `expo-constants`, which reaches `react-native` —
 * and the Node test runner cannot transform that (it fails with
 * `Unexpected "typeof"`). Anything a unit test needs to import therefore cannot
 * live beside it, or the test cannot run at all.
 *
 * This module has no imports. `api.ts` reads the environment and the dev-server
 * host and calls in here, so the decision is testable and the transport stays
 * where it is.
 */

/** The development API port `server/index.ts` listens on. */
export const DEV_API_PORT = 8787;

/** The environment shape the resolver reads. Narrow on purpose. */
export interface ApiEnv {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_APP_BASE_URL?: string;
}

/**
 * The API origin, from the environment and the dev-server host.
 *
 * ★ `EXPO_PUBLIC_APP_BASE_URL` IS THE SECOND RUNG, AND IT IS THE ONE THAT MATTERS.
 *
 * `EXPO_PUBLIC_API_URL` was the only supported name, and it appeared in no
 * document in this repository — not `.env.example`, not `docs/ENV.md`, not the
 * README. A release APK built from the documented variable set therefore fell
 * through to the dev branch and shipped pointing at `http://<dev host>:8787`,
 * which on a participant's phone is the phone itself.
 *
 * The API is served same-origin behind Caddy (`Caddyfile`: `handle /api/*`), so
 * the app's own public origin *is* the API origin. `/api` is deliberately not
 * appended: every call site already prefixes its path, and appending here would
 * produce `/api/api/events`.
 *
 * The dev-server host stays as the third rung, because an Android emulator
 * reaching the host machine through `10.0.2.2` has no configured origin at all.
 */
export function resolveBaseUrlFrom(env: ApiEnv, hostUri: string | undefined): string {
  // An empty string is a variable that exists and was left blank — treated as
  // unset rather than as an empty origin, which would produce `/api/events`
  // against the app's own page.
  if (env.EXPO_PUBLIC_API_URL) return env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  if (env.EXPO_PUBLIC_APP_BASE_URL) return env.EXPO_PUBLIC_APP_BASE_URL.replace(/\/$/, '');

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${DEV_API_PORT}`;

  return `http://127.0.0.1:${DEV_API_PORT}`;
}
