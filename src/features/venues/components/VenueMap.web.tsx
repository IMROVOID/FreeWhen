/**
 * The map panel, web implementation.
 *
 * ★ THIS FILE EXISTS SO THE NATIVE MAP NEVER ENTERS THE WEB BUNDLE.
 *
 * `@rnmapbox/maps` has no web build. With only `VenueMap.native.tsx` present,
 * Metro resolves it for web too and the export dies at IMPORT time — before
 * any runtime branch could help. The `.web.tsx` sibling is what makes
 * `npm run export:web` green (PRD-18 §6 row 1, AC-18.9.1).
 *
 * ★ THE FALLBACK IS A DESIGNED STATE, NOT AN ERROR.
 *
 * Level 5 of the ladder — list-only — is the documented shipping state for
 * the browser (PRD-04 §3.2). The ranked list beside this panel carries every
 * fact the map would show, so nothing is lost that a reviewer needs. So this
 * renders a quiet `surface` card in `textMuted`: no warning colour, no retry
 * that cannot succeed, no error boundary. An unavailable 3D map is platform
 * capability, not a failure (AC-18.4.1).
 *
 * ★ IT STILL RENDERS THE PARTICIPANT LEGEND.
 *
 * The areas are text, not drawing, and they are the one part of the panel a
 * browser user would otherwise lose. `ParticipantMarker` is pure
 * react-native-web, and it keeps the two implementations honest with each
 * other about what "the map" contains.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { ParticipantMarker } from '@/src/features/venues/components/ParticipantMarker';
import type { VenueMapProps } from '@/src/features/venues/components/VenueMap.types';
import type { ApproxArea } from '@/src/features/map/types';
import { participantColors, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type { VenueMapProps };

export function VenueMap({ areas, testID }: VenueMapProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const areasModel: ApproxArea[] = useMemo(
    () =>
      areas.map((area, index) => ({
        ...area,
        color: participantColors[index % participantColors.length] ?? theme.brand,
      })),
    [areas, theme.brand],
  );

  return (
    <View testID={testID} style={styles.panel}>
      <Card variant="surface">
        <View style={styles.copy}>
          <Text variant="body" color="textMuted">
            {t('map.unavailableOnWeb')}
          </Text>
          <Text variant="caption" color="textFaint">
            {t('map.unavailableOnWebBody')}
          </Text>
        </View>
      </Card>

      {/* Approximate areas as text — pure react-native-web, no drawing. */}
      {areasModel.length > 0 && (
        <View style={styles.legend}>
          {areasModel.map((area) => (
            <ParticipantMarker
              key={area.participantId}
              area={area}
              testID={testID ? `${testID}-area-${area.participantId}` : undefined}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.lg,
    gap: space[3],
  },
  copy: {
    gap: space[2],
    padding: space[3],
  },
  legend: {
    gap: space[2],
  },
});
