/**
 * The list skeleton (PRD-11 §6, Plan 11 Task 1).
 *
 * ★ A SKELETON, NOT A SPINNER, FOR LISTS.
 *
 * A full-screen spinner on a list conveys nothing about what is coming. The
 * skeleton says "rows are arriving, roughly this tall", which is why §6 bans
 * the list spinner outright. A spinner remains correct for a discrete action,
 * because there the user asked for the wait.
 *
 * ★ IT IS ANNOUNCED AS ONE BUSY REGION.
 *
 * A screen reader walking eight decorative bars is noise. The container takes
 * the label and the bars are hidden from the tree, so the announcement is one
 * sentence rather than twenty empty nodes.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ListSkeletonProps {
  /** How many placeholder rows to draw. */
  rows?: number;
  /** The announced sentence; defaults to the catalogue's generic one. */
  label?: string;
  testID?: string;
}

export function ListSkeleton({ rows = 3, label, testID }: ListSkeletonProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('states.loading')}
      accessibilityLiveRegion="polite"
      style={styles.container}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[styles.row, { backgroundColor: theme.surface2 }]}
        >
          <View style={[styles.title, { backgroundColor: theme.surface3 }]} />
          <View style={[styles.line, { backgroundColor: theme.surface3 }]} />
          <View style={[styles.lineShort, { backgroundColor: theme.surface3 }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  row: {
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
  },
  title: {
    height: space[4],
    width: '55%',
    borderRadius: radius.xs,
  },
  line: {
    height: space[3],
    width: '85%',
    borderRadius: radius.xs,
  },
  lineShort: {
    height: space[3],
    width: '40%',
    borderRadius: radius.xs,
  },
});
