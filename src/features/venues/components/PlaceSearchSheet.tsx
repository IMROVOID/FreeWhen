/**
 * The place search sheet (Plan 06 Task 8, S8, FR-4.24).
 *
 * Upgraded to use LocationMapPicker: map is the primary selection method
 * with an integrated search bar and GPS location button.
 */

import { LocationMapPicker } from '@/src/components/ui/LocationMapPicker';
import type { VenueRef } from '@/src/types/proposal';

export interface PlaceSearchSheetProps {
  onSelect: (venue: VenueRef) => void;
  onPickOnMap?: () => void;
  bias?: { lat: number; lng: number } | null;
  testID?: string;
}

export function PlaceSearchSheet({
  onSelect,
  bias = null,
  testID,
}: PlaceSearchSheetProps) {
  return (
    <LocationMapPicker
      initialLat={bias?.lat ?? 35.6892}
      initialLng={bias?.lng ?? 51.389}
      onSelect={onSelect}
      testID={testID}
    />
  );
}
