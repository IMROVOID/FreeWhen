/**
 * Font families — transcribed from `docs/specs/FRONTEND_STYLE_GUIDE.md` §3.1 and §14.
 *
 * Android does not reliably map `fontWeight` to custom fonts (§3.2), so one
 * family name is registered per weight and selected through the `weight` prop
 * on the `Text` primitive — never through `fontWeight`.
 */

export type FontWeight = 400 | 500 | 600 | 700 | 800;

export const fonts = {
  latin: {
    400: 'PlusJakartaSans_400Regular',
    500: 'PlusJakartaSans_500Medium',
    600: 'PlusJakartaSans_600SemiBold',
    700: 'PlusJakartaSans_700Bold',
    800: 'PlusJakartaSans_800ExtraBold',
  },
  persian: {
    400: 'Vazirmatn-Regular',
    500: 'Vazirmatn-Medium',
    600: 'Vazirmatn-SemiBold',
    700: 'Vazirmatn-Bold',
    800: 'Vazirmatn-ExtraBold',
  },
  /** The "Farsi digits" build — renders Persian digits from Latin codepoints. */
  persianDigits: 'VazirmatnFD',
} as const satisfies {
  latin: Record<FontWeight, string>;
  persian: Record<FontWeight, string>;
  persianDigits: string;
};

/**
 * Dominant-script detection (§3.2). A Persian sentence with an embedded
 * English place name picks Vazirmatn; the fallback chain handles the
 * minority glyphs.
 */
export const isPersian = (s: string): boolean => /[؀-ۿ]/.test(s);
