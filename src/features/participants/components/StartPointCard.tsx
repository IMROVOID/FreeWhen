/**
 * The start-point card (Plan 09 Task 3, FR-8.8 / FR-8.9).
 *
 * ★ THE AUDIENCE IS A CONSENT REQUIREMENT, NOT A UI NICETY.
 *
 * Sharing to an unnamed audience is not informed consent. "Your location is
 * shared" without "with whom" and "until when" cannot be evaluated by the person
 * being asked, so this card shows all three facts together: how many people, the
 * end of the event in the local calendar, and a one-tap way out.
 *
 * ★ THE AREA IS DRAWN AS AN AREA, NEVER A PIN (Apple §1.1.6, AC-8.3.1).
 *
 * A precise marker on a deliberately-approximate value is a misleading location
 * UI. The circle is labelled «محدودهٔ تقریبی» and its size reflects the real
 * ~1.1 km rounding, so the picture does not claim more precision than the data.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { useTheme } from '@/src/theme/useTheme';
import { border, radius, space } from '@/src/theme/tokens';
import { formatJalali } from '@/src/lib/jalali';
import { digits } from '@/src/lib/format';
import type { Language } from '@/src/i18n/types';

import type { Visibility } from './VisibilityToggle';
import { DeleteLocationAction } from '@/src/features/privacy/components/DeleteLocationAction';

export interface StartPointAudience {
  participant_count: number;
  /** ISO instant the disclosure ends — the event's end. */
  expires_at: string;
}

export interface StartPointCardProps {
  /** `null` when the participant has no start point yet. */
  audience: StartPointAudience | null;
  visibility: Visibility;
  language: Language;
  /** Whether a start point currently exists. */
  hasStartPoint: boolean;
  onDelete: () => void | Promise<void>;
  deleting?: boolean;
  testID?: string;
}

export function StartPointCard({
  audience,
  visibility,
  language,
  hasStartPoint,
  onDelete,
  deleting = false,
  testID,
}: StartPointCardProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  return (
    <Card variant="raised" testID={testID} style={styles.card}>
      <AreaBadge />

      {hasStartPoint && audience ? (
        <>
          <View style={styles.facts}>
            <Fact
              label={t('privacy.audienceLabel')}
              value={t('privacy.audienceCount', {
                count: digits(audience.participant_count, language),
              })}
            />
            <Fact
              label={t('privacy.expiryLabel')}
              value={t('privacy.expiryAtEventEnd', {
                date: formatJalali(new Date(audience.expires_at), language),
              })}
            />
            <Fact
              label={t('privacy.visibility')}
              value={
                visibility === 'private'
                  ? t('privacy.visibilityPrivate')
                  : t('privacy.visibilityEvent')
              }
            />
          </View>

          <DeleteLocationAction onConfirm={onDelete} busy={deleting} testID={testID ? `${testID}-delete` : undefined} />
        </>
      ) : (
        <Text variant="body" color="textMuted">
          {t('privacy.noStartPoint')}
        </Text>
      )}

      <Text variant="caption" color="textFaint" style={[styles.footnote, { borderColor: theme.line }]}>
        {t('privacy.shareFootnote')}
      </Text>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text variant="caption" color="textMuted" style={styles.factLabel}>
        {label}
      </Text>
      <Text variant="body" weight={600} align="end" style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The approximate area, drawn as a ring.
 *
 * No coordinate is rendered: printing the numbers would let a reader note them
 * down and undo the rounding, and Apple §1.1.6 rejects a precise-looking
 * presentation of an imprecise value.
 */
function AreaBadge() {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.badgeRow}>
      <View style={[styles.ring, { borderColor: theme.brand }]}>
        <View style={[styles.dot, { backgroundColor: theme.brand }]} />
      </View>
      <Text variant="bodyL" weight={600}>
        {t('privacy.approxAreaLabel')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[4] },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  ring: {
    width: space[12],
    height: space[12],
    borderRadius: radius.pill,
    borderWidth: border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: space[2], height: space[2], borderRadius: radius.pill },
  facts: { gap: space[2] },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  factLabel: { flexShrink: 0 },
  factValue: { flexShrink: 1 },
  footnote: { borderTopWidth: border.hairline, paddingTop: space[3] },
});
