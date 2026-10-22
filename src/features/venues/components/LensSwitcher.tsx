/**
 * The four lenses (Plan 08 Task 2, PRD-11 S9, OQ-11.2).
 *
 * ★ THE ACTIVE LENS NAME IS ALWAYS ON SCREEN.
 *
 * An unexplained ranking is the failure mode the research warns about
 * specifically: a user reads a list as "the right answer" without knowing
 * which question produced it. So the switcher renders the active lens's name
 * AND its plain-language meaning as a header line, not only as the selected
 * segment. Selecting a lens is reversible, and knowing which one you are
 * looking at is a precondition for that.
 *
 * ★ THE LENS IS UI STATE, NOT A DATA MUTATION (AC-5.6.1).
 *
 * Changing it re-ranks. It never writes to votes, proposals, or the confirmed
 * decision — this component holds no data at all and calls no mutation.
 *
 * Prominent on S9 only (OQ-11.2): it must not clutter the Decision Status
 * area, which is why it lives here rather than in the event shell.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { LENS_ORDER, lensKey, lensMeaningKey } from '@/src/features/venues/services/labels';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Lens } from '@/src/engine/types';

export interface LensSwitcherProps {
  active: Lens;
  onChange: (lens: Lens) => void;
  disabled?: boolean;
  testID?: string;
}

export function LensSwitcher({ active, onChange, disabled = false, testID }: LensSwitcherProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View testID={testID} style={styles.container}>
      {/* ★ The name and the meaning, always visible — not just in the segment. */}
      <View style={styles.heading}>
        <Text variant="h3" color={theme.text}>
          {t(lensKey(active))}
        </Text>
        <Text variant="caption" color={theme.textMuted}>
          {t(lensMeaningKey(active))}
        </Text>
      </View>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('lens.label')}
        style={[styles.track, { backgroundColor: theme.surface2 }]}
      >
        {LENS_ORDER.map((lens) => {
          const isActive = lens === active;

          return (
            <Pressy
              key={lens}
              onPress={() => {
                if (!disabled && !isActive) onChange(lens);
              }}
              disabled={disabled}
              testID={testID ? `${testID}-${lens}` : undefined}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive, disabled }}
              accessibilityLabel={`${t(lensKey(lens))}. ${t(lensMeaningKey(lens))}`}
              style={styles.option}
            >
              <View
                style={[
                  styles.optionInner,
                  isActive && { backgroundColor: theme.primary },
                ]}
              >
                <Text
                  variant="caption"
                  align="center"
                  color={isActive ? theme.onPrimary : theme.textMuted}
                  numberOfLines={1}
                >
                  {t(lensKey(lens))}
                </Text>
              </View>
            </Pressy>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  heading: {
    gap: space[1],
  },
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: space[1],
  },
  option: {
    flex: 1,
  },
  optionInner: {
    height: size.segment,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
});
