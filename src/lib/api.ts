/**
 * The client transport (PRD-09 §5.2).
 *
 * ★ THE CLIENT NEVER INVENTS AN ERROR MESSAGE.
 *
 * The server answers with `{ error, messageKey, fields }`. This module turns
 * that into a typed failure carrying the KEY, and the screen renders it through
 * `t()`. That is what makes the same response read «این لینک معتبر نیست…» in
 * Persian and "This link is not valid…" in English, and it is the reason no
 * route and no component holds a hardcoded sentence.
 *
 * A transport failure is distinct from a refusal — the join form keeps its
 * input and offers a retry, while a refusal explains itself.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { resolveBaseUrlFrom } from './api-base-url';
import { ApiFailure, FALLBACK_KEY, isApiFailure } from './api-failure';
import type { ApiErrorCode } from './errors';
import { REQUEST_PLATFORM, type RequestPlatform } from './platform-tag';

/**
 * The API origin resolution rule, re-exported so a caller does not have to know
 * it moved out of this module.
 */
export { resolveBaseUrlFrom };
export type { ApiEnv } from './api-base-url';

/**
 * The origin of the page this bundle is running in, on web only.
 *
 * ★ READ AT RUNTIME, NOT BAKED AT BUILD TIME.
 *
 * `process.env.EXPO_PUBLIC_*` is inlined by Metro, so a deployed build is
 * frozen to whichever host it was built for. Reading `location.origin` instead
 * means a verified custom domain works immediately, with no rebuild and no
 * redeploy — the app calls the host it was actually loaded from.
 *
 * `undefined` under static rendering, where `expo export` runs in Node and
 * there is no `window`; the resolver then falls back to the configured value.
 */
function pageOrigin(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  if (typeof window === 'undefined') return undefined;
  return window.location?.origin || undefined;
}

/**
 * The API origin for this bundle.
 *
 * On a physical device `127.0.0.1` is the phone, not the developer's machine,
 * so the Expo dev-server host is reused — it is the one address already known
 * to be reachable from the device running the bundle.
 *
 * The decision itself lives in `./api-base-url`, which imports nothing: this
 * module imports `expo-constants` (and `react-native`, for the platform), and
 * the Node test runner cannot transform that module graph. Keeping the resolver
 * separate is what makes it testable.
 *
 * `Platform.OS` is passed because an Android emulator has no dev-server host in
 * a release build, and reaches the host machine through `10.0.2.2` instead.
 */
function resolveBaseUrl(): string {
  return resolveBaseUrlFrom(
    {
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_APP_BASE_URL: process.env.EXPO_PUBLIC_APP_BASE_URL,
    },
    Constants.expoConfig?.hostUri,
    Platform.OS,
    pageOrigin(),
  );
}

export const API_BASE_URL = resolveBaseUrl();

/**
 * The failure type and its catalogue defaults, re-exported so no call site has
 * to know they moved out of this module.
 */
export { ApiFailure, FALLBACK_KEY, isApiFailure } from './api-failure';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** The caller's identity, when one has been minted. */
  userId?: string | null;
  /** `web` or `app`, for the funnel's `invite_link_opened`. */
  platform?: RequestPlatform;
}

/** A successful call: the body, plus the identity the server echoed. */
export interface ApiResult<T> {
  data: T;
  /**
   * The effective caller id.
   *
   * Both creation and join mint an anonymous identity when the request carried
   * none, and this header is how the client learns it — without it a guest
   * would mint a new identity on every visit and lose their participant row.
   */
  userId: string | null;
}

/**
 * One API call.
 *
 * ★ EVERY FAILURE LEAVES HERE AS AN `ApiFailure`.
 *
 * A refusal already did. A transport failure did not: `fetch` rejects with
 * `TypeError: Network request failed`, and that value is not an `ApiFailure`,
 * so every `isApiFailure(error) ? error.messageKey : 'errors.unknown'` guard in
 * the app missed it and fell through to a generic — or, on the event home, to
 * "you are not a participant", which is a lie about a dropped connection.
 * Wrapping it is what lets a screen tell "the server said no" apart from
 * "nothing answered" and offer a retry for the second.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', body, userId, platform = REQUEST_PLATFORM } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (userId) headers['x-user-id'] = userId;
  if (platform) headers['x-platform'] = platform;

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Status 0: the request never reached a server, so there is no status.
    throw new ApiFailure('NETWORK_ERROR', FALLBACK_KEY.NETWORK_ERROR, 0);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (response.ok) {
    return { data: payload as T, userId: response.headers.get('x-user-id') };
  }

  const envelope = (payload ?? {}) as {
    error?: ApiErrorCode;
    messageKey?: string;
    fields?: Record<string, string>;
  };

  const code = envelope.error ?? 'VALIDATION_FAILED';

  throw new ApiFailure(
    code,
    envelope.messageKey ?? FALLBACK_KEY[code],
    response.status,
    envelope.fields ?? {},
  );
}

/**
 * Whether an error indicates failure to reach the server (connection refused,
 * network offline, DNS failure, or gateway/proxy 502/503/504).
 */
export function isNetworkError(error: unknown): boolean {
  if (isApiFailure(error)) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  return error instanceof Error;
}
