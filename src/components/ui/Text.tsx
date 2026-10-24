import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { fonts, isPersian } from '@/src/theme/fonts';
import { useTheme } from '@/src/theme/useTheme';
import {
  digitLocale,
  fontScaleCap,
  resolveColor,
  resolveType,
  resolveWeight,
  type Variant,
} from '@/src/theme/type-scale';
import { digits } from '@/src/lib/format';

export type { Variant } from '@/src/theme/type-scale';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  variant?: Variant;
  weight?: 400 | 500 | 600 | 700 | 800;
  /** A theme colour key, or a literal colour. */
  color?: string;
  align?: 'start' | 'center' | 'end';
  /** Render the content's digits in the active locale's digit set. */
  numeric?: boolean;
  style?: RNTextProps['style'];
}

/**
 * The ONLY `Text` in the app. Raw `react-native` `Text` is banned in feature
 * code (Style Guide §3.2, §11.1, PRD-10 D18).
 */
export function Text({
  variant = 'body',
  weight,
  color,
  align = 'start',
  numeric = false,
  children,
  style,
  ...rest
}: TextProps) {
  const { t: theme } = useTheme();
  const { i18n } = useTranslation();

  const content = String(children ?? '');

  // The content decides the FONT; the locale decides the digits.
  const isFa =
    i18n.language === 'fa'
      ? (numeric || isPersian(content) || !/[a-zA-Z]/.test(content))
      : isPersian(content);

  const type = resolveType(content, variant, isFa);
  const resolvedWeight = resolveWeight(variant, weight);
  const family = isFa
    ? fonts.persian[resolvedWeight]
    : fonts.latin[resolvedWeight];

  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={fontScaleCap(variant)}
      style={[
        {
          fontFamily: family,
          fontSize: type.fontSize,
          lineHeight: type.lineHeight,
          letterSpacing: type.letterSpacing,
          textAlign: align,
          writingDirection: type.isPersian ? 'rtl' : 'ltr',
          color: resolveColor(color, theme as unknown as Record<string, string>, theme.text),
        },
        style,
      ]}
    >
      {numeric ? digits(content, digitLocale(i18n.language)) : children}
    </RNText>
  );
}
