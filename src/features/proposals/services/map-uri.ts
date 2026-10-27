/**
 * The URI builders for an external-map link (Plan 49 T15).
 *
 * ★ PURE, AND SEPARATE FROM THE OPENING.
 *
 * `map-link.ts` calls `Linking`, which imports React Native — fine on a device,
 * but it drags the whole RN runtime into a Node test. The URI construction is the
 * part with rules worth testing, so it lives here with no imports at all.
 *
 * ★ `geo:` FIRST, HTTPS AS THE FALLBACK.
 *
 * `geo:` is the scheme a phone routes to whichever map application the person
 * actually uses — Google Maps, Apple Maps, OsmAnd, a local Iranian app. An https
 * Google link forces one vendor and, on a phone with no Google app, opens a
 * browser instead of a map.
 *
 * ★ COORDINATES, NOT A NAME, WHEN WE HAVE THEM.
 *
 * `share-plan.ts` searches by venue NAME because the share text only has a name. A
 * proposal carries `lat`/`lng`, so this pins the exact place and uses the name as
 * the pin's LABEL — rather than trusting whatever a name search ranks first for a
 * name that appears twice in a city.
 */

export interface MapTarget {
  name: string;
  lat: number;
  lng: number;
}

/** The `geo:` URI for a coordinate pair. `q` is the label shown on the pin. */
export function geoUri(target: MapTarget): string {
  const label = encodeLabel(target.name);
  return `geo:${target.lat},${target.lng}?q=${target.lat},${target.lng}(${label})`;
}

/**
 * Percent-encodes a label for the `geo:` URI.
 *
 * ★ PARENTHESES ARE ENCODED HERE, AND THAT IS NOT REDUNDANT.
 *
 * `encodeURIComponent` leaves `(` and `)` alone — they are legal unencoded — but
 * in this URI form the parentheses DELIMIT the label. A venue called
 * "Café (down, stairs)" would otherwise emit a second `(` inside the group, and a
 * handler that reads to the first `)` would truncate the name to "Café ". Escaping
 * both makes the group unambiguous whatever the name contains.
 */
function encodeLabel(name: string): string {
  return encodeURIComponent(name)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/** The https fallback. Works on every platform, including a plain browser. */
export function httpsMapUrl(target: MapTarget): string {
  return `https://maps.google.com/?q=${target.lat},${target.lng}`;
}

/**
 * Whether the coordinates could name a real place.
 *
 * (0, 0) is what a missing coordinate becomes when it is coerced to a number, and
 * a map opening in the Gulf of Guinea is worse than no map at all. A `NaN` would
 * render as `geo:NaN,NaN`, which no handler accepts and which reads as a broken
 * button.
 */
export function isPlausible(target: MapTarget): boolean {
  return (
    Number.isFinite(target.lat) &&
    Number.isFinite(target.lng) &&
    Math.abs(target.lat) <= 90 &&
    Math.abs(target.lng) <= 180 &&
    !(target.lat === 0 && target.lng === 0)
  );
}
