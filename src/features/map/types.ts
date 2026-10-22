/**
 * The map adapter surface (Plan 08, D19).
 *
 * ★ THE SCREEN NEVER IMPORTS `@rnmapbox/maps` DIRECTLY.
 *
 * One adapter, one interface, several implementations chosen at runtime. Two
 * things the adapter exists to hide:
 *
 *  1. **Tap targets differ.** Mapbox Standard does not support
 *     `queryRenderedFeatures`, so venue selection must come from our own
 *     GeoJSON source. The adapter picks the supported path.
 *  2. **Theme differs.** Mapbox follows the app theme via `lightPreset`;
 *     Maplibre swaps a whole style JSON. Both satisfy Style Guide §2.2 by
 *     mapping the same tokens.
 *
 * ★ ALSO: THE MAP IS OPTIONAL BY CONSTRUCTION.
 *
 * Neither renderer is installed, and both would require a development build.
 * So the ladder has more than one legitimate resting place, and level 4 —
 * list-only — is a shipping state, not a failure (PRD-04 §13.7). A product
 * whose ranking is useful without a map can afford to have no map; this file
 * is where that is decided rather than assumed.
 */

import type { Coordinate } from '@/src/routing/types';

/**
 * The fallback ladder (PRD-04 §3.1–§3.2).
 *
 *   1. Mapbox Standard, 3D           — the default
 *   2. Maplibre + Neshan tiles       — a different renderer, same props
 *   3. Static image                  — no interaction, still informative
 *   4. List-only                     — no map at all
 *
 * Levels 3 and 4 are STATES, not errors. The screen renders them without an
 * apology and without a retry that cannot succeed.
 */
export type MapRenderLevel = 1 | 2 | 3 | 4;

/** A venue pin. Rank is encoded three ways, never colour alone (FR-4.13). */
export interface VenuePin {
  venueId: string;
  name: string;
  coordinate: Coordinate;
  rank: number;
  /** Encoded from `rank`: a bigger dot for the leading venue. */
  size: 'lead' | 'near' | 'rest';
  /** Encoded from `rank`: the theme's primary for the leader, neutral after. */
  tone: 'primary' | 'near' | 'rest';
  selected: boolean;
  /** `true` when the venue was hard-filtered — still shown, muted (FR-4.14). */
  excluded: boolean;
}

/**
 * A participant's location as an area, never a point (FR-4.7, FR-8.16).
 *
 * ★ THE RADIUS IS SIZED TO `accuracyM`.
 *
 * A realistic-looking pin that is not the true position is both misleading
 * and a platform-compliance exposure. `radiusForAccuracy` turns metres into
 * metres-on-screen, and the circle is labelled `محدودهٔ تقریبی`.
 */
export interface ApproxArea {
  participantId: string;
  name: string;
  coordinate: Coordinate;
  accuracyM: number;
  /** The identity colour, matching the participant's avatar ring (§2.5). */
  color: string;
}

/** The camera framing. Always the event bounding box (FR-8.16, D19). */
export interface MapCamera {
  /** The box to fit, with padding. NEVER a single participant's fix. */
  bounds: BBox;
  /** Pinned zoom floor, so a degenerate box does not zoom to a rooftop. */
  minZoom: number;
  pitch: number;
}

/** A south-west / north-east pair. */
export interface BBox {
  southWest: Coordinate;
  northEast: Coordinate;
}

export interface MapAdapter {
  readonly level: MapRenderLevel;
  /** Must run before the first map mounts — see `resolveMapLevel`. */
  configure(): void;
  setCamera(camera: MapCamera): void;
  setParticipantAreas(areas: ApproxArea[]): void;
  setVenuePins(pins: VenuePin[]): void;
  onSelectVenue(callback: (venueId: string) => void): () => void;
  /** The Meet Point moment: a 3D camera reveal. */
  revealMeetPoint(at: Coordinate): void;
  setTheme(mode: 'light' | 'dark'): void;
}

/**
 * The zoom floor for the event bounding box.
 *
 * Named rather than inlined: all participants in one building gives a
 * degenerate box, and without a floor the map zooms to a rooftop — which is
 * also a privacy problem, since it would reveal a precise position.
 */
export const MIN_EVENT_ZOOM = 11;

/** The pitch for the Meet Point reveal (PRD-04: ~45–60°). */
export const MEET_POINT_PITCH = 50;

/** The resting pitch for the ranked map — tilted enough to read as 3D. */
export const DEFAULT_PITCH = 0;

/** The padding applied around the event's own extent when fitting the camera. */
export const EVENT_PADDING_RATIO = 0.12;
