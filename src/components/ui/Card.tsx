import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Pressy } from './Pressy';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type CardVariant = 'surface' | 'raised' | 'block' | 'glass';

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  /** The block colour, for the `block` variant. */
  color?: string;
  onPress?: () => void;
  /**
   * A hold on the card.
   *
   * The event list uses it for a context menu. Kept on the card rather than on a
   * wrapper so the press target is the surface the user is actually touching — a hold
   * that misses the card by a pixel would otherwise do nothing.
   *
   * It receives the press event, because WHERE the card was pressed is what places
   * the menu: `nativeEvent.locationX/locationY` are relative to the card, and the
   * caller adds its own window rect to get the finger's point on screen.
   */
  onLongPress?: (event: GestureResponderEvent) => void;
  /** How long the hold must last. Only meaningful with onLongPress. */
  delayLongPress?: number;
  testID?: string;
  /** A style PROP, not a single object, so a caller can compose conditional styles. */
  style?: StyleProp<ViewStyle>;
}

/**
 * A container. Variants: `surface`, `raised`, `block` (a saturated fill) and
 * `glass` (see `GlassSurface`) (Style Guide §11.3).
 *
 * ★ A SURFACE CARD NEEDS AN EDGE, AND ON WEB IT HAD NONE.
 *
 * `surface` fills with `surface1`. On native that is enough: `Pressy` scales the
 * card under the finger and the platform's own elevation separates it. The WEB
 * build has neither, so a card filled with white on a 97%-lightness page was
 * invisible — "the Event boxes on Home page are missing BG on Light Theme on
 * Web". `cardEdge` is a hairline dedicated to this: not `line`, which is the much
 * stronger border of an outlined CONTROL.
 *
 * `raised` and `block` already differ from the page by their fill (surface2, or a
 * saturated brand colour), so they carry no edge.
 */
export function Card({
  children,
  variant = 'surface',
  color,
  onPress,
  onLongPress,
  delayLongPress,
  testID,
  style,
}: CardProps) {
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
        variant === 'surface' && { borderWidth: border.hairline, borderColor: t.cardEdge },
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
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
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
