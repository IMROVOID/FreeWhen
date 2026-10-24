/**
 * The bundled font assets.
 *
 * The Vazirmatn files are bundled locally (Style Guide §3.1) rather than
 * fetched, so a Persian screen never renders in a fallback font.
 *
 * The `require` calls are the standard way to reference a Metro asset, and
 * Metro turns each into an asset URI. The `ttf` module type is declared in
 * `expo-env.d.ts`.
 */

export const vazirmatnFonts = {
  'Vazirmatn-Regular': require('@/assets/fonts/Vazirmatn-Regular.ttf'),
  'Vazirmatn-Medium': require('@/assets/fonts/Vazirmatn-Medium.ttf'),
  'Vazirmatn-SemiBold': require('@/assets/fonts/Vazirmatn-SemiBold.ttf'),
  'Vazirmatn-Bold': require('@/assets/fonts/Vazirmatn-Bold.ttf'),
  'Vazirmatn-ExtraBold': require('@/assets/fonts/Vazirmatn-ExtraBold.ttf'),
  Vazirmatn_Regular: require('@/assets/fonts/Vazirmatn-Regular.ttf'),
  Vazirmatn_Medium: require('@/assets/fonts/Vazirmatn-Medium.ttf'),
  Vazirmatn_SemiBold: require('@/assets/fonts/Vazirmatn-SemiBold.ttf'),
  Vazirmatn_Bold: require('@/assets/fonts/Vazirmatn-Bold.ttf'),
  Vazirmatn_ExtraBold: require('@/assets/fonts/Vazirmatn-ExtraBold.ttf'),
} as const;

export const vazirmatnFdFonts = {
  'VazirmatnFD-Regular': require('@/assets/fonts/VazirmatnFD-Regular.ttf'),
  'VazirmatnFD-Medium': require('@/assets/fonts/VazirmatnFD-Medium.ttf'),
  'VazirmatnFD-SemiBold': require('@/assets/fonts/VazirmatnFD-SemiBold.ttf'),
  'VazirmatnFD-Bold': require('@/assets/fonts/VazirmatnFD-Bold.ttf'),
  'VazirmatnFD-ExtraBold': require('@/assets/fonts/VazirmatnFD-ExtraBold.ttf'),
  VazirmatnFD_Regular: require('@/assets/fonts/VazirmatnFD-Regular.ttf'),
  VazirmatnFD_Medium: require('@/assets/fonts/VazirmatnFD-Medium.ttf'),
  VazirmatnFD_SemiBold: require('@/assets/fonts/VazirmatnFD-SemiBold.ttf'),
  VazirmatnFD_Bold: require('@/assets/fonts/VazirmatnFD-Bold.ttf'),
  VazirmatnFD_ExtraBold: require('@/assets/fonts/VazirmatnFD-ExtraBold.ttf'),
} as const;
