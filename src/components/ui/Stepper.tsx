import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { Pressy } from './Pressy';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** The label under the number, e.g. "minutes". */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A number stepper: two circular buttons flanking the value (Style Guide
 * §11.11). At the min or max, the button dims rather than failing silently.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  testID,
  style,
}: StepperProps) {
  const { t } = useTheme();

  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      style={[styles.container, style]}
    >
      <StepperButton
        label="−"
        disabled={!canDecrease}
        onPress={() => onChange(value - 1)}
        backgroundColor={t.surface3}
        textColor={canDecrease ? t.text : t.textFaint}
        testID={testID ? `${testID}-decrease` : undefined}
      />

      <View style={styles.value}>
        <Text variant="numeral" align="center">
          {String(value)}
        </Text>
        {label && (
          <Text variant="caption" color={t.textMuted} align="center">
            {label}
          </Text>
        )}
      </View>

      <StepperButton
        label="+"
        disabled={!canIncrease}
        onPress={() => onChange(value + 1)}
        backgroundColor={t.surface3}
        textColor={canIncrease ? t.text : t.textFaint}
        testID={testID ? `${testID}-increase` : undefined}
      />
    </View>
  );
}

interface StepperButtonProps {
  label: string;
  disabled: boolean;
  onPress: () => void;
  backgroundColor: string;
  textColor: string;
  testID?: string;
}

function StepperButton({
  label,
  disabled,
  onPress,
  backgroundColor,
  textColor,
  testID,
}: StepperButtonProps) {
  return (
    <Pressy
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      haptic="light"
    >
      <View style={[styles.button, { backgroundColor }]}>
        <Text variant="h3" color={textColor} align="center">
          {label}
        </Text>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
  },
  button: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    minWidth: 64,
    alignItems: 'center',
  },
});
