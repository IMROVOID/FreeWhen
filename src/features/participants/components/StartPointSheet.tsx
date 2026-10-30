/**
 * The starting-point question, asked on an event instead of a route.
 *
 * ★ THE INVITE FLOW REPLACES THE ROUTE; THE OWNER CANNOT BE.
 *
 * After a join, `/e/[token]` replaces itself with `/e/[token]/location`, which is
 * right — a guest is not yet anywhere. The organiser has just created an event
 * and landed on it, and pulling them off before they have seen it is a different
 * and worse product. So this is a sheet over the event home: the page stays
 * behind it, the question is the same one, and the answers are the same
 * `useStartPoint` calls the location route makes.
 *
 * ★ IT IS DISMISSIBLE, UNLIKE THE NICKNAME GATE.
 *
 * A name is required for other people to read the event; a location is optional
 * by design (FR-1.22) and skipping costs the person nothing but their own travel
 * estimate. A gate that cannot be dismissed would be a worse deal than the
 * feature it is asking about.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { LocationPicker } from '@/src/features/participants/components/LocationPicker';
import { useStartPoint } from '@/src/features/participants/hooks/useStartPoint';

export interface StartPointSheetProps {
  visible: boolean;
  eventId: string;
  userId: string | null;
  onDismiss: () => void;
  /**
   * Reports a saved point upward.
   *
   * ★ THE SHEET OWNS ITS OWN `useStartPoint`, AND THAT SPLIT THE STATE.
   *
   * The event screen also calls `useStartPoint` — it needs the caller's own
   * coordinate for the route map's origin. Two instances of one hook over the same
   * server state are two independent copies: saving here updated this copy, and the
   * event screen's `saved` stayed `null` until it remounted. The route map then had
   * no origin and drew no line, which read as "the routing does not work".
   *
   * Reporting the value on save is the smallest correct seam: the sheet keeps
   * owning the prompt, and the screen learns the result without a refetch.
   */
  onSaved?: (point: { lat: number; lng: number }) => void;
}

export function StartPointSheet({
  visible,
  eventId,
  userId,
  onDismiss,
  onSaved,
}: StartPointSheetProps) {
  const startPoint = useStartPoint(eventId, userId);

  /**
   * A successful save closes the sheet.
   *
   * The route version swaps its body to the saved summary because it has nowhere
   * else to go; here the event home behind the sheet is where the participant
   * wanted to be, so the confirmation is the sheet leaving.
   */
  const wasSaved = useRef(false);
  useEffect(() => {
    if (startPoint.status === 'saved' && !wasSaved.current) {
      wasSaved.current = true;

      // The hook's own `saved` is the authoritative rounding, so it is reported
      // as-is rather than re-derived from what the picker submitted.
      const point = startPoint.saved;
      if (point) onSaved?.({ lat: point.lat, lng: point.lng });

      onDismiss();
    }
    if (startPoint.status !== 'saved') wasSaved.current = false;
  }, [startPoint.status, startPoint.saved, onDismiss, onSaved]);

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} testID="start-point-sheet">
      <View style={styles.content}>
        <LocationPicker
          onUseCurrent={() => void startPoint.requestCurrentLocation()}
          onSaveManual={(lat, lng, label) => void startPoint.saveManual(lat, lng, label)}
          onSkip={() => {
            startPoint.skip();
            onDismiss();
          }}
          isBusy={startPoint.status === 'requesting' || startPoint.status === 'saving'}
          errorKey={startPoint.errorKey}
          testID="start-point-sheet-picker"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 0,
  },
});
