/**
 * The event's route map — VIEW AND PAN, NEVER CHANGE.
 *
 * ★ THE REQUEST WAS SPECIFIC ABOUT THE DIRECTION OF CONTROL.
 *
 * "users should be able to see (not change it) the Routing (User Location to
 * Proposal Location) and move the Camera/Map on Event pages". So this surface
 * takes no `onPress`: a tap on the map does nothing, because the line is a fact
 * about an event, not a form. What the user does get is the whole camera — drag,
 * pinch, tilt, rotate — because a route you cannot look around is a screenshot.
 *
 * ★ THE LINE IS ONE PER PROPOSAL, IN RANK ORDER, IN THE APP'S ACCENT.
 *
 * A straight line is drawn DASHED and labelled as a direction, never as a road.
 * `fetchRoute` resolves to exactly that when the geometry proxy is unavailable, so
 * an empty map never appears where a route belongs — and the picture never claims
 * a street the provider did not return.
 *
 * ★ IT DEGRADES TO THE LEGEND, WHICH IS NOT A FAILURE.
 *
 * With no start point, no venues, or no token, this renders the same information
 * as text. That is the documented level-4 state (PRD-04 §13.7) and it is a
 * shipping state, not an apology: every fact the map would show is in the list and
 * the legend beside it.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, NavigationArrow } from 'phosphor-react-native';

import { Text } from '@/src/components/ui/Text';
import { InteractiveMap } from '@/src/components/ui/InteractiveMap';
import type { MapLine, MapMarker } from '@/src/components/ui/InteractiveMap';
import { hasMapbox } from '@/src/features/map/mapbox-token';
import { mapAppearance } from '@/src/features/map/appearance';
import { DEFAULT_MAP_CENTRE } from '@/src/features/map/projection';
import { boundingBox } from '@/src/features/map/level';
import { DEFAULT_PITCH, EVENT_PADDING_RATIO, MIN_EVENT_ZOOM } from '@/src/features/map/types';
import { fetchRoute, fallbackRoute, type RouteGeometry } from '@/src/features/venues/services/route-line';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Coordinate } from '@/src/routing/types';

export interface RouteDestination {
  /** The proposal or venue id, for a stable React key and a stable marker. */
  id: string;
  name: string;
  coordinate: Coordinate;
  /**
   * Who proposed it.
   *
   * ★ THE PIN BELONGS TO A PERSON, NOT TO A RANK.
   *
   * Every destination used to be drawn in the app's accent, so three proposals by
   * three people were three identical dots — the reported "the proposal locations
   * are circles, not pins, and they are not anyone's colour". The colour is the
   * proposer's own nickname colour (the same one their name is printed in), which
   * is what lets a reader connect a pin on the map to a person in the list.
   */
  proposer: string;
  /** The proposer's colour, from `colorForNickname`. */
  color: string;
}

export interface EventRouteMapProps {
  /** The viewer's own start point, or `null` when they have not set one. */
  origin: Coordinate | null;
  destinations: RouteDestination[];
  testID?: string;
}

/** The map's height on the event page. Short enough to sit inside the scroll. */
const MAP_HEIGHT = 260;

export function EventRouteMap({ origin, destinations, testID }: EventRouteMapProps) {
  const { t } = useTranslation();
  const { t: theme, name } = useTheme();

  const [routes, setRoutes] = useState<Record<string, RouteGeometry>>({});
  const [basemapFailed, setBasemapFailed] = useState(() => !hasMapbox());

  const appearance = mapAppearance(name, theme.primary);

  /**
   * The camera frames the whole event, never one person.
   *
   * `boundingBox` is the same helper the ranked map uses, and for the same reason
   * (FR-8.16): a camera centred on one participant's fix leaks exactly what the
   * fuzzed coordinate was protecting.
   */
  const camera = useMemo(() => {
    const points = [
      ...(origin ? [origin] : []),
      ...destinations.map((destination) => destination.coordinate),
    ];

    const box = boundingBox(points, EVENT_PADDING_RATIO);

    if (box === null) {
      // Nowhere to frame: the fallback centre is the default city, at the zoom
      // floor, so the map is not a blank void.
      return {
        centre: DEFAULT_MAP_CENTRE,
        zoom: MIN_EVENT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: 0,
      };
    }

    const centre = {
      lat: (box.southWest.lat + box.northEast.lat) / 2,
      lng: (box.southWest.lng + box.northEast.lng) / 2,
    };

    return { centre, zoom: MIN_EVENT_ZOOM, pitch: DEFAULT_PITCH, bearing: 0 };
  }, [origin, destinations]);

  /**
   * One line per destination.
   *
   * Fetched in parallel and merged rather than awaited in sequence: three venues
   * drawn one after another would take three round trips and paint three times.
   */
  useEffect(() => {
    if (origin === null || destinations.length === 0) {
      setRoutes({});
      return;
    }

    let active = true;

    void (async () => {
      const entries = await Promise.all(
        destinations.map(async (destination) => {
          const geometry = await fetchRoute(origin, destination.coordinate);
          return [destination.id, geometry ?? fallbackRoute(origin, destination.coordinate)] as const;
        }),
      );

      if (!active) return;
      setRoutes(Object.fromEntries(entries));
    })();

    return () => {
      active = false;
    };
  }, [origin, destinations]);

  const markers: MapMarker[] = useMemo(() => {
    const originMarker: MapMarker[] =
      origin === null
        ? []
        : [
            {
              id: 'origin',
              coordinate: origin,
              color: theme.info,
              label: t('location.approxArea'),
            },
          ];

    // ★ ONE PIN PER PROPOSAL, IN THE PROPOSER'S OWN COLOUR.
    //
    // These are places people are asking the group to go to, so the map's job is to
    // answer "whose option is that, and are they far from each other?" — and a rank
    // is already stated by the ranked list below. No `selected` emphasis for the
    // leader either: emphasis by size plus colour plus position was three encodings
    // for one fact, and it made the first proposal look chosen before the vote.
    const destinationMarkers = destinations.map((destination) => ({
      id: destination.id,
      coordinate: destination.coordinate,
      color: destination.color,
      label: t('map.proposalPinLabel', {
        name: destination.proposer,
        place: destination.name,
      }),
    }));

    return [...originMarker, ...destinationMarkers];
  }, [origin, destinations, theme.info, t]);

  const lines: MapLine[] = useMemo(
    () =>
      Object.entries(routes).map(([id, geometry]) => ({
        id,
        points: geometry.points,
        color: theme.primary,
        // A straight line is a bearing, not a road. Saying so in the drawing is
        // cheaper than saying it in a caption nobody reads.
        dashed: geometry.source === 'straight_line',
      })),
    [routes, theme.primary],
  );

  const hasAnyLocation = markers.length > 0;

  /**
   * The empty state.
   *
   * Timed to the moment an organizer sees it — seconds after creating an event
   * there is one participant and no venue (AC-4.5.1) — so it invites the action
   * rather than describing the absence.
   */
  if (!hasAnyLocation || basemapFailed) {
    return (
      <View
        testID={testID ? `${testID}-empty` : undefined}
        style={[styles.fallback, { backgroundColor: theme.surface1, borderColor: theme.line }]}
      >
        <Text variant="body" color={theme.textMuted} align="center">
          {t('map.unavailableOnWeb')}
        </Text>
        <Text variant="caption" color={theme.textFaint} align="center">
          {t('map.unavailableOnWebBody')}
        </Text>
      </View>
    );
  }

  const isFallback = Object.values(routes).some((route) => route.source === 'straight_line');

  return (
    <View testID={testID} style={styles.panel}>
      <View style={[styles.frame, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {/*
          ★ NO `onPress`. The map is read-only by construction: a caller cannot
          pass an edit handler because this component does not accept one.
        */}
        <InteractiveMap
          camera={camera}
          markers={markers}
          lines={lines}
          theme={appearance.mode}
          accent={appearance.accent}
          onUnavailable={() => setBasemapFailed(true)}
          testID={testID ? `${testID}-surface` : undefined}
        />
      </View>

      {/* The legend. Every fact the drawing shows, as text (FR-4.5). */}
      <View style={styles.legend}>
        {/* The legend. Every fact the drawing shows, as text (FR-4.5).
            ★ IT NAMES PEOPLE, BECAUSE THE PINS ARE PEOPLE'S OPTIONS.
            It used to read «مکان رتبهٔ ۱, مکان رتبهٔ ۲, …», which repeated a rank the
            list already states and answered the one question a coloured pin raises —
            whose is it? — with nothing. The name carries the proposer's colour, the
            same one their name has on their proposal card. */}
        {origin !== null && (
          <View style={styles.legendRow}>
            <NavigationArrow size={size.stepperButton / 2} color={theme.info} weight="bold" />
            <Text variant="caption" color={theme.textMuted} numberOfLines={1} style={styles.legendText}>
              {t('location.useCurrent')}
            </Text>
          </View>
        )}

        {destinations.map((destination) => (
          <View key={destination.id} style={styles.legendRow}>
            <MapPin size={size.stepperButton / 2} color={destination.color} weight="fill" />
            <Text variant="caption" color={theme.textMuted} numberOfLines={1} style={styles.legendText}>
              <Text variant="caption" color={destination.color}>
                {destination.proposer}
              </Text>
              {` — ${destination.name}`}
            </Text>
          </View>
        ))}

        {isFallback && (
          <Text variant="caption" color={theme.textFaint}>
            {t('map.directionOnly')}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space[3],
  },
  frame: {
    height: MAP_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fallback: {
    minHeight: size.buttonLarge * 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
    gap: space[1],
  },
  legend: {
    gap: space[2],
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  legendText: {
    flex: 1,
  },
});
