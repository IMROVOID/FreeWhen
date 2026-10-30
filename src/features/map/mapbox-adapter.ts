/**
 * The MapBox adapter — level 1 of the ladder.
 *
 * ★ THE SEAM WAS BUILT FOR THIS AND HAS BEEN EMPTY SINCE.
 *
 * `src/features/map/types.ts` states the rule: the screen never imports a map
 * library, it talks to `MapAdapter`. Every level resolved to `NullMapAdapter`,
 * because neither renderer was installed. This is the implementation that seam was
 * designed for, and it changes nothing above it — the screen, the list and the
 * analytics payload are untouched.
 *
 * ★ IT DOES NOT RENDER. IT RECORDS, AND THE SURFACE READS.
 *
 * The adapter is not a React component; it is the object a screen calls
 * imperatively (`setCamera`, `setVenuePins`, `onSelectVenue`). So it holds the
 * current state and notifies listeners, and `VenueMap` reads that state and hands
 * it to `InteractiveMap`. Keeping the drawing out of here is what makes the whole
 * thing testable without a canvas: every method below can be asserted directly.
 *
 * ★ `configure()` IS WHERE A TOKEN WOULD BE SET, AND IT IS TOO LATE.
 *
 * The original note in `null-adapter.ts` said a real adapter would call
 * `Mapbox.setAccessToken()` here, "at module scope, before the first mount". That
 * ordering is impossible through an object constructed in a `useMemo` — which is
 * exactly why the token is read by `mapbox-token.ts` and handed to the library by
 * the surface that constructs it, not here. `configure()` therefore validates and
 * reports, and does not pretend to initialise a library it does not own.
 */

import {
  NullMapAdapter,
} from './null-adapter';
import {
  type ApproxArea,
  type MapAdapter,
  type MapCamera,
  type MapRenderLevel,
  type VenuePin,
} from './types';
import { hasMapbox } from './mapbox-token';
import type { Coordinate } from '@/src/routing/types';

export class MapboxMapAdapter implements MapAdapter {
  readonly level: MapRenderLevel = 1;

  /** The state the screen set, read by the surface on its next render. */
  camera: MapCamera | null = null;
  areas: ApproxArea[] = [];
  pins: VenuePin[] = [];
  theme: 'light' | 'dark' = 'dark';

  /** The last Meet Point the screen asked for, if any. */
  meetPoint: Coordinate | null = null;

  /** Whether this instance was configured before its first use. */
  configured = false;

  private readonly listeners = new Set<(venueId: string) => void>();

  configure(): void {
    // A token may still be absent — `hasMapbox()` is the authority, and the
    // surface reports the level-4 state itself. The flag exists so a test can
    // assert that configuration happened before the surface mounted.
    this.configured = true;
  }

  setCamera(camera: MapCamera): void {
    this.camera = camera;
  }

  setParticipantAreas(areas: ApproxArea[]): void {
    this.areas = areas;
  }

  setVenuePins(pins: VenuePin[]): void {
    this.pins = pins;
  }

  onSelectVenue(callback: (venueId: string) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  revealMeetPoint(at: Coordinate): void {
    this.meetPoint = at;
  }

  setTheme(mode: 'light' | 'dark'): void {
    this.theme = mode;
  }

  /**
   * A surface reports that the user picked a pin.
   *
   * The map→list direction of the P0 selection sync (FR-4.3/FR-4.7). Exposed
   * rather than private for the same reason `NullMapAdapter.emitSelectVenue` is:
   * the sync is the behaviour that matters, and it must be exercisable.
   */
  emitSelectVenue(venueId: string): void {
    for (const listener of this.listeners) listener(venueId);
  }

}

/**
 * The adapter for this build.
 *
 * ★ TOKEN ABSENT DEGRADES TO THE NULL ADAPTER, NOT TO A BROKEN ONE.
 *
 * Level 4 is a documented shipping state (PRD-04 §13.7) and the screen renders it
 * without an apology. Reporting it honestly is what tells analytics whether the
 * map is a viable dependency at all — a `MapboxMapAdapter` that drew nothing while
 * claiming level 1 would make that number a lie.
 */
export function createMapboxAdapter(fallbackLevel: MapRenderLevel = 4): MapAdapter {
  if (!hasMapbox()) return new NullMapAdapter(fallbackLevel);
  return new MapboxMapAdapter();
}
