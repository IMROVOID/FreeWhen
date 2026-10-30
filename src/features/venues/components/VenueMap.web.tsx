/**
 * The map panel, web implementation.
 *
 * ★ THIS FILE EXISTS SO THE NATIVE MAP NEVER ENTERS THE WEB BUNDLE.
 *
 * With only `VenueMap.native.tsx` present, Metro resolves it for web too and the
 * export dies at IMPORT time — before any runtime branch could help. The
 * `.web.tsx` sibling is the only mechanism that keeps the two apart.
 *
 * ★ THE BROWSER IS NO LONGER LIST-ONLY.
 *
 * This used to render a "map unavailable in the browser" card at level 5,
 * because the product had no DOM map at all. Plan 64 added one:
 * `InteractiveMap.web.tsx` runs `mapbox-gl` against the same MapBox style and the
 * same public token as the native surface. A browser user now gets the ranked
 * places on a real, pannable, pitched map.
 *
 * ★ THE LEGEND STAYS, AND IT IS NOT A FALLBACK.
 *
 * Every fact the drawing shows is also text (FR-4.5). The legend is the
 * accessible path to the same information, and `ParticipantMarker` is pure
 * react-native-web — it keeps the two implementations honest with each other
 * about what "the map" contains.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InteractiveMap } from '@/src/components/ui/InteractiveMap';
import type { MapMarker } from '@/src/components/ui/InteractiveMap';
import { ParticipantMarker } from '@/src/features/venues/components/ParticipantMarker';
import { buildVenuePins, offsetCoincident } from '@/src/features/map/pins';
import { mapAppearance } from '@/src/features/map/appearance';
import { DEFAULT_MAP_CENTRE, nearestVenue } from '@/src/features/map/projection';
import { boundingBox } from '@/src/features/map/level';
import { DEFAULT_PITCH, EVENT_PADDING_RATIO, MIN_EVENT_ZOOM } from '@/src/features/map/types';
import type { VenueMapProps } from '@/src/features/venues/components/VenueMap.types';
import type { ApproxArea } from '@/src/features/map/types';
import { map as mapTokens, participantColors, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export type { VenueMapProps };

export function VenueMap({
  ranked,
  coordinates,
  areas,
  excludedVenueIds = [],
  selectedVenueId = null,
  onSelectVenue,
  testID,
}: VenueMapProps) {
  const { t } = useTranslation();
  const { t: theme, name } = useTheme();

  const areasModel: ApproxArea[] = useMemo(
    () =>
      areas.map((area, index) => ({
        ...area,
        color: participantColors[index % participantColors.length] ?? theme.brand,
      })),
    [areas, theme.brand],
  );

  const excluded = useMemo(() => new Set(excludedVenueIds), [excludedVenueIds]);

  const pins = useMemo(
    () => offsetCoincident(buildVenuePins(ranked, coordinates, excluded, selectedVenueId)),
    [ranked, coordinates, excluded, selectedVenueId],
  );

  // The camera frames the venues AND the participant areas: framing only the
  // venues would leave a distant area outside the viewport, and framing one
  // participant would leak their position (FR-8.16).
  const camera = useMemo(() => {
    const box = boundingBox(
      [...pins.map((pin) => pin.coordinate), ...areasModel.map((area) => area.coordinate)],
      EVENT_PADDING_RATIO,
    );

    const centre =
      box === null
        ? DEFAULT_MAP_CENTRE
        : {
            lat: (box.southWest.lat + box.northEast.lat) / 2,
            lng: (box.southWest.lng + box.northEast.lng) / 2,
          };

    return { centre, zoom: MIN_EVENT_ZOOM, pitch: DEFAULT_PITCH, bearing: 0 };
  }, [pins, areasModel]);

  const markers: MapMarker[] = useMemo(
    () => [
      ...areasModel.map((area) => ({
        id: area.participantId,
        coordinate: area.coordinate,
        color: area.color,
        label: t('map.participantPinLabel', { name: area.name }),
      })),
      ...pins.map((pin) => ({
        id: pin.venueId,
        coordinate: pin.coordinate,
        color: pin.tone === 'primary' ? theme.primary : theme.textMuted,
        selected: pin.selected,
        label: t('map.venuePinLabel', { rank: pin.rank, name: pin.name }),
      })),
    ],
    [areasModel, pins, t, theme.primary, theme.textMuted],
  );

  const appearance = mapAppearance(name, theme.primary);

  return (
    <View testID={testID} style={styles.panel}>
      <View style={[styles.frame, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        <InteractiveMap
          camera={camera}
          markers={markers}
          theme={appearance.mode}
          accent={appearance.accent}
          // A pin tap reports the nearest venue, which is the map→list direction
          // of the P0 selection sync (FR-4.3/FR-4.7). Without `onSelectVenue`
          // the map stays read-only, which is what an embed wants.
          onPress={
            onSelectVenue
              ? (coordinate) => {
                  const nearest = nearestVenue(pins, coordinate);
                  if (nearest) onSelectVenue(nearest);
                }
              : undefined
          }
          testID={testID ? `${testID}-surface` : undefined}
        />
      </View>

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
  frame: {
    height: mapTokens.height,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  legend: {
    gap: space[2],
  },
});
