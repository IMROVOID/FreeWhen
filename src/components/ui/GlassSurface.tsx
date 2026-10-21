import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface GlassSurfaceProps {
  children: React.ReactNode;
  /** The blur intensity, 40–60 (Style Guide §11.12). */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A blurred, translucent surface. Allowed only for the tab bar, floating map
 * controls, and sheets over imagery — not for general cards (§11.12).
 *
 * Under Reduce Transparency the blur is replaced with a solid `surface2`
 * (Style Guide §10).
 */
export function GlassSurface({ children, intensity = 50, style }: GlassSurfaceProps) {
  const { t } = useTheme();
  const reduceTransparency = useReduceTransparency();

  if (reduceTransparency) {
    return (
      <View style={[styles.base, { backgroundColor: t.surface2 }, style]}>
        {children}
      </View>
    );
  }

  return (
    <BlurView intensity={intensity} tint="dark" style={[styles.base, style]}>
      <View style={[styles.overlay, { backgroundColor: t.surface1 }]}>{children}</View>
    </BlurView>
  );
}

/**
 * Reduce Transparency is an iOS setting. It is honoured where it exists and
 * ignored elsewhere, so the full effect remains the default.
 */
function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) setReduce(enabled);
      })
      .catch(() => {
        // Not supported here — the blur stays.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduce,
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return reduce;
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderRadius: radius.lg,
  },
  overlay: {
    flex: 1,
    opacity: 0.6,
    padding: space[3],
  },
});
