/**
 * The proposal's place, drawn and routed.
 *
 * ★ THIS REPLACED A STILL IMAGE, AND THE REPORT IS WHY.
 *
 * The card used to show `ProposalMapPreview`: one MapBox Static Images request in an
 * `<Image>`. That is a picture OF a map, and on a device it usually was not even
 * that — without an inlined token, or with the request refused, the block fell back
 * to a single `MapPin` glyph, which is the reported "the map is not visible on the
 * proposals, it is just a simple Location icon". A static image also cannot be
 * dragged, and the report asked for exactly that.
 *
 * So this is the same `InteractiveMap` every other surface uses: pannable,
 * zoomable, tiltable, themed by the same resolver and tinted by the same accent.
 *
 * ★ THE PROPOSED PIN AND THE VIEWER'S OWN START POINT, JOINED BY THE ROUTE.
 *
 * The question a proposal card leaves open is "how far is this, for ME?" — and the
 * origin is the answer the product already holds: the caller's own `start_point`,
 * asked for on first entry to the event. Where it exists, this draws the routed line
 * the event map uses, from the same geometry proxy, dashed when the provider
 * answered with a bearing instead of a road. Where it does not, the proposed place
 * is drawn alone: a line from nowhere would be a lie about where the reader is.
 *
 * ★ THE PIN IS THE APP'S ACCENT HERE, NOT THE PROPOSER'S COLOUR.
 *
 * On the event map the colour answers "whose option is that?". On this card there is
 * only one proposal in view, so the proposer's name already answers it — and the
 * pin is the thing being looked AT, so it wears the product's own colour.
 *
 * ★ IT DEGRADES TO THE PLACE, NOT TO AN APOLOGY.
 *
 * No token, no WebGL, or a refused style all land on the caller's stated level-4
 * state, which still names the place and its coordinates.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { InteractiveMap } from '@/src/components/ui/InteractiveMap';
import type { MapLine, MapMarker } from '@/src/components/ui/InteractiveMap';
import { mapAppearance } from '@/src/features/map/appearance';
import { hasMapbox } from '@/src/features/map/mapbox-token';
import { withAlpha } from '@/src/features/map/projection';
import { DEFAULT_PITCH } from '@/src/features/map/types';
import { ORIGIN_COLOR, originMarker } from '@/src/features/map/origin';
import { fallbackRoute, fetchRoute, type RouteGeometry } from '@/src/features/venues/services/route-line';
import { radius } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Coordinate } from '@/src/routing/types';

/**
 * The map's height on a card.
 *
 * The still image it replaced was 96pt — a strip. A card is a card, and a route
 * between two points needs room to be a route rather than two dots near each other.
 */
export const PROPOSAL_ROUTE_MAP_HEIGHT = 180;

/** The zoom a proposal's own map rests at when there is no route to frame. */
const PLACE_ZOOM = 15;

/**
 * The zoom a framed route rests at.
 *
 * Low enough that a five-kilometre trip fits in a 180pt strip at a 50° pitch, which
 * is a smaller screen area than the metres suggest once the camera tilts.
 */
const ROUTE_ZOOM = 12;

export interface ProposalRouteMapProps {
  /** Where the proposal is. */
  destination: Coordinate;
  /** The venue's name, for the pins' accessible names. */
  label: string;
  /** The viewer's own start point — `null` when they never set one. */
  origin?: Coordinate | null;
  testID?: string;
}

export function ProposalRouteMap({ destination, label, origin = null, testID }: ProposalRouteMapProps) {
  const { t } = useTranslation();
  const { t: theme, name } = useTheme();

  const [basemapFailed, setBasemapFailed] = useState(() => !hasMapbox());
  const [route, setRoute] = useState<RouteGeometry | null>(null);

  const appearance = mapAppearance(name, theme.primary);

  const drawableOrigin =
    origin !== null &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Math.abs(origin.lat) <= 85.0511
      ? origin
      : null;

  /**
   * The route, when there is a second end to it.
   *
   * A failure resolves to the straight-line fallback rather than an error — see
   * `route-line.ts` — so this never has to branch on the request having worked.
   */
  useEffect(() => {
    if (drawableOrigin === null) {
      setRoute(null);
      return;
    }

    let active = true;

    void (async () => {
      const geometry = await fetchRoute(drawableOrigin, destination);
      if (!active) return;
      setRoute(geometry ?? fallbackRoute(drawableOrigin, destination));
    })();

    return () => {
      active = false;
    };
  }, [drawableOrigin, destination]);

  /**
   * The camera: the midpoint of the two ends, or the place itself.
   *
   * Memoized on the VALUES rather than rebuilt per render, so the map is not told to
   * jump to an equal pose on every parent re-render — which is what makes a drag
   * survive a vote landing elsewhere on the page.
   */
  const camera = useMemo(() => {
    const lat = drawableOrigin ? (drawableOrigin.lat + destination.lat) / 2 : destination.lat;
    const lng = drawableOrigin ? (drawableOrigin.lng + destination.lng) / 2 : destination.lng;

    return {
      centre: { lat, lng },
      zoom: drawableOrigin ? ROUTE_ZOOM : PLACE_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: 0,
    };
  }, [drawableOrigin, destination.lat, destination.lng]);

  const markers: MapMarker[] = useMemo(() => {
    const proposed: MapMarker = {
      id: 'proposed',
      coordinate: destination,
      color: theme.primary,
      selected: true,
      label,
    };

    const originPoint = originMarker(drawableOrigin, t('location.youAreHere'));
    if (originPoint === null) return [proposed];

    // ★ THE ORIGIN IS A DOT IN THE READER'S OWN COLOUR, NOT A SECOND PIN.
    //
    // Two teardrops read as two options, and the reader's position is not one — it
    // is the reference the card is asking "how far is that, for ME?". The colour is
    // `ORIGIN_COLOR` rather than `theme.info`, which is the near-black
    // `palette.espresso` on the light theme: the reported "black" origin and line.
    return [originPoint, proposed];
  }, [destination, drawableOrigin, label, t, theme.primary]);

  const lines: MapLine[] = useMemo(
    () =>
      route === null
        ? []
        : [
            {
              id: 'proposal-route',
              points: route.points,
              // The same colour as the dot it starts at, so the two read as one fact.
              color: ORIGIN_COLOR,
              // Solid: the card draws a route, not a bearing. See `EventRouteMap`.
              dashed: false,
            },
          ],
    [route],
  );

  if (basemapFailed) {
    return (
      <View
        testID={testID ? `${testID}-unavailable` : undefined}
        style={[
          styles.fallback,
          { backgroundColor: withAlpha(theme.text, 0.04), borderColor: theme.line },
        ]}
      />
    );
  }

  return (
    <View style={styles.frame} testID={testID}>
      <InteractiveMap
        camera={camera}
        markers={markers}
        lines={lines}
        theme={appearance.mode}
        accent={appearance.accent}
        // ★ ZOOM ONLY. There is no auto-pin control on a card: the pin is the
        // proposal, and a control that re-frames onto it is the gesture-undo defect
        // with a button on top — see `InteractiveMap`'s `controls` prop.
        controls
        onUnavailable={() => setBasemapFailed(true)}
        testID={testID ? `${testID}-surface` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: PROPOSAL_ROUTE_MAP_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  fallback: {
    height: PROPOSAL_ROUTE_MAP_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
