/**
 * The map panel (Plan 08 Task 7 and Task 8, PRD-04 §13).
 *
 * ★ CONTEXTUAL, NOT LOAD-BEARING.
 *
 * Every fact here is reachable in the list (FR-4.5). The map is mounted
 * inside `MapErrorBoundary`, and at levels 3–4 it renders a quiet note plus
 * the same information as text — never a blank panel and never an error.
 *
 * ★ THE CAMERA FRAMES THE EVENT BOUNDING BOX.
 *
 * With a tile provider, the viewport is sent on every tile request. Framing
 * the whole event means the viewport reveals nothing the fuzzed data was
 * protecting; a camera centred on one participant would defeat the guarantee
 * through the camera rather than the data (FR-8.16, D19).
 *
 * ★ THE EMPTY STATE IS A P0 STATE, NOT AN EDGE CASE (AC-4.5.1).
 *
 * Seconds after creating an event there is one participant and no venues.
 * That renders as a centred area plus an invitation to propose a place.
 *
 * ★ MAP CHROME IS NOT MIRRORED IN RTL (PRD-11 §7).
 *
 * Only text-bearing UI mirrors. The pins and areas are placed by coordinate,
 * so they are direction-agnostic by construction.
 */

import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { ParticipantMarker } from '@/src/features/venues/components/ParticipantMarker';
import { boundingBox } from '@/src/features/map/level';
import {
  DEFAULT_PITCH,
  EVENT_PADDING_RATIO,
  MIN_EVENT_ZOOM,
} from '@/src/features/map/types';
import { buildVenuePins, offsetCoincident } from '@/src/features/map/pins';
import type { ApproxArea, VenuePin } from '@/src/features/map/types';
import type { VenueMapProps } from '@/src/features/venues/components/VenueMap.types';
import { participantColors, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Theme } from '@/src/theme/tokens';

export type { VenueMapProps };

export function VenueMap({
  adapter,
  ranked,
  coordinates,
  areas,
  excludedVenueIds = [],
  selectedVenueId = null,
  onSelectVenue,
  onPropose,
  testID,
}: VenueMapProps) {
  const { t } = useTranslation();
  const { t: theme, name: themeName } = useTheme();

  const areasModel: ApproxArea[] = useMemo(
    () =>
      areas.map((area, index) => ({
        ...area,
        color: participantColors[index % participantColors.length] ?? theme.brand,
      })),
    [areas, theme.brand],
  );

  const excluded = useMemo(() => new Set(excludedVenueIds), [excludedVenueIds]);

  const pins: VenuePin[] = useMemo(
    () => offsetCoincident(buildVenuePins(ranked, coordinates, excluded, selectedVenueId)),
    [ranked, coordinates, excluded, selectedVenueId],
  );

  // ★ The box covers the venues AND the participant areas — framing only the
  // venues would leave a distant participant's area outside the viewport, and
  // framing only one participant would leak their position.
  const cameraBox = useMemo(
    () =>
      boundingBox(
        [...pins.map((pin) => pin.coordinate), ...areasModel.map((area) => area.coordinate)],
        EVENT_PADDING_RATIO,
      ),
    [pins, areasModel],
  );

  // `configure()` must run before the first mount — this is where a real
  // adapter would set the Mapbox token (D11A's module-scope rule).
  const configured = useRef(false);
  if (!configured.current) {
    adapter.configure();
    configured.current = true;
  }

  useEffect(() => {
    adapter.setTheme(themeName);
  }, [adapter, themeName]);

  useEffect(() => {
    if (cameraBox) {
      adapter.setCamera({ bounds: cameraBox, minZoom: MIN_EVENT_ZOOM, pitch: DEFAULT_PITCH });
    }
    adapter.setParticipantAreas(areasModel);
    adapter.setVenuePins(pins);
  }, [adapter, cameraBox, areasModel, pins]);

  useEffect(() => {
    if (!onSelectVenue) return;
    return adapter.onSelectVenue(onSelectVenue);
  }, [adapter, onSelectVenue]);

  const hasAnyLocation = pins.length > 0 || areasModel.length > 0;

  // ★ AC-4.5.1 — the organizer's state seconds after creating an event.
  if (!hasAnyLocation) {
    return (
      <View
        testID={testID ? `${testID}-empty` : undefined}
        style={[styles.panel, styles.centred, { backgroundColor: theme.surface1 }]}
      >
        <EmptyState
          title={t('map.emptyTitle')}
          body={t('map.emptyBody')}
          actionLabel={onPropose ? t('map.emptyAction') : undefined}
          onAction={onPropose}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.panel, { backgroundColor: theme.surface1, borderColor: theme.line }]}>
      {/* The drawing surface. At levels 3–4 it is the note below, and every
          fact it would show is in the list. */}
      <View
        testID={testID ? `${testID}-surface` : undefined}
        style={[styles.surface, { backgroundColor: theme.surface2 }]}
      >
        <Text variant="caption" color={theme.textFaint} align="center">
          {adapter.level === 4 ? t('ranking.listOnlyNote') : t('map.staticLevel')}
        </Text>
      </View>

      {/* The participant areas, as text. Approximate by construction. */}
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

      {/* The pin legend: rank by number, with its name. Every fact the map
          would show is here, so the map is never the only path (FR-4.5). */}
      {pins.length > 0 && (
        <View style={styles.legend}>
          {pins.map((pin) => (
            <View
              key={pin.venueId}
              style={styles.pinRow}
              accessible
              accessibilityLabel={t('map.venuePinLabel', { rank: pin.rank, name: pin.name })}
            >
              <View
                style={[
                  styles.pinDot,
                  { backgroundColor: pinTone(pin, theme) },
                  pin.selected && { width: size.stepperButton, height: size.stepperButton },
                ]}
              >
                <Text variant="caption" color={pin.tone === 'primary' ? theme.onPrimary : theme.text} numeric>
                  {pin.rank}
                </Text>
              </View>
              <Text
                variant="caption"
                color={pin.excluded ? theme.textFaint : theme.textMuted}
                numberOfLines={1}
                style={styles.pinName}
              >
                {pin.name}
              </Text>
            </View>
          ))}
          <Text variant="caption" color={theme.textFaint}>
            {t('map.legend')}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Rank by colour, as the third signal after number and size. */
function pinTone(pin: VenuePin, theme: Theme): string {
  if (pin.excluded) return theme.surface3;
  if (pin.tone === 'primary') return theme.primary;
  if (pin.tone === 'near') return theme.surface2;
  return theme.surface3;
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space[3],
    gap: space[3],
  },
  centred: {
    minHeight: size.buttonLarge * 3,
    justifyContent: 'center',
  },
  surface: {
    borderRadius: radius.md,
    minHeight: size.buttonLarge * 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[3],
  },
  legend: {
    gap: space[2],
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  pinDot: {
    width: space[6],
    height: space[6],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinName: {
    flex: 1,
  },
});
