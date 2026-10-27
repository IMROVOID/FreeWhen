/**
 * The Babel configuration Metro uses to transform the app.
 *
 * ★ THIS FILE WAS MISSING, AND ITS ABSENCE WAS SILENT.
 *
 * Expo SDK 58 ships Reanimated 4, whose worklet transform is `babel-preset-expo`'s
 * `react-native-worklets/plugin` — but that plugin is only applied when a babel
 * config exists for Metro to read. With no config at all, Metro used
 * `babel-preset-expo`'s defaults with NO worklets transform, so every
 * `useAnimatedStyle` body threw on the UI thread at run time and every component
 * whose layout depended on an animated value rendered nothing.
 *
 * ★ THAT IS WHY SHEETS COULD NOT OPEN.
 *
 * `@gorhom/bottom-sheet` positions its panel entirely through Reanimated: the
 * container translates `onAnimatedPosition` and the panel is drawn only when that
 * value is on-screen. Without the transform the sheet mounts, measures, and stays
 * translated off-screen — on Android AND on web. Measured directly: no extra
 * window was raised and the accessibility tree never contained the sheet, while
 * the code that asks it to open ran normally.
 *
 * The list skeleton's shimmer had the same fault from the other direction: it
 * asked for a pulse and painted one static frame.
 *
 * `babel-preset-expo` adds `react-native-worklets/plugin` itself when it sees
 * Reanimated installed, so the preset alone is what was missing. It is listed
 * explicitly only so the requirement is visible in one place.
 */

module.exports = function (api) {
  api.cache(true);

  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
