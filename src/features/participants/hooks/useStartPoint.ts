/**
 * The location picker's controller (Plan 05 Task 10).
 *
 * ★ THE OS PROMPT IS FIRED ONLY BY AN EXPLICIT TAP.
 *
 * `requestCurrentLocation` is the single place a permission dialog can appear.
 * Nothing calls it at mount, at app start, or as a side effect of navigation —
 * a launch-time request is misread as the app demanding location for its own
 * sake and is denied, and a denial here would cost the whole funnel (FR-8.1).
 *
 * ★ COARSE ONLY.
 *
 * `Accuracy.Low` is the entire precision ask. Fine precision is unnecessary
 * at city scale, it would be discarded by the ~1.1 km rounding anyway
 * and it invites extra store scrutiny for no benefit (FR-8.6, B11).
 *
 * ★ SKIPPING IS A SUCCESS.
 *
 * `skip` reports `join_declined_location`, clears any stored point and resolves.
 * It is not an error path, has no confirmation, and leaves every other feature
 * available (FR-1.22) — the ranking reports reduced coverage instead (Phase 8).
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';

import { logSafe } from '@/src/lib/redact';

import { deleteStartPoint, saveStartPoint, type SavedStartPoint } from '../services/start-point';
import { roundedManualStartPoint, roundedStartPoint } from '../services/round-coords';

export type StartPointStatus = 'idle' | 'requesting' | 'saving' | 'saved' | 'denied' | 'failed';

export interface UseStartPointResult {
  status: StartPointStatus;
  saved: SavedStartPoint | null;
  /** The catalogue key of the last failure, when there was one. */
  errorKey: string | null;
  /** The audience count and expiry shown after adding (FR-8.9). */
  audience: { participant_count: number; expires_at: string } | null;
  requestCurrentLocation: () => Promise<void>;
  saveManual: (lat: number, lng: number, label: string | null) => Promise<void>;
  saveNeighbourhood: (label: string, lat: number, lng: number) => Promise<void>;
  remove: () => Promise<void>;
  skip: () => void;
  reset: () => void;
}

const DENIED_KEY = 'location.permissionDenied';
const FAILED_KEY = 'errors.unknown';

export function useStartPoint(
  eventId: string,
  userId: string | null,
): UseStartPointResult {
  const { t } = useTranslation();

  // The approximate-area label, in the active language. It is stored on
  // the start-point row and read by OTHER participants, so it has to come
  // from the catalogue rather than from a constant in a service module.
  const areaLabel = t('location.approxArea');

  const [status, setStatus] = useState<StartPointStatus>('idle');
  const [saved, setSaved] = useState<SavedStartPoint | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [audience, setAudience] = useState<{ participant_count: number; expires_at: string } | null>(
    null,
  );

  const persist = useCallback(
    async (payload: ReturnType<typeof roundedStartPoint>) => {
      setStatus('saving');
      setErrorKey(null);

      try {
        const result = await saveStartPoint(eventId, payload, userId);
        setSaved(result.start_point);
        setAudience(result.audience);
        setStatus('saved');
      } catch {
        // A refusal here is a validation key the form already showed, or a
        // transport failure. Neither is worth a modal: the options stay usable.
        setErrorKey(FAILED_KEY);
        setStatus('failed');
      }
    },
    [eventId, userId],
  );

  const requestCurrentLocation = useCallback(async () => {
    setStatus('requesting');
    setErrorKey(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        // A denial is a supported outcome, not a dead end: manual entry is the
        // first-class alternative, and it is already on screen.
        setErrorKey(DENIED_KEY);
        setStatus('denied');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      });

      // Rounding happens HERE, before the payload exists (FR-8.11).
      //
      // The label comes from the catalogue, in the active language: it is
      // stored on the row and shown to OTHER participants, so a Persian
      // default baked into a service would ship a Persian label to an
      // English guest (FR-8.13).
      await persist(
        roundedStartPoint(position.coords.latitude, position.coords.longitude, areaLabel),
      );
    } catch {
      setErrorKey(DENIED_KEY);
      setStatus('denied');
    }
  }, [areaLabel, persist]);

  const saveManual = useCallback(
    async (lat: number, lng: number, label: string | null) => {
      await persist(roundedManualStartPoint(lat, lng, label));
    },
    [persist],
  );

  /**
   * A named place, entered by hand.
   *
   * ★ THE NAME TRAVELS AS THE LABEL; THE COORDINATES STAY REQUIRED.
   *
   * `start_point` stores a rounded coordinate and a name, and the ranking needs
   * the coordinate to compute anything. There is no geocoder in this phase (no
   * Neshan key is provisioned, and the map surface is Phase 8), so "search an
   * address" and "enter a neighbourhood" both resolve to manual entry with the
   * name carried as the label — which is exactly the first-class manual path
   * Apple §5.1.1(iv) requires, not a fallback bolted onto a broken geocoder.
   */
  const saveNeighbourhood = useCallback(
    async (label: string, lat: number, lng: number) => {
      const trimmed = label.trim();
      if (trimmed === '') {
        setErrorKey(FAILED_KEY);
        setStatus('failed');
        return;
      }

      await persist(roundedManualStartPoint(lat, lng, trimmed));
    },
    [persist],
  );

  const remove = useCallback(async () => {
    try {
      await deleteStartPoint(eventId, userId);
      setSaved(null);
      setAudience(null);
      setStatus('idle');
    } catch {
      setErrorKey(FAILED_KEY);
      setStatus('failed');
    }
  }, [eventId, userId]);

  const skip = useCallback(() => {
    // Counts only, no coordinate and no name (PRD-01 §9).
    logSafe('join_declined_location', { declined: true });
    setSaved(null);
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorKey(null);
  }, []);

  return {
    status,
    saved,
    errorKey,
    audience,
    requestCurrentLocation,
    saveManual,
    saveNeighbourhood,
    remove,
    skip,
    reset,
  };
}


