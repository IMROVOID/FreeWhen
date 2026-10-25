/**
 * The API failure types (PRD-09 §5.2).
 *
 * ★ SPLIT OUT OF `api.ts` SO IT CAN BE TESTED AT ALL.
 *
 * `api.ts` imports `expo-constants` and `react-native` for the host resolution,
 * and the Node test runner cannot transform either (`Unexpected "typeof"` out of
 * the Flow-typed React Native entry point). The failure TYPE is the part with
 * rules — a code, a catalogue key, a status, field keys — so it lives here where
 * a test can reach it, and `api.ts` re-exports it so call sites do not change.
 */

import type { ApiErrorCode } from './errors';

/** The default catalogue key per code, when the server omits `messageKey`. */
export const FALLBACK_KEY: Record<ApiErrorCode, string> = {
  INVITE_INVALID: 'errors.inviteInvalid',
  EVENT_FULL: 'errors.eventFull',
  NOT_PARTICIPANT: 'errors.notParticipant',
  NOT_ORGANIZER: 'errors.notOrganizer',
  VALIDATION_FAILED: 'errors.validationFailed',
  RATE_LIMITED: 'errors.rateLimited',
  PROVIDER_UNAVAILABLE: 'errors.providerUnavailable',
  INTERNAL_ERROR: 'errors.serverError',
  NETWORK_ERROR: 'errors.networkError',
};

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

/** Whether a thrown value is a refusal the UI can explain. */
export function isApiFailure(error: unknown): error is ApiFailure {
  return error instanceof ApiFailure;
}
