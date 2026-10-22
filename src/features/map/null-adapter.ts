/**
 * The null adapter (Plan 08 Task 7, level 4 of the ladder).
 *
 * ★ A MAP THAT IS NOT THERE MUST BE INDISTINGUISHABLE FROM A MAP THAT WORKS.
 *
 * The screen talks to `MapAdapter` and nothing else. When no renderer is
 * available, this adapter accepts every call and renders nothing, so the
 * screen's own logic — selection sync, camera framing, analytics — still runs
 * and still works. The list is the product; this is what makes that true
 * rather than aspirational.
 *
 * It is not a stub for a missing feature: level 4 is a documented shipping
 * state (PRD-04 §13.7), and reporting `level: 4` to analytics is what tells
 * the team whether the map is a viable dependency at all.
 */

import type {
  ApproxArea,
  MapAdapter,
  MapCamera,
  MapRenderLevel,
  VenuePin,
} from './types';
import type { Coordinate } from '@/src/routing/types';

export class NullMapAdapter implements MapAdapter {
  readonly level: MapRenderLevel;

  /** The state the screen set, kept so tests can assert the wiring. */
  camera: MapCamera | null = null;
  areas: ApproxArea[] = [];
  pins: VenuePin[] = [];
  theme: 'light' | 'dark' = 'dark';
  private readonly listeners = new Set<(venueId: string) => void>();

  constructor(level: MapRenderLevel = 4) {
    this.level = level;
  }

  configure(): void {
    // Nothing to set up. Notably this is where a real adapter would call
    // `Mapbox.setAccessToken()` — at module scope, before the first mount.
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

  revealMeetPoint(_at: Coordinate): void {
    // No camera to move. The Meet Point screen has its own reveal.
  }

  setTheme(mode: 'light' | 'dark'): void {
    this.theme = mode;
  }

  /**
   * Simulates a pin tap.
   *
   * Exposed rather than private because the selection-sync test drives the
   * map→list direction through it: with no renderer, this is the only way to
   * exercise that path, and the path matters more than the renderer.
   */
  emitSelectVenue(venueId: string): void {
    for (const listener of this.listeners) listener(venueId);
  }
}
