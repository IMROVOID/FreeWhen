/**
 * Opening a proposal's venue in the device's map application (Plan 49 T15).
 *
 * The URI rules live in `map-uri.ts`, which imports nothing — this file is only the
 * platform call, so the part worth testing stays testable under Node.
 */

import { Linking, Platform } from 'react-native';

import { geoUri, httpsMapUrl, isPlausible, type MapTarget } from '@/src/features/proposals/services/map-uri';

export type { MapTarget } from '@/src/features/proposals/services/map-uri';

/**
 * Opens the venue in the device's map application.
 *
 * Returns whether a handler was found, so a caller can report the failure rather
 * than leaving a button that silently does nothing.
 */
export async function openInMaps(target: MapTarget): Promise<boolean> {
  if (!isPlausible(target)) return false;

  const geo = geoUri(target);

  try {
    // The web build has no `geo:` handler, and `canOpenURL` there resolves false
    // for it, so this branch is what keeps the browser path working.
    const supported = Platform.OS !== 'web' && (await Linking.canOpenURL(geo));
    await Linking.openURL(supported ? geo : httpsMapUrl(target));
    return true;
  } catch {
    return false;
  }
}
