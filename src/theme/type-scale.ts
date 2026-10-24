/**
 * The type-scale rules.
 *
 * These are pure functions so the rules can be tested without a renderer,
 * and so the `Text` primitive stays a thin composition of them.
 *
 * Style Guide §3.3, §3.4.
 */

import { isPersian, type FontWeight } from '@/src/theme/fonts';
import type { Language } from '@/src/i18n/types';

export type Variant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bodyL'
  | 'body'
  | 'caption'
  | 'button'
  | 'numeral';

export interface ScaleEntry {
  size: number;
  lineHeight: number;
  weight: FontWeight;
  /** Latin-only tracking. Never applied to Persian (§3.3). */
  tracking: number;
}

/** Style Guide §3.4 — sizes are for English; Persian adjustments apply at render. */
export const SCALE: Record<Variant, ScaleEntry> = {
  display: { size: 44, lineHeight: 48, weight: 800, tracking: -1.5 },
  h1: { size: 32, lineHeight: 38, weight: 800, tracking: -1 },
  h2: { size: 24, lineHeight: 30, weight: 700, tracking: -0.5 },
  h3: { size: 20, lineHeight: 26, weight: 700, tracking: 0 },
  bodyL: { size: 17, lineHeight: 24, weight: 500, tracking: 0 },
  body: { size: 15, lineHeight: 22, weight: 500, tracking: 0 },
  caption: { size: 13, lineHeight: 18, weight: 500, tracking: 0 },
  button: { size: 16, lineHeight: 20, weight: 700, tracking: 0 },
  numeral: { size: 56, lineHeight: 60, weight: 800, tracking: -2 },
};

const HEADING = new Set<Variant>(['display', 'h1', 'h2', 'h3', 'numeral']);

/** The font-scale cap for a variant (§3.4). */
export function fontScaleCap(variant: Variant): number {
  return HEADING.has(variant) ? 1.3 : 1.5;
}

export interface ResolvedType {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** The script of the content, which decides the font family. */
  isPersian: boolean;
}

/**
 * Resolves the type metrics for a piece of content.
 *
 * The content's SCRIPT decides the font family and the Latin adjustments; the
 * LOCALE decides the digit set, which is applied separately by the caller
 * (PRD-03 §3.2).
 */
export function resolveType(
  content: string,
  variant: Variant = 'body',
  isFaOverride?: boolean,
): ResolvedType {
  const fa = isFaOverride !== undefined ? isFaOverride : isPersian(content);
  const base = SCALE[variant];

  // Persian sits visually smaller: +1px size and +0.12 line-height ratio (§3.3)
  const fontSize = fa ? base.size + 1 : base.size;
  const lineHeight = fa
    ? Math.round(base.size * (base.lineHeight / base.size + 0.12))
    : base.lineHeight;

  // NEVER set letterSpacing on Persian — it breaks letter joining (§3.3)
  const letterSpacing = fa ? 0 : base.tracking;

  return { fontSize, lineHeight, letterSpacing, isPersian: fa };
}

/**
 * The weight for a variant, unless the caller overrides it.
 */
export function resolveWeight(variant: Variant, weight?: FontWeight): FontWeight {
  return weight ?? SCALE[variant].weight;
}

/**
 * The colour for a `Text`, given a theme-key-or-literal and the palette.
 *
 * A theme key is resolved against the palette; a literal colour passes
 * through unchanged.
 */
export function resolveColor(
  color: string | undefined,
  palette: Record<string, string>,
  fallback: string,
): string {
  if (color === undefined) return fallback;
  return palette[color] ?? color;
}

/**
 * The digit set for the active locale.
 *
 * The locale decides the digits, NOT the content's script — a Persian string
 * in an English app still shows Latin digits (PRD-03 §3.2).
 */
export function digitLocale(language: string): Language {
  return language === 'en' ? 'en' : 'fa';
}
