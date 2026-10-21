import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { Text } from './Text';
import { border, participantColors, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type AvatarSize = 28 | 40 | 56 | 88;

export interface AvatarProps {
  /** The participant's name — used for the initials fallback. */
  name: string;
  /** A stable index into the participant colour list. */
  colorIndex: number;
  size?: AvatarSize;
  /** An optional image URI. */
  uri?: string;
  /** A status dot: `in`, `maybe` or `none`. */
  status?: 'in' | 'maybe' | 'none';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const RING_GAP = 2;

/**
 * A participant's avatar: a circle with a ring in their participant colour
 * (Style Guide §11.7, §4.2).
 */
export function Avatar({ name, colorIndex, size = 40, uri, status, testID, style }: AvatarProps) {
  const { t } = useTheme();

  const color = participantColors[colorIndex % participantColors.length] ?? t.brand;
  const initials = initialsFor(name);

  const ringWidth = size >= 56 ? border.strong : border.hairline;
  const ringGap = size >= 56 ? RING_GAP : 0;

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          borderWidth: ringWidth,
          borderColor: color,
          backgroundColor: t.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ringGap > 0 && { padding: ringGap },
        style,
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: size - ringWidth * 2 - ringGap * 2,
            height: size - ringWidth * 2 - ringGap * 2,
            borderRadius: radius.pill,
            backgroundColor: color,
          },
        ]}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.photo}
            contentFit="cover"
            transition={0}
            accessibilityLabel={name}
          />
        ) : (
          <Text variant="caption" color={t.onBrand} align="center">
            {initials}
          </Text>
        )}
      </View>

      {status && status !== 'none' && (
        <View
          style={[
            styles.status,
            {
              backgroundColor:
                status === 'in' ? t.success : status === 'maybe' ? t.warning : t.textFaint,
              borderColor: t.bg,
            },
          ]}
        />
      )}
    </View>
  );
}

export interface AvatarStackProps {
  avatars: Array<{ name: string; colorIndex: number; uri?: string }>;
  size?: AvatarSize;
  /** The maximum number of avatars shown before a `+N` pill. */
  max?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A row of overlapping avatars. The row direction flips in RTL, so the first
 * avatar is always at the start edge (Style Guide §11.7).
 */
export function AvatarStack({ avatars, size = 40, max = 5, testID, style }: AvatarStackProps) {
  const { t } = useTheme();

  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;
  const overlap = Math.round(size * 0.3);

  return (
    <View testID={testID} style={[styles.stack, style]}>
      {visible.map((avatar, index) => (
        <View key={avatar.name} style={{ marginStart: index === 0 ? 0 : -overlap }}>
          <Avatar
            name={avatar.name}
            colorIndex={avatar.colorIndex}
            size={size}
            {...(avatar.uri ? { uri: avatar.uri } : {})}
          />
        </View>
      ))}

      {overflow > 0 && (
        <View
          style={[
            styles.overflow,
            {
              width: size,
              height: size,
              borderRadius: radius.pill,
              backgroundColor: t.surface3,
              marginStart: -overlap,
            },
          ]}
        >
          <Text variant="caption" color={t.textMuted} align="center">
            {`+${overflow}`}
          </Text>
        </View>
      )}
    </View>
  );
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]?.slice(0, 2) ?? '';
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return `${first}${last}`;
}

const styles = StyleSheet.create({
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  status: {
    position: 'absolute',
    end: 0,
    bottom: 0,
    width: space[3],
    height: space[3],
    borderRadius: radius.pill,
    borderWidth: border.hairline,
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overflow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
