/**
 * The map panel's props, in their own module.
 *
 * ★ WHY THIS IS NOT INSIDE `VenueMap.native.tsx`.
 *
 * Metro resolves `VenueMap.web.tsx` for web and `VenueMap.native.tsx` for
 * native, so the two implementations can never import each other's module —
 * and a shared type imported from the native file would drag the native
 * module graph into the web bundle, which is the exact failure the split
 * exists to prevent.
 *
 * `tsc` resolves neither suffix: `import … from './VenueMap'` type-checks
 * against `VenueMap.types.ts` through `.native.tsx`, and fails outright on
 * web, because there is no suffix-free implementation. Both call sites sit in
 * `app/`, which the web export renders — see the note in
 * `src/platform/README.md`.
 */

import type { ApproxArea, MapAdapter, VenuePin } from '@/src/features/map/types';
import type { RankedVenue } from '@/src/engine/types';
import type { Coordinate } from '@/src/routing/types';

export interface VenueMapProps {
  adapter: MapAdapter;
  ranked: RankedVenue[];
  /** Venue coordinates by id. A venue without one is listed as off-map. */
  coordinates: Record<string, Coordinate>;
  /** Participant approximate areas, already fuzzed and rounded. */
  areas: Array<{ participantId: string; name: string; coordinate: Coordinate; accuracyM: number }>;
  excludedVenueIds?: readonly string[];
  selectedVenueId?: string | null;
  onSelectVenue?: (venueId: string) => void;
  onPropose?: () => void;
  testID?: string;
}

export type { ApproxArea, MapAdapter, VenuePin };
