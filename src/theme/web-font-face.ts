/**
 * The `@font-face` rules for the web document.
 *
 * ★ THESE BELONG IN `<head>`, AND `expo-font` PUTS ITS OWN SOMEWHERE ELSE.
 *
 * `useFonts` on web injects `<style id="expo-generated-fonts">` at the END OF THE
 * DOCUMENT, after `</body>`. Static export prerenders the app's markup, so a
 * `TextInput` — a real `<input>` on web — that names
 * `fontFamily: PlusJakartaSans_500Medium` is parsed and laid out before those rules
 * exist. The browser commits to a fallback face and keeps it.
 *
 * That is why the defect surfaced on text BOXES rather than on labels: `Text`
 * renders through the same family names, but it is re-styled on the tick the app
 * hydrates, while the input had already committed its font.
 *
 * Emitting the faces early means the family exists before first paint, for the
 * prerendered document as well as the hydrated one. `useFonts` still runs — a
 * duplicate `@font-face` for the same family and file is harmless — so the native
 * build is untouched.
 *
 * ★ THE RULES ARE DERIVED FROM THE FONT MODULES, NOT TRANSCRIBED.
 *
 * A literal list drifts the first time a weight is added, and the failure is a
 * silent fallback face on one weight. Families come from `fonts`, files from the
 * asset map, so adding a weight updates the document.
 *
 * The builder takes plain `name → uri` records rather than importing
 * `font-assets.ts`, because that module `require()`s `.ttf` files that the Node
 * test runner cannot load — keeping them separate is what lets this be tested.
 */

import { fonts } from '@/src/theme/fonts';

/**
 * The public path of one vendored Jakarta file.
 *
 * `@expo-google-fonts/plus-jakarta-sans` ships `<weight>/<Family>.ttf`, and the
 * static export copies the package under `/assets/vendor/`. The family name in
 * `fonts.latin` IS the file stem, so only the directory has to be mapped.
 */
const JAKARTA_DIR: Record<string, string> = {
  PlusJakartaSans_400Regular: '400Regular',
  PlusJakartaSans_500Medium: '500Medium',
  PlusJakartaSans_600SemiBold: '600SemiBold',
  PlusJakartaSans_700Bold: '700Bold',
  PlusJakartaSans_800ExtraBold: '800ExtraBold',
};

export function jakartaUri(family: string): string {
  const dir = JAKARTA_DIR[family];
  if (!dir) return '';

  return `/assets/vendor/@expo-google-fonts/plus-jakarta-sans/${dir}/${family}.ttf`;
}

/**
 * One Metro asset, narrowed to a URI.
 *
 * `require()` of an asset yields a number on native and an object or string on web.
 * `Image.resolveAssetSource` would pull in a native module, so the value is read
 * for the shapes Metro actually emits.
 */
function assetUri(asset: unknown): string {
  if (typeof asset === 'string') return asset;

  if (asset && typeof asset === 'object') {
    const record = asset as { uri?: unknown; default?: unknown };
    if (typeof record.uri === 'string') return record.uri;
    if (typeof record.default === 'string') return record.default;
  }

  return '';
}

export interface FontFaceSources {
  /** The bundled Vazirmatn families, keyed by the family name `fonts` uses. */
  vazirmatn: Record<string, unknown>;
  /** The Farsi-digits build. */
  vazirmatnFd: Record<string, unknown>;
}

/** The complete `@font-face` block, ready to inline in `<head>`. */
export function fontFaceCss(sources: FontFaceSources): string {
  const rules: string[] = [];

  const add = (family: string, uri: string) => {
    // An empty URI would emit a face pointing nowhere, which is worse than absent:
    // the browser stops falling back to a family that works.
    if (!family || !uri) return;
    rules.push(`@font-face{font-family:"${family}";src:url("${uri}")}`);
  };

  for (const family of Object.values(fonts.latin)) {
    add(family, jakartaUri(family));
  }

  for (const family of Object.values(fonts.persian)) {
    add(family, assetUri(sources.vazirmatn[family]));
  }

  for (const [family, asset] of Object.entries(sources.vazirmatnFd)) {
    add(family, assetUri(asset));
  }

  return rules.join('');
}
