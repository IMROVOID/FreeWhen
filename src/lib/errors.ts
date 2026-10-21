/**
 * The error envelope.
 *
 * Every boundary returns this shape; no raw exception reaches a screen
 * (PRD-09 §5.2). The codes are byte-identical across locales so a client can
 * branch on them without parsing prose.
 */

export type ApiErrorCode =
  /** 404 — invalid, expired AND revoked. Byte-identical. */
  | 'INVITE_INVALID'
  /** 409 — only reachable with a valid token. */
  | 'EVENT_FULL'
  /** 403 */
  | 'NOT_PARTICIPANT'
  /** 403 */
  | 'NOT_ORGANIZER'
  /** 422, with a `fields` map. */
  | 'VALIDATION_FAILED'
  /** 429, with Retry-After. */
  | 'RATE_LIMITED'
  /** 200 — a degraded result, not a failure. The engine labels its confidence. */
  | 'PROVIDER_UNAVAILABLE';

export interface ApiError {
  error: ApiErrorCode;
  /** Persian, user-facing. */
  message: string;
  fields?: Record<string, string>;
}

export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  /** The wire shape — the same envelope the API returns. */
  toApiError(): ApiError {
    return this.fields
      ? { error: this.code, message: this.message, fields: this.fields }
      : { error: this.code, message: this.message };
  }
}

/** The HTTP status each code maps to. */
export const HTTP_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVITE_INVALID: 404,
  EVENT_FULL: 409,
  NOT_PARTICIPANT: 403,
  NOT_ORGANIZER: 403,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 200,
};

/** Whether a value is the error envelope. */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiError).error === 'string' &&
    'message' in value
  );
}
