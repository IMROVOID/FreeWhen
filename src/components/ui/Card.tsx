import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Pressy } from './Pressy';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type CardVariant = 'surface' | 'raised' | 'block' | 'glass';

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  /** The block colour, for the `block` variant. */
  color?: string;
  onPress?: () => void;
  testID?: string;
  style?: ViewStyle;
}

/**
 * A container. Variants: `surface`, `raised`, `block` (a saturated fill) and
 * `glass` (see `GlassSurface`) (Style Guide §11.3).
 */
export function Card({ children, variant = 'surface', color, onPress, testID, style }: CardProps) {
  const { t } = useTheme();

  const background =
    variant === 'raised'
      ? t.surface2
      : variant === 'block'
        ? (color ?? t.brand)
        : t.surface1;

  const content = (
    <View
      style={[
        styles.base,
        { backgroundColor: background },
        variant === 'block' && { borderRadius: radius.xl },
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {content}
      </View>
    );
  }

  return (
    <Pressy
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      scale={0.98}
      style={style}
    >
      {content}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    padding: space[5],
  },
});
