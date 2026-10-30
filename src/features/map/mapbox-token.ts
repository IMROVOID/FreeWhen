/**
 * The MapBox token, and the one module allowed to read it.
 *
 * ★ THE TOKEN IS PUBLIC BY DESIGN, AND THAT IS NOT A LEAK.
 *
 * A `pk.` token is scoped to a URL pattern in the MapBox console and appears in
 * every request the browser makes, exactly like the publishable Supabase key. It
 * is INLINED at export time, so it must be in the bundler's shell — a value that
 * exists only on the host produces a bundle with an empty string, and the map
 * silently falls back to the level-4 state. `scripts/gate/env.ts` fails the build
 * for that omission, and `deploy.yml` / `ci.yml` / `release-apk.yml` all pass it.
 *
 * ★ AN `sk.` TOKEN HERE WOULD BE A REAL LEAK.
 *
 * `scripts/gate/credential-shapes.ts` rejects the secret form in any scanned
 * text, and `gate:secrets` runs before every export. This module does not
 * re-check the shape — a gate that runs once is better than two that disagree —
 * but it does refuse anything that is not `pk.`, so a misconfigured deploy
 * degrades to the stated unavailable state instead of shipping a secret.
 *
 * ★ ABSENT IS A STATE, NOT AN ERROR.
 *
 * `hasMapbox()` is read during render to choose between the real adapter and
 * `NullMapAdapter`. It must never throw: the browser build, the Node test runner
 * and an unbundled dev shell all reach it, and in two of those the variable does
 * not exist at all.
 */

/**
 * The public MapBox token, or `null` when this build has none.
 *
 * ★ THE REFERENCE MUST BE LITERAL, NOT REACHED THROUGH `globalThis`.
 *
 * The first version read `globalThis.process?.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN`.
 * Metro inlines `EXPO_PUBLIC_*` by rewriting the LITERAL member expression
 * `process.env.NAME`; anything else stays a runtime lookup, and a browser has no
 * `process`, so the bundle shipped with the variable NAME and no value. Every map
 * then rendered "unavailable" on a deployment that had configured the token
 * correctly — the exact silent failure the rest of this file exists to prevent.
 *
 * Verified by scanning `dist/` for the token after an export: with the literal
 * reference it is inlined, and the name does not appear.
 *
 * The `process` guard is a `typeof` check for the Node runner, which has no
 * bundled `process.env` substitution — it reads the real environment.
 */
export function readMapboxToken(): string | null {
  const raw =
    typeof process === 'undefined' ? undefined : process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;

  if (typeof raw !== 'string') return null;

  const token = raw.trim();

  // A secret token is never a fallback. Refusing it here means a deploy that
  // pasted the wrong variable renders the unavailable state rather than
  // publishing a credential to every visitor.
  if (token.startsWith('sk.')) return null;

  // A bare `pk.` is present but carries no payload — every request built from it
  // would be refused by MapBox, so the map would be blank with a valid prefix.
  if (!token.startsWith('pk.')) return null;
  if (token.length <= MIN_TOKEN_LENGTH) return null;

  return token;
}

/**
 * The shortest value that is plausibly a token.
 *
 * `pk.` plus a payload: an empty prefix passes a `startsWith` check and then
 * fails every request, which is the exact silent-blank failure this module is
 * for. The threshold is deliberately far below a real token's length (about 100
 * characters) so it rejects the degenerate case without ever rejecting a valid
 * one.
 */
const MIN_TOKEN_LENGTH = 8;

/** Whether this build can draw a MapBox basemap at all. */
export function hasMapbox(): boolean {
  return readMapboxToken() !== null;
}

/**
 * The MapBox styles, one per app theme.
 *
 * ★ A PAIR OF STYLES, NOT A RUNTIME TINT.
 *
 * MapBox's Standard style accepts `lightPreset`, which is the tidier-looking
 * option and the one the original Plan 08 note anticipated. It is not used here
 * because `lightPreset` is a Standard-only property: binding the product to a
 * style that can be replaced in the console without notice is a dependency on a
 * vendor detail this repo cannot test. Two named styles are a constant, and a
 * test can assert which one a theme resolves to.
 *
 * Both are public demo styles on the MapBox account, so they work with the same
 * public token and need no per-style provisioning.
 */
export const MAPBOX_STYLE = {
  light: 'mapbox://styles/mapbox/streets-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;

/**
 * The style for a resolved app theme.
 *
 * `name` is `useTheme()`'s own discriminant, so the map follows the same switch
 * as every other surface rather than re-reading the appearance store.
 */
export function styleForTheme(theme: 'light' | 'dark'): string {
  return MAPBOX_STYLE[theme];
}

/**
 * The MapBox Static Images base.
 *
 * Kept beside the tile style so the two picture paths — the interactive map and
 * the proposal preview — cannot drift to different providers.
 */
export const MAPBOX_STATIC_BASE = 'https://api.mapbox.com/styles/v1';

/** The zoom a static preview is rendered at. A neighbourhood. */
export const STATIC_ZOOM = 15;

/** The static image's pixel size, per axis, at 2x density. */
export const STATIC_SIZE = 640;
