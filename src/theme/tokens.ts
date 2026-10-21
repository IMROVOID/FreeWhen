/**
 * Design tokens — transcribed from `docs/specs/FRONTEND_STYLE_GUIDE.md` §14.
 *
 * This is the FIRST file in the project. No component may hardcode a colour,
 * radius, spacing, duration or font name (Style Guide §0, §15, PRD-10 D18).
 */

export const palette = {
  espresso: '#170E0A',
  tangerine: '#FF7A2F',
  peach: '#FFD3B8',
  volt: '#D4FF3A',
  lilac: '#B8A4FF',
  mint: '#7AF0C8',
  pink: '#FF8FC2',
  success: '#2EE6A6',
  warning: '#FFC933',
  danger: '#FF4D5E',
} as const;

export const themes = {
  dark: {
    bg: '#120A07',
    surface1: '#1D1410',
    surface2: '#281C16',
    surface3: '#35261E',
    line: '#3F2F26',
    text: '#FFF6EF',
    textMuted: '#C2AEA2',
    textFaint: '#8C766A',
    primary: palette.volt,
    onPrimary: palette.espresso,
    brand: palette.tangerine,
    onBrand: palette.espresso,
    danger: palette.danger,
    onDanger: '#FFF6EF',
    success: palette.success,
    warning: palette.warning,
    info: palette.lilac,
  },
  light: {
    bg: '#FBF5EF',
    surface1: '#FFFFFF',
    surface2: '#F4EAE1',
    surface3: '#EADBCE',
    line: '#E4D3C5',
    text: '#170E0A',
    textMuted: '#6E5A4E',
    textFaint: '#A3907F',
    primary: palette.espresso,
    onPrimary: '#FFF6EF',
    brand: palette.tangerine,
    onBrand: palette.espresso,
    danger: palette.danger,
    onDanger: '#FFF6EF',
    success: palette.success,
    warning: palette.warning,
    info: palette.lilac,
  },
} as const;

export const participantColors = [
  palette.tangerine,
  palette.lilac,
  palette.mint,
  palette.pink,
  palette.volt,
  '#8CC8FF',
  '#FFC933',
  '#FF7A8A',
] as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 26,
  xl: 34,
  xxl: 44,
  pill: 999,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const border = {
  hairline: 1,
  strong: 2,
  ring: 2.5,
} as const;

/**
 * The component dimensions fixed by Style Guide §11 — button heights, the
 * tab bar, the stepper button, the sheet grabber.
 *
 * These are not spacing (which the 4pt grid covers) but fixed element sizes,
 * so they get their own scale rather than being forced onto the grid.
 */
export const size = {
  /** Button heights (§11.2). */
  buttonLarge: 56,
  buttonMedium: 48,
  buttonSmall: 40,
  /** The floating tab bar (§11.6). */
  tabBar: 64,
  /** The centre action button (§11.6). */
  tabBarAction: 56,
  /** The tab bar's active pill (§11.6). */
  tabItem: 44,
  /** The stepper's circular buttons (§11.11). */
  stepperButton: 44,
  /** The chip height (§11.4). */
  chip: 40,
  /** The segment inside a segmented control (§11.4). */
  segment: 36,
  /** The bottom sheet's grabber (§11.8). */
  grabberWidth: 36,
  grabberHeight: 4,
  /** The loading dots in a button (§11.2). */
  loadingDot: 6,
  /** The Meet Point's flash burst (§7.6.1). */
  meetPointFlash: 200,
} as const;

/** Style Guide §4.1 — nested radius: inner = outer − padding, floored at `radius.sm`. */
export const nestedRadius = (outer: number, padding: number): number =>
  Math.max(radius.sm, outer - padding);

export type ThemeName = keyof typeof themes;
/** Both palettes are the same shape, so a theme is either one of them. */
export type Theme = (typeof themes)[ThemeName];

/** Semantic colours that live outside the per-theme neutrals (Style Guide §2.4). */
export const semantic = {
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  info: palette.lilac,
} as const;

/**
 * A subset of a theme, so a component can accept `t.surface1` or a literal
 * semantic colour without widening its prop type to `string`.
 */
export type ThemeColor = keyof Theme;
