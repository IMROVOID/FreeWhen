/**
 * The venue, drawn: a small map of the proposal's own coordinates.
 *
 * ★ THE PROPOSAL BOX SHOWED A SENTENCE WHERE A MAP WAS EXPECTED.
 *
 * There was no map on a proposal at all. The venue block carried a `Button`
 * labelled «بازکردن در برنامه دیگر» — "open in another app" — which was the
 * actionable half of an address, and with nothing drawn above it the reader
 * reported exactly what they saw: "the map is not displayed on the proposal
 * boxes, and instead it displays `بازکردن در برنامه دیکر`". A caption standing in
 * for a picture is indistinguishable from a picture that failed.
 *
 * ★ A STATIC TILE, NOT AN INTERACTIVE MAP.
 *
 * The venue picker's interactive map cannot be mounted on the browser at all
 * (`VenueMap.web` is the documented list-only state — the basemap library has no
 * web build), and a proposal is a row in a list: it needs to say WHERE, not to be
 * pannable. So the picture is one CARTO tile at the venue's own tile coordinate,
 * centred on its point. It needs no script, no WebGL and no extra dependency, it
 * is a plain `<Image>` on every platform, and it costs one request that the
 * picker's own tiles already warm.
 *
 * ★ IT DEGRADES TO A PIN, NOT TO A LABEL.
 *
 * A tile request can fail — an offline device, a blocked CDN. When it does, the
 * box draws a pin on the theme's own surface rather than replacing the picture
 * with words, so the block still reads as a place at a glance and never as an
 * error message about one.
 */

import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { MapPin } from 'phosphor-react-native';

import { Image } from 'expo-image';

import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/**
 * The tile zoom.
 *
 * 15 is a neighbourhood: far enough that the named streets around a venue are
 * legible at 96pt tall, near enough that two proposals a kilometre apart are
 * clearly different places.
 */
const PREVIEW_ZOOM = 15;

/** The preview's height. Wide, short, and never the tallest thing in the card. */
const PREVIEW_HEIGHT = 96;

export interface ProposalMapPreviewProps {
  lat: number;
  lng: number;
  /** The venue's name, for the picture's accessible description. */
  label: string;
  testID?: string;
}

/**
 * The tile URL for a point.
 *
 * ★ THE SAME PROVIDER, THE SAME LAYERS, THE SAME KEY AS THE PICKER.
 *
 * `LocationMapPicker` composites `dark_nolabels` under `dark_only_labels` so a
 * dark theme gets WHITE place names — a single label-composited style draws them
 * mid-grey, which disappears on the app's own dark frame. The preview reuses that
 * pairing rather than inventing a second rule, and carries the same optional
 * `EXPO_PUBLIC_CARTO_API_KEY`, so the two pictures cannot disagree about what
 * dark looks like or fail differently on a keyed deployment.
 *
 * Two URLs are returned for dark, in paint order: the canvas, then the labels.
 */
export function previewTileUrls(lat: number, lng: number, dark: boolean): string[] {
  const { x, y } = tileCoordinate(lat, lng, PREVIEW_ZOOM);
  const key = process.env.EXPO_PUBLIC_CARTO_API_KEY;

  const url = (style: string): string =>
    // `@2x` for the retina density: a 128px tile rendered at 96pt is a blurry
    // rectangle on every phone sold in the last decade.
    `https://a.basemaps.cartocdn.com/rastertiles/${style}/${PREVIEW_ZOOM}/${x}/${y}@2x.png${
      key ? `?key=${key}` : ''
    }`;

  return dark ? [url('dark_nolabels'), url('dark_only_labels')] : [url('voyager')];
}

/**
 * The slippy-map tile that contains a point.
 *
 * The standard Web Mercator projection. Exported so the arithmetic is testable
 * without a renderer — an off-by-one here puts the preview on the next town.
 */
export function tileCoordinate(
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));

  const x = Math.floor(((lng + 180) / 360) * scale);

  const radians = (clampedLat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  );

  // Wrapping rather than clamping at the antimeridian: the tile grid is periodic.
  return { x: ((x % scale) + scale) % scale, y: Math.max(0, Math.min(scale - 1, y)) };
}

export function ProposalMapPreview({ lat, lng, label, testID }: ProposalMapPreviewProps) {
  const { t: theme, name } = useTheme();

  /**
   * Whether the tile failed to load.
   *
   * State rather than an error boundary: a missing picture is not an exception,
   * and an `Image` that cannot decode is a routine outcome on a train.
   */
  const [failed, setFailed] = useState(false);

  const frame: ViewStyle = {
    height: PREVIEW_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: theme.surface3,
    overflow: 'hidden',
  };

  const plausible = Number.isFinite(lat) && Number.isFinite(lng);

  if (!plausible || failed) {
    return (
      <View style={[styles.fallback, frame]} testID={testID}>
        <MapPin size={size.stepperButton / 2} color={theme.textMuted} weight="fill" />
      </View>
    );
  }

  const layers = previewTileUrls(lat, lng, name === 'dark');

  return (
    <View style={frame} testID={testID}>
      {layers.map((uri, index) => (
        <Image
          key={uri}
          source={{ uri }}
          style={[styles.image, index > 0 && styles.overlay]}
          contentFit="cover"
          // The picture is information, so it has a description; an empty alt
          // would make the one element that says WHERE silent to a screen reader.
          // Only the base layer is announced — two layers are one picture.
          accessibilityLabel={index === 0 ? label : undefined}
          accessibilityElementsHidden={index > 0}
          onError={() => setFailed(true)}
          testID={index === 0 && testID ? `${testID}-tile` : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0, // rtl-ok: a full-bleed image layer, symmetric on all four edges
    right: 0,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[2],
  },
});

/** Exported for the tests and for a caller that wants to reserve the space. */
export const PROPOSAL_MAP_PREVIEW_HEIGHT = PREVIEW_HEIGHT;
