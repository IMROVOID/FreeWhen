/**
 * A still picture of a place, from MapBox's Static Images API.
 *
 * ★ THIS REPLACED A SLIPPY-TILE URL BUILDER, AND THE DISTINCTION MATTERS.
 *
 * The previous implementation assembled a CARTO raster-tile URL and drew it in an
 * `<Image>`. That worked, but it meant the preview had its own provider, its own
 * key, its own dark-theme compositing rule (`dark_nolabels` under
 * `dark_only_labels`, because one label-composited style drew place names that
 * vanished on the app's dark frame) and its own `@2x` density trick. Four rules in
 * a thumbnail.
 *
 * The Static Images API answers all four in one request: the style is named rather
 * than composited, the label ink is the style's own, and the density is a
 * parameter. One URL, one provider, the same MapBox account and style as the
 * interactive map beside it — so the two pictures cannot disagree about what dark
 * looks like.
 *
 * ★ IT DEGRADES TO A PIN, NOT TO A LABEL.
 *
 * A static image is still a network request that can fail — an offline device, a
 * blocked host. When it does, the caller draws a pin on the theme's own surface
 * rather than replacing the picture with words, so the block still reads as a
 * place at a glance and never as an error message about one.
 */

import {
  MAPBOX_STATIC_BASE,
  STATIC_SIZE,
  STATIC_ZOOM,
  readMapboxToken,
  styleForTheme,
} from '@/src/features/map/mapbox-token';

/**
 * The preview's height.
 *
 * Wide, short, and never the tallest thing in a card.
 */
export const PROPOSAL_MAP_PREVIEW_HEIGHT = 96;

/** Stop pin, in the app's accent, at a fixed pixel offset from the top-left. */
function pinOverlay(accent: string): string {
  // `pin-s` is MapBox's small marker. The colour is the theme's accent with the
  // leading `#` removed, which is the syntax the API documents.
  return `pin-s+${accent.replace('#', '')}`;
}

/**
 * The static-image URL for a point, or `null` when this build has no token.
 *
 * `null` rather than a keyless URL: an unkeyed request is rejected by MapBox and
 * arrives back as a broken image with nothing in the log — the silent-blank
 * failure the tile provider taught this codebase once already. A caller that
 * receives `null` knows there is no picture to ask for.
 *
 * The `bbox`/`width`/`height` pair frames the point with the pin at its centre.
 * `@2x` gives the retina density a 96pt-tall box needs on any phone sold in the
 * last decade.
 */
export function staticMapUrl(
  lat: number,
  lng: number,
  theme: 'light' | 'dark',
  accent: string,
): string | null {
  const mapboxCredential = readMapboxToken();
  if (mapboxCredential === null) return null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 85.0511) return null;

  const style = styleForTheme(theme);

  // The style's short name is the last path segment — `mapbox://styles/mapbox/
  // streets-v12` becomes `mapbox/streets-v12`, which is what the URL expects.
  const stylePath = style.replace('mapbox://styles/', '');

  const size = `${STATIC_SIZE}x${STATIC_SIZE}@2x`;

  // ★ THE APPEARANCE IS A QUERY PARAMETER NOW, BECAUSE STANDARD IS ONE STYLE.
  //
  // Light and dark share a style URI, so the path alone renders the same picture
  // twice — a dark proposal card would show a light map. Standard's Static Images
  // support takes the preset as `setConfig`, which is what carries the theme here,
  // mirroring `setConfigProperty('basemap', 'lightPreset', …)` on the live map.
  const preset = theme === 'dark' ? 'night' : 'day';
  const config = encodeURIComponent(JSON.stringify({ basemap: { lightPreset: preset } }));

  return (
    `${MAPBOX_STATIC_BASE}/${stylePath}/static/` +
    `${pinOverlay(accent)}(${lng},${lat})/` +
    `${lng},${lat},${STATIC_ZOOM},0/` +
    `${size}?setConfig=${config}&access_token=${mapboxCredential}`
  );
}
