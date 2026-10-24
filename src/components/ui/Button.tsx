import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text, type Variant } from './Text';
import { Pressy } from './Pressy';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'large' | 'medium' | 'small';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  testID?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

/** Style Guide §11.2 — height 56 (large), 48 (medium), 40 (small). */
const HEIGHTS: Record<ButtonSize, number> = {
  large: size.buttonLarge,
  medium: size.buttonMedium,
  small: size.buttonSmall,
};

const TEXT_VARIANTS: Record<ButtonSize, Variant> = {
  large: 'button',
  medium: 'button',
  small: 'caption',
};

/**
 * The primary action component. Always a pill, always with press feedback,
 * always with an accessible role and label (Style Guide §11.2).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  iconPosition = 'left',
  testID,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { t } = useTheme();
  const isDisabled = disabled || loading;

  const fill = fillFor(variant, t, isDisabled);
  const labelColor = labelColorFor(variant, t, isDisabled);

  return (
    <Pressy
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      haptic={variant === 'primary' ? 'medium' : 'light'}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        fullWidth ? styles.full : styles.inline,
        { height: HEIGHTS[size] },
        style,
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            backgroundColor: fill.background,
            borderColor: fill.border,
            borderWidth: fill.border === 'transparent' ? 0 : border.hairline,
          },
        ]}
      >
        {loading ? (
          <View style={styles.dots} accessibilityLabel={label}>
            <View style={[styles.dot, { backgroundColor: labelColor }]} />
            <View style={[styles.dot, { backgroundColor: labelColor }]} />
            <View style={[styles.dot, { backgroundColor: labelColor }]} />
          </View>
        ) : (
          <View style={styles.labelRow}>
            {icon && iconPosition === 'left' && <View style={styles.icon}>{icon}</View>}
            <Text variant={TEXT_VARIANTS[size]} color={labelColor} align="center">
              {label}
            </Text>
            {icon && iconPosition === 'right' && <View style={styles.icon}>{icon}</View>}
          </View>
        )}
      </View>
    </Pressy>
  );
}

interface Fill {
  background: string;
  border: string;
}

function fillFor(variant: ButtonVariant, t: ReturnType<typeof useTheme>['t'], isDisabled: boolean): Fill {
  if (isDisabled) {
    return { background: t.surface3, border: 'transparent' };
  }

  switch (variant) {
    case 'primary':
      return { background: t.primary, border: 'transparent' };
    case 'brand':
      return { background: t.brand, border: 'transparent' };
    case 'secondary':
      return { background: t.surface2, border: 'transparent' };
    case 'ghost':
      return { background: 'transparent', border: 'transparent' };
    case 'outline':
      return { background: 'transparent', border: t.line };
    case 'danger':
      return { background: t.danger, border: 'transparent' };
  }
}

function labelColorFor(
  variant: ButtonVariant,
  t: ReturnType<typeof useTheme>['t'],
  isDisabled: boolean,
): string {
  if (isDisabled) return t.textFaint;

  switch (variant) {
    case 'primary':
      return t.onPrimary;
    case 'brand':
      return t.onBrand;
    case 'secondary':
      return t.text;
    case 'ghost':
      return t.text;
    case 'outline':
      return t.text;
    case 'danger':
      return t.onPrimary;
  }
}

const styles = StyleSheet.create({
  full: {
    width: '100%',
  },
  inline: {
    alignSelf: 'flex-start',
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: space[5],
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  dot: {
    width: size.loadingDot,
    height: size.loadingDot,
    borderRadius: radius.pill,
  },
});
