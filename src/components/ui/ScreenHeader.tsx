/**
 * The header every event screen shares.
 *
 * ★ IT OWNS THE BACK CONTROL, THE TITLE, AND THE TOP INSET.
 *
 * `app/event/[id]/_layout.tsx` hides the router header and puts nothing in its
 * place, so a screen that did not draw its own header had no way back at all.
 * `activity.tsx` had the correct shape — a circular, bordered back disc beside
 * the title — and this is that shape, promoted so the other screens stop
 * diverging.
 *
 * ★ THE INSET BELONGS HERE, NOT TO EACH CALLER.
 *
 * Six of seven skeletons had already drifted on `paddingTop: insets.top` — some
 * had it, some did not, and the ones that did not rendered flush under the
 * status bar. A header that applies its own inset cannot be forgotten by a new
 * screen, which is the only durable fix for that class of bug.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Pressy } from './Pressy';
import { Text } from './Text';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  /** Extra content under the title, e.g. a status line. */
  children?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A back disc, the title block, and the top safe-area inset.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  children,
  testID,
  style,
}: ScreenHeaderProps) {
  const { t } = useTheme();
  const { t: translate, i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  // In an RTL layout the "back" affordance points the other way. Read from the
  // live i18n direction rather than re-deriving it from the language tag, so a
  // locale this file has never heard of still gets the right chevron.
  const rtl = i18n.dir() === 'rtl';
  const BackIcon = rtl ? CaretRight : CaretLeft;

  return (
    <View
      testID={testID}
      style={[styles.header, { paddingTop: insets.top + space[3] }, style]}
    >
      <Pressy
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={translate('common.back')}
        haptic="light"
        style={styles.backPress}
      >
        <View
          style={[
            styles.backCircle,
            { backgroundColor: t.surface2, borderColor: t.line },
          ]}
        >
          <BackIcon size={20} color={t.text} weight="bold" />
        </View>
      </Pressy>

      <View style={styles.titleBlock}>
        <Text variant="h1" align="start" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={t.textMuted} align="start">
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    // A row follows the document direction, so the disc sits on the leading
    // edge in both LTR and RTL without a conditional style.
    alignItems: 'flex-start',
    gap: space[3],
    paddingBottom: space[3],
  },
  backPress: {
    marginTop: space[1],
  },
  backCircle: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    gap: space[1],
  },
});
