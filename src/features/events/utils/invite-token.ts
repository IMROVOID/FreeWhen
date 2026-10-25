/**
 * Client-side invite token parser and validator.
 *
 * Extracts and validates 22-character base64url tokens from:
 * - Bare tokens (e.g. `dGVzdC10b2tlbi0xMjM0NTY`)
 * - Web URLs (e.g. `https://freewhen.app/e/dGVzdC10b2tlbi0xMjM0NTY`)
 * - Deep link URIs (e.g. `freewhen://e/dGVzdC10b2tlbi0xMjM0NTY`)
 */

const TOKEN_LENGTH = 22;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{22}$/;

/**
 * Checks whether a candidate string is shaped like a valid invite token.
 */
export function isTokenShaped(token: string): boolean {
  return token.length === TOKEN_LENGTH && TOKEN_REGEX.test(token);
}

/**
 * Extracts a valid invite token from user input (raw token or URL).
 * Returns `null` if the input cannot be resolved to a valid token.
 */
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct bare token check
  if (isTokenShaped(trimmed)) {
    return trimmed;
  }

  // Check URL / URI patterns (e.g. https://.../e/:token or freewhen://e/:token)
  // Match path segment following /e/
  const match = trimmed.match(/(?:\/e\/|^freewhen:\/\/e\/)([A-Za-z0-9_-]{22})(?:[/?#]|$)/i);
  if (match && match[1] && isTokenShaped(match[1])) {
    return match[1];
  }

  return null;
}
