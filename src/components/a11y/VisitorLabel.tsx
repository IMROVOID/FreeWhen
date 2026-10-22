/**
 * The visitor label (PRD-11 §8, Plan 11 Task 10).
 *
 * ★ THE ROLE IS IN THE LABEL, NOT ONLY THE STYLING.
 *
 * A participant is often shown as a coloured dot plus a name. The colour is
 * decoration and the role is the meaning, so the label states the role and the
 * name together — «میزبان: علی» — and the colour never carries information on
 * its own (§8, the never-colour-only rule).
 *
 * ★ IT WRAPS RATHER THAN REPLACES.
 *
 * Call sites already render their own avatar and text; this makes the group one
 * accessible unit so a screen reader announces a person once instead of reading
 * a dot, a name, and a role as three unrelated nodes.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

export type VisitorRole = 'organizer' | 'participant' | 'visitor';

export interface VisitorLabelProps {
  name: string;
  role?: VisitorRole;
  /** Rendered inside the labelled group — the avatar and name. */
  children: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function VisitorLabel({
  name,
  role = 'participant',
  children,
  testID,
  style,
}: VisitorLabelProps) {
  const { t } = useTranslation();

  const roleLabel = t(`a11y.roles.${role}`);
  const label = t('a11y.visitorLabel', { role: roleLabel, name });

  return (
    <View testID={testID} accessible accessibilityLabel={label} style={[styles.group, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
