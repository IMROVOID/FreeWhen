import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface TabBarItem {
  key: string;
  label: string;
}

export interface TabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** The optional centre action — the "create" button. */
  centerAction?: { label: string; onPress: () => void };
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A floating pill tab bar, 12px above the bottom safe area. The active tab
 * expands into a labelled pill (Style Guide §11.6).
 */
export function TabBar({ items, activeKey, onChange, centerAction, testID, style }: TabBarProps) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      style={[
        styles.wrapper,
        { paddingBottom: insets.bottom + space[3] },
        style,
      ]}
    >
      <View style={[styles.bar, { backgroundColor: t.surface1 }]}>
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Pressy
              key={item.key}
              onPress={() => onChange(item.key)}
              testID={testID ? `${testID}-${item.key}` : undefined}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
              style={styles.item}
            >
              <View
                style={[
                  styles.itemInner,
                  isActive && { backgroundColor: t.text },
                ]}
              >
                <Text
                  variant="caption"
                  color={isActive ? t.bg : t.textMuted}
                  align="center"
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </View>
            </Pressy>
          );
        })}

        {centerAction && (
          <Pressy
            onPress={centerAction.onPress}
            testID={testID ? `${testID}-center` : undefined}
            accessibilityRole="button"
            accessibilityLabel={centerAction.label}
            haptic="medium"
            style={styles.center}
          >
            <View style={[styles.centerInner, { backgroundColor: t.primary }]}>
              <Text variant="h3" color={t.onPrimary} align="center">
                +
              </Text>
            </View>
          </Pressy>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.tabBar,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    gap: space[1],
  },
  item: {
    flex: 1,
  },
  itemInner: {
    height: size.tabItem,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  center: {
    marginStart: space[1],
  },
  centerInner: {
    width: size.tabBarAction,
    height: size.tabBarAction,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
