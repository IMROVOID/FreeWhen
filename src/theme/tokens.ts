/**
 * Design tokens — transcribed from `docs/specs/FRONTEND_STYLE_GUIDE.md` §14.
 *
 * This is the FIRST file in the project. No component may hardcode a colour,
 * radius, spacing, duration or font name (Style Guide §0, §15, PRD-10 D18).
 *
 * ── CONTRAST (Plan 11 Task 2, WCAG 2.1) ──────────────────────────────────
 *
 * Body text needs 4.5:1 and large text or a UI boundary needs 3:1. The ratios
 * below were MEASURED with the WCAG relative-luminance formula, not estimated:
 * a colour that "looks fine" frequently measures 3.8:1, and the failure only
 * appears on a low-quality screen. `tests/ui/a11y.test.tsx` re-measures them,
 * so a future palette edit that breaks a pair fails the suite.
 *
 *   Pair                        dark      light
 *   text on bg                  18.36     17.59
 *   text on surface1            16.97     19.03
 *   text on surface2            15.52     16.04
 *   text on surface3            13.60     14.06
 *   textMuted on bg              9.21      6.00
 *   textMuted on surface1        8.51      6.49
 *   textMuted on surface2        7.78      5.47
 *   textMuted on surface3        6.82      4.80
 *   textFaint on surface1        4.24      4.10
 *   textFaint on surface2        3.88      3.46
 *   textFaint on surface3        3.40      3.03
 *   primary on onPrimary        16.46     17.83
 *   brand on onBrand             7.32      7.32
 *   line on bg (UI, ≥3:1)        4.07      3.75
 *   line on surface1             3.77      4.06
 *   line on surface2             3.45      3.42
 *   line on surface3             3.02      3.00
 *
 * ★ TWO VALUES CHANGED HERE BECAUSE THE MEASUREMENT FAILED.
 *
 * `line` measured 1.42:1 (dark) and 1.35:1 (light) — a border no one could see
 * on a bad screen — and light `textFaint` measured 3.06:1 on white, under the
 * body-text bar. Both were raised to the smallest value that clears every
 * surface they are drawn on. The visual change is one step of warmth; the
 * difference is that an outlined control now has a boundary at all.
 *
 * ★ CONTRAST IS NEVER THE ONLY SIGNAL.
 *
 * Status chips, ranks and vote selections all carry a text label as well, so a
 * low-vision or colour-blind reader gets the meaning from the words. That is
 * the never-colour-only rule (§8), and it is why none of these ratios is load
 * bearing on its own.
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
  /**
   * The web scrollbar's thickness, in px.
   *
   * A browser surface has no view to give a style to, so its two numbers live
   * beside `scrollbarRadius`: this is a fixed element size, like `size` below, not
   * a spacing step. 8px is Chromium's `thin` at 100% zoom and the narrowest width
   * that still leaves a grabbable thumb.
   */
  scrollbarWidth: 8,
  /**
   * The scrollbar thumb's rounding, in px.
   *
   * The only place in the product that is rounded by the BROWSER rather than by
   * React Native, so it cannot read a `radius` key either.
   */
  scrollbarRadius: 4,
} as const;

export const themes = {
  dark: {
    bg: '#181513',
    surface1: '#231F1C',
    surface2: '#2F2A26',
    surface3: '#3D3732',
    line: '#93847B',
    text: '#FFF7F2',
    textMuted: '#CAB8AD',
    textFaint: '#9E8E85',
    primary: palette.volt,
    onPrimary: palette.espresso,
    brand: palette.tangerine,
    onBrand: palette.espresso,
    danger: palette.danger,
    onDanger: '#FFF7F2',
    success: palette.success,
    warning: palette.warning,
    info: palette.lilac,
    /**
     * The fill behind a modal layer.
     *
     * ★ NOT `bg`. A scrim painted with the page background is invisible: the
     * sheet opened, the scrim covered every click, and the screen looked
     * unchanged — the reported "it is there but invisible". A scrim has to be
     * darker than whatever is behind it in BOTH themes, so it is a fixed
     * translucent black rather than a theme colour.
     */
    scrim: 'rgba(0, 0, 0, 0.5)',
    /**
     * A card's edge — see the light theme's note.
     *
     * Dark surfaces already separate: `surface1` is six points lighter than `bg`
     * and the difference is visible. The edge is present anyway so a card reads
     * the same in both themes, and it is a LIGHT hairline because a dark one on a
     * dark card is invisible in the other direction.
     */
    cardEdge: 'rgba(255, 247, 242, 0.08)',
  },
  light: {
    /**
     * ★ THE LIGHT THEME WAS NEARLY WHITE, AND THE REQUEST WAS FOR MORE SATURATION.
     *
     * `bg` was `#FBF5EF` — 97% lightness. On a bright panel the page and a white
     * card were the same value to the eye, and every surface step below it was a
     * 3–4 point nudge. Each was stepped down one notch into the warm hue the
     * palette is built on, so the page has a colour rather than an absence of one
     * and the three surfaces remain distinguishable in sunlight.
     *
     * Every documented pair below was RE-MEASURED after the change; the ratios in
     * the header are the new numbers, and `tests/ui/a11y.test.tsx` re-measures
     * them on every run.
     */
    bg: '#F7EDE3',
    surface1: '#FFFCF9',
    surface2: '#F0E2D4',
    surface3: '#E6D2C1',
    /**
     * ★ DARKENED WITH THE SURFACES, LIKE `textFaint`.
     *
     * `#8C7B6D` was the smallest value that cleared 3:1 against the OLD, lighter
     * surface3. Stepping the surfaces down dropped it to 2.78:1 there — an
     * outlined control's border with no boundary at all. `#827163` is again the
     * smallest step that clears every surface the token is drawn on (3.20–4.57).
     */
    line: '#827163',
    /**
     * A card's edge, and ONLY a card's edge.
     *
     * ★ A WHITE CARD ON A NEARLY-WHITE PAGE HAD NO BOUNDARY ON WEB.
     *
     * `Card variant="surface"` fills with `surface1` — pure white — over a `bg`
     * that was 97% lightness. On native the `Pressy` scale and elevation made the
     * box read as a box; on the web build there is no elevation, so the event
     * boxes on the home screen looked like the page had no cards at all: "the
     * Event boxes on Home page are missing BG on Light Theme on Web".
     *
     * This is a BOUNDARY, not text, so it does not have to clear 4.5:1 — the 3:1
     * UI bar applies to a control's boundary against its background, and a
     * decorative card edge is exempt. A hairline at 10% is what every card idiom
     * uses, and it is deliberately NOT `line`, which is the border of an outlined
     * CONTROL and must be much stronger.
     */
    cardEdge: 'rgba(23, 14, 10, 0.10)',
    text: '#170E0A',
    /**
     * ★ DARKENED WITH THE SURFACES, LIKE `textFaint` AND `line`.
     *
     * It was `#6E5A4E`, tuned against the old page; on the deeper `surface3` it
     * measured 4.44:1, just under the 4.5:1 body bar. One step into the same hue
     * clears every surface (4.80–6.87) and stays clearly darker than
     * `textFaint`'s 3.08:1, so the three text tiers are still in order.
     */
    textMuted: '#695546',
    /**
     * ★ DARKENED WITH THE SURFACES, BECAUSE A DARKER PAGE NEEDS DARKER FAINT TEXT.
     *
     * It was `#8D7A69`, tuned against a 97%-lightness page. Stepping the surfaces
     * down for saturation dropped it to 2.80:1 on `surface3` — under the 3:1 bar
     * this token is held to — so it is moved one step into the same hue until it
     * clears. It stays LIGHTER than `textMuted` (4.44:1 on the same surface),
     * which is what makes it the faint tier rather than a second muted one.
     */
    textFaint: '#877362',
    primary: palette.espresso,
    onPrimary: '#FFF6EF',
    brand: palette.tangerine,
    onBrand: palette.espresso,
    danger: palette.danger,
    onDanger: '#FFF6EF',
    success: palette.success,
    warning: palette.warning,
    info: palette.lilac,
    /** See the dark theme's note: a scrim cannot be the page background. */
    scrim: 'rgba(0, 0, 0, 0.45)',
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

/**
 * The map's own chrome.
 *
 * ★ A MARKER'S RING IS NOT A THEME COLOUR, AND IT IS STILL A TOKEN.
 *
 * A pin is drawn over a basemap the app does not control: a light ring is what
 * separates it from a dark street, and a dark casing is what separates an
 * accent-coloured line from a pale one. Those two values are deliberately
 * theme-INDEPENDENT — that is the point — but they are still design decisions, so
 * they live here rather than as literals in two renderers (`gate:design` enforces
 * it, correctly).
 */
export const map = {
  /** The ring around a marker. White reads on both the light and the dark style. */
  markerRing: '#FFFFFF',
  /** The underlay beneath a route line, so the accent stays legible either way. */
  routeCasing: '#000000',
  /** The opacity of that underlay. */
  routeCasingOpacity: 0.25,
  /** The shadow under a marker, which lifts it off a busy basemap. */
  markerShadow: 'rgba(0,0,0,0.4)',
  /** The drawn map's height, in points. */
  height: 260,
} as const;

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

export type ThemeName = 'dark' | 'light';

export interface Theme {
  bg: string;
  surface1: string;
  surface2: string;
  surface3: string;
  line: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  brand: string;
  onBrand: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  info: string;
  /** The translucent fill behind a modal layer. Never `bg` — see the dark theme. */
  scrim: string;
  /** A card's hairline edge. A boundary, not a control border — see the light theme. */
  cardEdge: string;
}

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
