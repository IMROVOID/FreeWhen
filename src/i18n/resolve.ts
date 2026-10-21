/**
 * The language resolution rules.
 *
 * This module holds the PURE resolution logic — no I/O, no native import — so
 * it can be tested without a device. The bootstrap that wires it to the real
 * stored preference and device locale lives in `src/app-bootstrap.ts`.
 */

import { DEFAULT_LANGUAGE, type Language } from '@/src/i18n/types';

/** The inputs the resolution depends on. */
export interface LanguageResolutionInput {
  /** The user's stored preference, or `null` when there is none. */
  stored: Language | null;
  /** The device's language code, or `undefined` when it cannot be read. */
  deviceLanguageCode: string | undefined;
}

/**
 * The resolution order, deterministic:
 *
 *   1. the user's stored preference
 *   2. a device whose language is Persian
 *   3. **Persian**, always
 *
 * Step 3 is Persian, NOT the device locale. An Iranian user with an English
 * phone is common, and silently starting them in English is a worse default
 * than the reverse (PRD-10 D11, OQ-15.4).
 */
export function resolveLanguageFrom(input: LanguageResolutionInput): Language {
  if (input.stored === 'fa' || input.stored === 'en') return input.stored;

  if (input.deviceLanguageCode === 'fa') return 'fa';

  return DEFAULT_LANGUAGE;
}
