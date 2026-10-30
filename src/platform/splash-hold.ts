/**
 * How long the splash screen is held.
 *
 * ★ A SPLASH THAT IS GONE IN TWO FRAMES IS NOT A SPLASH.
 *
 * The native launch window is replaced as soon as the first React frame is ready,
 * and `expo-splash-screen`'s handle is hidden from `app/_layout.tsx` the moment
 * the fonts resolve. On a warm start that is faster than a person can register,
 * so the corrected logo flashed for under a tenth of a second and the report was
 * "the app is missing the splash screen" — with the asset correctly wired up the
 * whole time.
 *
 * The hold is measured from MODULE SCOPE, i.e. from process start, not from the
 * first React effect: a duration measured after the JS thread is up would add the
 * hold on top of a launch that had already finished.
 */
export const SPLASH_MIN_VISIBLE_MS = 450;
