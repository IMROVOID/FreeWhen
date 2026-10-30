/**
 * The interactive map, on iOS and Android.
 *
 * ★ `react-native-maps` WITH `mapType="none"`, AND MAPBOX RASTER TILES OVER IT.
 *
 * This is the decision Plan 64 D64-1 records, and it is a deliberate trade:
 *
 *  - `@rnmapbox/maps` would need a Gradle Maven credential for MapBox's private
 *    artifacts, and this project builds APKs WITHOUT an Expo account and without
 *    EAS (`scripts/build/build-apk.sh` documents why: EAS has no published policy
 *    for Iran residents). A private Maven is exactly the dependency that breaks
 *    that path.
 *  - `react-native-maps` on Android renders the Google Maps SDK. With
 *    `mapType="none"` that SDK draws nothing itself — no Google tiles, no Google
 *    attribution — and becomes a camera plus an overlay host. Every visible pixel
 *    is then MapBox's, delivered as raster tiles through `<UrlTile>`.
 *
 * What is genuinely lost: vector labels, native symbol layers and GPU-clipped
 * 3D buildings. What is kept: MapBox basemaps, the same styles as the web map, a
 * real pitched camera, markers, polylines and polygons. For a product that draws
 * a route and some pins over a themed basemap, that is the right side of the
 * trade.
 *
 * ★ THE TILES ARE THE SAME STYLE THE WEB MAP LOADS.
 *
 * `styleForTheme()` returns a `mapbox://` URI, which `mapbox-gl` resolves itself.
 * A raster tile overlay needs the style's raster endpoint instead, resolved from
 * that same URI so the two platforms cannot drift to different basemaps.
 */

import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import MapView, { Marker, Polygon, Polyline, UrlTile, type Region } from 'react-native-maps';

import type {
  InteractiveMapProps,
  MapCamera,
  MapCircle,
  MapLine,
  MapMarker,
} from './InteractiveMap';
import { readMapboxToken, styleForTheme } from '@/src/features/map/mapbox-token';
import { clampZoom } from '@/src/features/map/appearance';
import { map as mapTokens } from '@/src/theme/tokens';
import { withAlpha } from '@/src/features/map/projection';
import type { Coordinate } from '@/src/routing/types';

/** The marker diameter, in points. */
const MARKER_SIZE = 18;

/**
 * The MapBox raster tile URL for a style.
 *
 * `mapbox://styles/mapbox/streets-v12` becomes
 * `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x`.
 * `512` is the tile size MapBox's style tiles endpoint serves; requesting the
 * `256` variant returns an image at half the expected density, which on a modern
 * phone reads as a blurry map.
 */
export function rasterTileUrl(theme: 'light' | 'dark', token: string): string {
  const stylePath = styleForTheme(theme).replace('mapbox://styles/', '').replace('mapbox://', '');
  return `https://api.mapbox.com/styles/v1/${stylePath}/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`;
}

/** The camera, as `react-native-maps` describes it. */
export function toRegion(camera: MapCamera): Region {
  const { lat, lng } = camera.centre;

  // A degree of latitude is ~111 km. The span is derived from the zoom so the
  // native camera matches what the web map shows at the same zoom — otherwise the
  // two platforms frame visibly different areas for one payload.
  const span = 360 / 2 ** camera.zoom;

  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: Math.min(180, span),
    longitudeDelta: Math.min(360, span),
  };
}

/**
 * A circle as a polygon, because this surface has no circle primitive.
 *
 * 32 segments is smooth at every zoom the product uses and costs nothing to
 * build. The radius is in metres, matching `MapCircle`, and is converted with the
 * same equirectangular approximation the platform uses for small areas.
 */
export function circlePolygon(
  circle: MapCircle,
  segments = 32,
): Array<{ latitude: number; longitude: number }> {
  const earthRadiusM = 6_371_000;
  const { lat, lng } = circle.coordinate;
  const points: Array<{ latitude: number; longitude: number }> = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (index / segments) * 2 * Math.PI;
    const dLat = (circle.radiusMetres / earthRadiusM) * Math.cos(bearing);
    const dLng =
      (circle.radiusMetres / (earthRadiusM * Math.cos((lat * Math.PI) / 180))) *
      Math.sin(bearing);

    points.push({
      latitude: lat + (dLat * 180) / Math.PI,
      longitude: lng + (dLng * 180) / Math.PI,
    });
  }

  return points;
}

export function InteractiveMap({
  camera,
  markers = [],
  lines = [],
  circles = [],
  theme,
  accent,
  onPress,
  onCameraChange,
  onUnavailable,
  onReady,
  testID,
}: InteractiveMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const mapboxCredential = readMapboxToken();

  // A missing token is the level-4 state, reported once, not per render.
  const reported = useRef(false);
  useEffect(() => {
    if (mapboxCredential === null && !reported.current) {
      reported.current = true;
      onUnavailable?.();
    }
  }, [mapboxCredential, onUnavailable]);

  // `token` is guaranteed non-null past the guard below, so the template is a
  // string at the call site. Computing it here keeps the memo honest.
  const tileTemplate = useMemo(
    () => (mapboxCredential === null ? '' : rasterTileUrl(theme, mapboxCredential)),
    [theme, mapboxCredential],
  );

  const initialRegion = useRef(toRegion(camera)).current;

  /**
   * ★ THE CALLER'S CENTRE AND ZOOM ARE HONOURED ON NATIVE, NOT JUST ON WEB.
   *
   * `initialRegion` is read once, which is right for a marker update — re-applying
   * it whenever a pin moved would yank the camera back and make the map a
   * slideshow. But the picker's zoom buttons and its GPS button both change
   * `camera.centre`/`camera.zoom` and expect the map to follow; with a first-region
   * only, those controls did nothing on a device while working in the browser.
   *
   * The driver is a fingerprint of the REQUESTED camera. While the user is dragging,
   * `onRegionChangeComplete` reports the new centre back and the caller re-renders
   * with it, so the fingerprint matches and nothing is applied — the camera is only
   * moved when the request differs from what the map already shows.
   */
  const requestedRef = useRef<string>('');
  const requested = `${camera.centre.lat.toFixed(5)}:${camera.centre.lng.toFixed(5)}:${camera.zoom.toFixed(2)}`;

  useEffect(() => {
    if (requestedRef.current === requested) return;
    requestedRef.current = requested;

    // The first application is the initial region, already in place.
    if (!mapRef.current) return;

    mapRef.current.animateCamera(
      {
        center: { latitude: camera.centre.lat, longitude: camera.centre.lng },
        zoom: camera.zoom,
        // The product's resting pose is 3D; a region cannot carry a tilt, so it is
        // applied here. `pitchEnabled` lets the user flatten it again.
        pitch: camera.pitch,
        heading: camera.bearing,
      },
      { duration: 250 },
    );
  }, [requested, camera.centre.lat, camera.centre.lng, camera.zoom, camera.pitch, camera.bearing]);

  if (mapboxCredential === null) {
    // The caller renders its stated state from `onUnavailable`; this frame stays
    // empty rather than drawing Google's own map under the app's controls.
    return <View testID={testID} style={styles.frame as ViewStyle} />;
  }

  return (
    <MapView
      testID={testID}
      ref={mapRef}
      style={styles.frame as ViewStyle}
      // The Google basemap draws nothing; every pixel comes from the MapBox tiles
      // below. This is what keeps Google out of the product's appearance and out
      // of its attribution obligations.
      mapType="none"
      initialRegion={initialRegion}
      // `pitchEnabled` is what makes the camera genuinely 3D on this platform.
      pitchEnabled
      rotateEnabled
      zoomEnabled
      scrollEnabled
      toolbarEnabled={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      onMapReady={() => {
        // `initialRegion` cannot express a tilt, so the resting 3D pose is applied
        // the moment the map exists. Without this the APK rested flat while the
        // browser map was pitched — a renderer disagreement on requirement 3.
        mapRef.current?.setCamera({
          center: { latitude: camera.centre.lat, longitude: camera.centre.lng },
          zoom: camera.zoom,
          pitch: camera.pitch,
          heading: camera.bearing,
        });
        requestedRef.current = requested;
        onReady?.();
      }}
      onPress={(event) => {
        const { latitude, longitude } = event.nativeEvent.coordinate;
        onPress?.({ lat: latitude, lng: longitude });
      }}
      onRegionChangeComplete={(region) => {
        onCameraChange?.({
          centre: { lat: region.latitude, lng: region.longitude },
          zoom: clampZoom(Math.log2(360 / Math.max(region.latitudeDelta, 1e-9))),
          pitch: 0,
          bearing: 0,
        });
      }}
    >
      <UrlTile
        urlTemplate={tileTemplate}
        // `@2x` tiles are 512 px of image for a 256 pt area; without this the
        // basemap renders at double size and every label is cropped.
        tileSize={256}
        maximumZ={20}
        minimumZ={0}
        shouldReplaceMapContent
      />

      {circles.map((circle) => (
        <Polygon
          key={circle.id}
          coordinates={circlePolygon(circle)}
          fillColor={withAlpha(circle.color, 0.18)}
          strokeColor={withAlpha(circle.color, 0.4)}
          strokeWidth={1}
        />
      ))}

      {lines.map((line) => (
        <Polyline
          key={line.id}
          // `react-native-maps` takes `{latitude, longitude}`; the shared surface
          // and the server both speak GeoJSON `[lng, lat]`.
          coordinates={line.points.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
          strokeColor={line.color}
          strokeWidth={line.dashed ? 2 : 4}
          // A dashed line would need a texture on this platform; a thinner stroke
          // carries the same "this is a direction, not a road" meaning.
          lineDashPattern={line.dashed ? [8, 6] : undefined}
        />
      ))}

      {markers.map((marker) => (
        <Marker
          key={marker.id}
          coordinate={{ latitude: marker.coordinate.lat, longitude: marker.coordinate.lng }}
          title={marker.label}
          accessibilityLabel={marker.label}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={marker.selected ? 2 : 1}
        >
          <View
            style={{
              width: marker.selected ? MARKER_SIZE * 1.35 : MARKER_SIZE,
              height: marker.selected ? MARKER_SIZE * 1.35 : MARKER_SIZE,
              borderRadius: MARKER_SIZE,
              backgroundColor: marker.color ?? accent,
              borderWidth: marker.selected ? 3 : 2,
              borderColor: mapTokens.markerRing,
            }}
          />
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    overflow: 'hidden',
  },
});

export type { MapCamera, MapLine, MapCircle, MapMarker, Coordinate };
