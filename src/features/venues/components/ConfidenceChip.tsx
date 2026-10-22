/**
 * The confidence label on a travel figure (Plan 08 Task 3, PRD-04 FR-4.18).
 *
 * ★ EVERY FIGURE CARRIES ITS LABEL.
 *
 * A time shown without one invites the user to trust a straight-line guess as
 * if it were measured. The label is not decoration and is never omitted "when
 * it is obvious" — `زنده` and `تخمینی` are what make the difference visible.
 *
 * The chip is colour-coded as a redundant emphasis only: the WORD carries the
 * meaning, so the distinction survives greyscale and colour blindness
 * (PRD-04 AC-4.6.1).
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { CONFIDENCE_LABEL_KEY } from '@/src/features/venues/services/labels';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Theme } from '@/src/theme/tokens';
import type { Confidence } from '@/src/routing/types';

export interface ConfidenceChipProps {
  confidence: Confidence;
  testID?: string;
}

export function ConfidenceChip({ confidence, testID }: ConfidenceChipProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const label = t(CONFIDENCE_LABEL_KEY[confidence] ?? 'confidence.unknown');
  const hint = confidenceHint(t, confidence);
  const tone = toneFor(confidence, theme);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}. ${hint}`}
      style={[styles.chip, { backgroundColor: tone.background, borderColor: tone.border }]}
    >
      <Text variant="caption" color={tone.text}>
        {label}
      </Text>
    </View>
  );
}

function confidenceHint(
  t: (key: string) => string,
  confidence: Confidence,
): string {
  switch (confidence) {
    case 'high':
      return t('confidence.highHint');
    case 'medium':
      return t('confidence.mediumHint');
    case 'low':
      return t('confidence.lowHint');
    case 'unknown':
      return t('confidence.unknownHint');
  }
}

interface Tone {
  background: string;
  border: string;
  text: string;
}

/**
 * The visual tier.
 *
 * `high` is the only one filled with `success`; `medium` and `low` sit on the
 * neutral surfaces so an estimate never looks like a live figure at a glance.
 * Colour is redundant — the label already says it.
 */
function toneFor(confidence: Confidence, theme: Theme): Tone {
  switch (confidence) {
    case 'high':
      return {
        background: theme.surface1,
        border: theme.success,
        text: theme.text,
      };
    case 'medium':
      return { background: theme.surface2, border: theme.line, text: theme.textMuted };
    case 'low':
      return { background: theme.surface2, border: theme.line, text: theme.textMuted };
    case 'unknown':
      return { background: theme.surface3, border: theme.line, text: theme.textFaint };
  }
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    alignSelf: 'flex-start',
  },
});
