/**
 * S5 — five options, equal weight (Plan 05 Task 10, PRD-11 S5).
 *
 * ★ EQUAL WEIGHT IS THE REQUIREMENT, NOT A LAYOUT PREFERENCE.
 *
 * «فعلاً رد کن» is the fifth button, not a grey link under four real ones.
 * Manual entry is first-class rather than a fallback, because a written platform
 * guideline requires it when location is declined (Apple §5.1.1(iv)) — and
 * because a product that only works for people who share their location is not
 * the product described.
 *
 * ★ THE RATIONALE COMES BEFORE THE OS PROMPT.
 *
 * `location.rationale` is rendered above the options, always. Nothing here
 * triggers a permission dialog on mount: the only trigger is the explicit
 * "current location" tap, which is the one moment the ask makes sense.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { toLatinDigits } from '@/src/lib/redact';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/** The three hand-entered options share one form; only their copy differs. */
type ManualKind = 'search' | 'map' | 'neighbourhood';

/** The heading each hand-entered option shows. One map, no nested ternary. */
const MANUAL_HEADING: Record<ManualKind, string> = {
  search: 'location.searchAddress',
  map: 'location.pickOnMap',
  neighbourhood: 'location.neighbourhood',
};

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

interface OptionSpec {
  key: 'current' | ManualKind | 'skip';
  labelKey: string;
  hintKey: string;
}

/**
 * The five, in one list, so the rendering loop cannot accidentally give one of
 * them different treatment.
 */
const OPTIONS: OptionSpec[] = [
  { key: 'current', labelKey: 'location.useCurrent', hintKey: 'location.useCurrentHint' },
  { key: 'search', labelKey: 'location.searchAddress', hintKey: 'location.searchHint' },
  { key: 'map', labelKey: 'location.pickOnMap', hintKey: 'location.pickOnMapHint' },
  { key: 'neighbourhood', labelKey: 'location.neighbourhood', hintKey: 'location.neighbourhoodHint' },
  { key: 'skip', labelKey: 'location.skip', hintKey: 'location.skipHint' },
];

export function LocationPicker({
  onUseCurrent,
  onSaveManual,
  onSkip,
  isBusy,
  errorKey,
  testID,
}: LocationPickerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [manualKind, setManualKind] = useState<ManualKind | null>(null);
  const [label, setLabel] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submitManual = () => {
    const parsedLat = Number(toLatinDigits(lat));
    const parsedLng = Number(toLatinDigits(lng));

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      setLocalError('events.validation.coordRange');
      return;
    }

    setLocalError(null);
    onSaveManual(parsedLat, parsedLng, label.trim() === '' ? null : label.trim());
  };

  if (manualKind) {
    return (
      <View testID={testID} style={styles.container}>
        <Text variant="h1" align="start">
          {t(MANUAL_HEADING[manualKind])}
        </Text>

        <Text variant="body" color={theme.textMuted} align="start" style={styles.rationale}>
          {t('location.manualNote')}
        </Text>

        {manualKind !== 'map' && (
          <Input
            value={label}
            onChangeText={setLabel}
            label={
              manualKind === 'search'
                ? t('location.searchPlaceholder')
                : t('location.neighbourhoodPlaceholder')
            }
            testID="location-label-input"
            style={styles.field}
          />
        )}

        <Input
          value={lat}
          onChangeText={setLat}
          label={t('location.latitude')}
          testID="location-lat-input"
          style={styles.field}
        />
        <Input
          value={lng}
          onChangeText={setLng}
          label={t('location.longitude')}
          error={localError ? t(localError) : errorKey ? t(errorKey) : undefined}
          testID="location-lng-input"
          style={styles.field}
        />

        <Text variant="caption" color={theme.textFaint} align="start" style={styles.hint}>
          {t('location.coordHint')}
        </Text>

        <Button
          label={t('location.save')}
          onPress={submitManual}
          disabled={isBusy}
          loading={isBusy}
          variant="primary"
          testID="location-save"
          style={styles.action}
        />
        <Button
          label={t('common.back')}
          onPress={() => setManualKind(null)}
          variant="ghost"
          size="medium"
          testID="location-back"
          style={styles.secondary}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.container}>
      <Text variant="h1" align="start">
        {t('location.heading')}
      </Text>

      <Text variant="body" color={theme.textMuted} align="start" style={styles.subheading}>
        {t('location.subheading')}
      </Text>

      {/* Before any OS prompt, and worded as a purpose rather than a request. */}
      <View style={[styles.rationaleBox, { backgroundColor: theme.surface2 }]}>
        <Text variant="caption" color={theme.text} align="start">
          {t('location.rationale')}
        </Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map((option) => (
          <Pressy
            key={option.key}
            onPress={() => {
              if (option.key === 'current') {
                onUseCurrent();
                return;
              }
              if (option.key === 'skip') {
                onSkip();
                return;
              }
              setManualKind(option.key);
            }}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel={t(option.labelKey)}
            accessibilityState={{ disabled: isBusy }}
            testID={`location-option-${option.key}`}
          >
            <View style={[styles.option, { backgroundColor: theme.surface1 }]}>
              <Text variant="bodyL" color={theme.text} align="start">
                {t(option.labelKey)}
              </Text>
              <Text variant="caption" color={theme.textFaint} align="start">
                {t(option.hintKey)}
              </Text>
            </View>
          </Pressy>
        ))}
      </View>

      {errorKey && (
        <Text variant="caption" color={theme.danger} align="start" style={styles.error}>
          {t(errorKey)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[1],
  },
  subheading: {
    marginTop: space[2],
  },
  rationaleBox: {
    marginTop: space[4],
    borderRadius: radius.md,
    padding: space[4],
  },
  options: {
    gap: space[3],
    marginTop: space[4],
  },
  option: {
    minHeight: size.buttonLarge,
    borderRadius: radius.md,
    borderWidth: border.hairline,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    justifyContent: 'center',
    gap: space[1],
  },
  error: {
    marginTop: space[3],
  },
  field: {
    marginTop: space[3],
  },
  rationale: {
    marginTop: space[2],
  },
  hint: {
    marginTop: space[2],
  },
  action: {
    marginTop: space[5],
  },
  secondary: {
    marginTop: space[2],
  },
});
