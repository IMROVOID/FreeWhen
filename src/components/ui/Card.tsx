import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';

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
  /**
   * A style for the SURFACE — the box with the radius and the fill.
   *
   * ★ `style` CANNOT CLIP, AND THAT IS A REAL DEFECT RATHER THAN A PREFERENCE.
   *
   * `style` lands on an outer wrapper: it is what positions the card in its parent.
   * The radius and the background are painted by the inner view, and that inner view
   * is what a full-bleed child (a share gauge on the card's own bottom edge) hangs
   * off. A caller passing `overflow: 'hidden'` in `style` therefore clipped a box that
   * paints nothing, while the child escaped the visible card and hung below it — the
   * reported "the votes bar is still outside the box".
   *
   * A caller that needs the card's own edges to contain something says so here.
   */
  bleed?: StyleProp<ViewStyle>;
}

/**
 * A container. Variants: `surface`, `raised`, `block` (a saturated fill) and
 * `glass` (see `GlassSurface`) (Style Guide §11.3).
 *
 * ★ NO EDGE. THE FILL IS THE SEPARATION.
 *
 * There was a hairline here — `cardEdge`, added when the light page was 97%
 * lightness and a white card on it had no boundary at all. That page has since
 * been stepped down into the warm hue the palette is built on, so `surface1` on
 * `bg` is a real difference and a second boundary reads as a drawn box: "remove
 * the Event boxes' borders on the Home page", and the same for a proposal. The
 * card's own radius and its fill are the whole figure now, which is what the
 * rest of the product (a sheet, a popover, a tile) already does.
 *
 * `raised` and `block` differ from the page by their fill (surface2, or a
 * saturated brand colour) and never carried an edge.
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
  bleed,
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
        variant === 'block' && { borderRadius: radius.xl },
        // ★ THIS IS THE VIEW WITH THE RADIUS AND THE FILL, SO THIS IS THE ONE THAT
        // CLIPS. See the note on `bleed`.
        bleed,
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
