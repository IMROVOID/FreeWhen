/**
 * The header every event screen shares.
 *
 * ★ IT OWNS THE BACK CONTROL, THE TITLE, AND THE TOP INSET.
 *
 * `app/event/[id]/_layout.tsx` hides the router header and puts nothing in its
 * place, so a screen that did not draw its own header had no way back at all.
 * `activity.tsx` had the correct shape — a back control beside the title — and
 * this is that shape, promoted so the other screens stop diverging.
 *
 * ★ THE INSET BELONGS HERE, NOT TO EACH CALLER.
 *
 * Six of seven skeletons had already drifted on `paddingTop: insets.top` — some
 * had it, some did not, and the ones that did not rendered flush under the
 * status bar. A header that applies its own inset cannot be forgotten by a new
 * screen, which is the only durable fix for that class of bug.
 *
 * ★ THE TITLE IS CENTRED, AND THE BACK CONTROL IS NOT A BUTTON-SHAPED DISC.
 *
 * The title used to be `align="start"`, which is the leading edge — the RIGHT
 * edge in Persian and the LEFT edge in English. The same header therefore read
 * "right aligned" to one reviewer and "left aligned" to another. A page title
 * belongs on the screen's axis in both directions, so it is centred.
 *
 * The back control used to sit in a `surface2` disc with a `line` border. On a
 * `bg` page that disc is a raised, outlined button — a second, louder control
 * competing with the title beside it, and the loudest thing in an otherwise
 * quiet header. It is now a bare chevron, which is the shape the chat screen
 * had already arrived at. The row reserves a symmetric spacer so the title
 * centres on the SCREEN's axis rather than on the space the chevron left over.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Pressy } from './Pressy';
import { Text } from './Text';
import { size, space } from '@/src/theme/tokens';
import { isRtlLayout } from '@/src/platform/layout-direction';
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
 * A back chevron, a centred title block, and the top safe-area inset.
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
  // resolved layout direction rather than `I18nManager`, which is always false
  // on web, or the language tag alone, which the document may have overridden.
  const rtl = isRtlLayout(i18n.language);
  const BackIcon = rtl ? CaretRight : CaretLeft;

  return (
    <View testID={testID} style={[styles.header, { paddingTop: insets.top + space[3] }, style]}>
      <Pressy
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={translate('common.back')}
        haptic="light"
        style={styles.backPress}
      >
        <View style={styles.backBox}>
          <BackIcon size={24} color={t.text} weight="bold" />
        </View>
      </Pressy>

      <View style={styles.titleBlock}>
        <Text variant="h1" align="center" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={t.textMuted} align="center">
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>

      {/* Mirrors the chevron's width, so the title centres on the screen. */}
      <View style={styles.backSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    // A row follows the document direction, so the chevron sits on the leading
    // edge in both LTR and RTL without a conditional style.
    alignItems: 'flex-start',
    paddingBottom: space[3],
  },
  backPress: {
    marginTop: space[1],
  },
  backBox: {
    width: size.stepperButton,
    height: size.stepperButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: {
    width: size.stepperButton,
    height: size.stepperButton,
  },
  titleBlock: {
    flex: 1,
    gap: space[1],
    // The title is centred on the axis, so children that are not text (a status
    // line, a chip row) follow the same alignment.
    alignItems: 'center',
  },
});
