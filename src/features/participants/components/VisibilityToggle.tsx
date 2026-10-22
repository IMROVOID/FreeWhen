/**
 * The visibility control (Plan 09 Task 2, FR-8.18 / E3).
 *
 * ★ `private` HIDES THE COORDINATE FROM PEOPLE, NOT FROM THE ENGINE.
 *
 * The setting exists because one member of a friend group may be the reason
 * someone will not disclose where they live (AS8, OQ-8.1). It must therefore be
 * a real choice, available even among friends.
 *
 * What it must NOT do is exempt the member from the ranking. Hiding the
 * coordinate from the engine would let a participant silently opt out of
 * fairness — worse than the disclosure it avoids, because every other member
 * then absorbs travel time the private one never declared.
 *
 * The database enforces the display half (`start_point` SELECT policy reads
 * `participant.visibility`); the engine reads the row directly, so the
 * calculation half is unaffected by design.
 *
 * A segmented control, per Style Guide §11.4.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/src/components/ui/Text';
import { Pressy } from '@/src/components/ui/Pressy';
import { useTranslation } from 'react-i18next';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type Visibility = 'private' | 'event';

export interface VisibilityToggleProps {
  value: Visibility;
  onChange: (next: Visibility) => void;
  disabled?: boolean;
  testID?: string;
}

const OPTIONS: ReadonlyArray<{ value: Visibility; labelKey: string; hintKey: string }> = [
  { value: 'private', labelKey: 'privacy.visibilityPrivate', hintKey: 'privacy.visibilityPrivateHint' },
  { value: 'event', labelKey: 'privacy.visibilityEvent', hintKey: 'privacy.visibilityEventHint' },
];

export function VisibilityToggle({ value, onChange, disabled = false, testID }: VisibilityToggleProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View testID={testID} style={styles.root} accessibilityRole="radiogroup">
      <Text variant="caption" color="textMuted" style={styles.label}>
        {t('privacy.visibility')}
      </Text>

      <View style={[styles.track, { backgroundColor: theme.surface2 }]}>
        {OPTIONS.map((option) => {
          const selected = option.value === value;

          return (
            <Pressy
              key={option.value}
              onPress={disabled ? undefined : () => onChange(option.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={t(option.labelKey)}
              haptic="light"
              scale={0.96}
              testID={testID ? `${testID}-${option.value}` : undefined}
              style={[
                styles.segment,
                selected && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
            >
              <Text
                variant="caption"
                weight={600}
                align="center"
                color={selected ? 'onPrimary' : 'textMuted'}
              >
                {t(option.labelKey)}
              </Text>
            </Pressy>
          );
        })}
      </View>

      {/* The hint states what the choice DOES, because "private" alone reads as
          "excluded from the calculation", which is the opposite of the truth. */}
      <Text variant="caption" color="textFaint" style={styles.hint}>
        {t(OPTIONS.find((option) => option.value === value)?.hintKey ?? OPTIONS[0]!.hintKey)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  label: { marginBottom: space[1] },
  track: {
    flexDirection: 'row',
    gap: space[1],
    padding: space[1],
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    minHeight: size.segment,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    borderColor: 'transparent',
    paddingHorizontal: space[2],
  },
  hint: { marginTop: space[1] },
});
