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
import type { ApiErrorCode } from './errors';
import { REQUEST_PLATFORM, type RequestPlatform } from './platform-tag';

export { resolveBaseUrlFrom };
export type { ApiEnv } from './api-base-url';

function resolveBaseUrl(): string {
  return resolveBaseUrlFrom(
    {
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_APP_BASE_URL: process.env.EXPO_PUBLIC_APP_BASE_URL,
    },
    Constants.expoConfig?.hostUri,
    Platform.OS,
  );
}

export const API_BASE_URL = resolveBaseUrl();

/** A refused request, carrying the server's code and catalogue key. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly messageKey: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(messageKey);
    this.name = 'ApiFailure';
  }

  /** The key for a specific field, when the server supplied one. */
  fieldError(field: string): string | undefined {
    return this.fields[field];
  }
}

/** The default catalogue key per code, when the server omits `messageKey`. */
const FALLBACK_KEY: Record<ApiErrorCode, string> = {
  INVITE_INVALID: 'errors.inviteInvalid',
  EVENT_FULL: 'errors.eventFull',
  NOT_PARTICIPANT: 'errors.notParticipant',
  NOT_ORGANIZER: 'errors.notOrganizer',
  VALIDATION_FAILED: 'errors.validationFailed',
  RATE_LIMITED: 'errors.rateLimited',
  PROVIDER_UNAVAILABLE: 'errors.providerUnavailable',
};

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
 * Throws `ApiFailure` when the server refuses, and the underlying error when
 * nothing answered at all.
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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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

/** Whether a thrown value is a refusal the UI can explain. */
export function isApiFailure(error: unknown): error is ApiFailure {
  return error instanceof ApiFailure;
}
