/**
 * S5 — Map-only location picker with search (Plan 05 Task 10, PRD-11 S5).
 *
 * Map is the sole location selection method across the app with an embedded
 * search bar and GPS button (no manual coordinate typing).
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { LocationMapPicker } from '@/src/components/ui/LocationMapPicker';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface LocationPickerProps {
  /** Fires the OS prompt. The only path that can. */
  onUseCurrent: () => void;
  /** The shared manual form's save action. */
  onSaveManual: (lat: number, lng: number, label: string | null) => void;
  onSkip: () => void;
  isBusy: boolean;
  /** A catalogue key for the last failure, or `null`. */
  errorKey?: string | null;
  testID?: string;
}

export function LocationPicker({
  onSaveManual,
  onSkip,
  isBusy,
  errorKey,
  testID,
}: LocationPickerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  return (
    <View testID={testID} style={styles.container}>
      <Text variant="body" color={theme.textMuted} align="start" style={styles.rationale}>
        {t('location.rationale')}
      </Text>

      {errorKey && (
        <Text variant="caption" color={theme.danger} align="start">
          {t(errorKey)}
        </Text>
      )}

      {/* Map is the only method to pick location */}
      <LocationMapPicker
        onSelect={(venue) => onSaveManual(venue.lat, venue.lng, venue.name)}
        testID="location-map"
      />

      <Button
        label={t('location.skip', 'فعلاً رد کن')}
        onPress={onSkip}
        variant="ghost"
        size="medium"
        disabled={isBusy}
        testID="location-skip"
        style={styles.skipButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  rationale: {
    marginBottom: space[1],
  },
  skipButton: {
    marginTop: space[2],
  },
});
