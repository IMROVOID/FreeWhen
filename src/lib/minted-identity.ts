/**
 * Which identity, if any, a response says the server just minted.
 *
 * ★ THE TWO MINTING ROUTES SPELL IT DIFFERENTLY, AND ONLY ONE WAS READ.
 *
 * The client persists the identity a minting route returns, so that the next
 * launch — and every later request — carries it. `src/lib/api.ts` read it from
 * the `x-user-id` RESPONSE HEADER only, because that is how `POST /api/events`
 * returns one.
 *
 * `PUT /api/profile` is the other minting route, and it is the one a first launch
 * reaches FIRST: the nickname gate saves before anything else in the app. It
 * returns the identity as a `userId` FIELD in the body. So the server created an
 * identity, the client threw it away, and:
 *
 *  - the gate re-appeared on every visit,
 *  - each save minted ANOTHER anonymous user, so the events created under one
 *    identity were invisible from every later one.
 *
 * The tolerance is in the transport rather than in the two routes because making
 * only them agree would leave the next route free to pick the other spelling.
 *
 * ★ IT LIVES HERE, NOT IN `api.ts`, FOR THE SAME REASON `api-base-url.ts` DOES.
 *
 * `src/lib/api.ts` imports `expo-constants` and `react-native`, and the Node test
 * runner cannot transform that module graph. Anything an assertion needs to touch
 * therefore cannot live beside it, or the test cannot run at all. This module
 * imports nothing.
 */

/** The minimal shape of a response this decision needs. */
export interface MintingResponse {
  headers: { get(name: string): string | null };
}

/**
 * The identity the server minted, or `null` when it minted none.
 *
 * The header wins when both are present: it is the older, already-relied-upon
 * spelling, and a route that sends both means the same value twice.
 *
 * The body is accepted only as a non-empty string, so a route that carries a
 * `userId` for some unrelated purpose — a response echoing the CALLER's id, say —
 * cannot be mistaken for a fresh identity unless it is genuinely one.
 */
export function mintedUserId(response: MintingResponse, payload: unknown): string | null {
  const header = response.headers.get('x-user-id');
  if (header && header.trim() !== '') return header;

  if (payload && typeof payload === 'object' && 'userId' in payload) {
    const value = (payload as { userId?: unknown }).userId;
    if (typeof value === 'string' && value.trim() !== '') return value;
  }

  return null;
}
