/**
 * The map's error boundary (Plan 08 Task 7, PRD-04 §13.7, AC-4.2.1).
 *
 * ★ MAP FAILURE IS NOT APP FAILURE.
 *
 * A thrown map component must never block the event screen. This boundary
 * catches and renders the list-only fallback instead — the ranked list and
 * every detail panel stay fully functional, because they never depended on
 * the map in the first place (LIST_FIRST).
 *
 * ★ LEVELS 3–4 ARE SHIPPING STATES, NOT ERRORS.
 *
 * A catch moves the level to 4, but it does not show an error to the user.
 * The fallback is a quiet note that the list is complete, not an apology for
 * something they cannot fix.
 *
 * ★ THE FAILURE IS LOGGED, NOT SWALLOWED.
 *
 * `map_render_failed` carries `level_reached` and nothing about where anyone
 * is. If level 4 shows up in the user test, the map is not a viable
 * dependency and the list-first design is vindicated — that is a measurement,
 * so it has to be recorded.
 */

import React from 'react';

import { logSafe } from '@/src/lib/redact';
import type { MapRenderLevel } from '@/src/features/map/types';

export interface MapErrorBoundaryProps {
  children: React.ReactNode;
  /** What the user sees instead of the map. */
  fallback: React.ReactNode;
  /** Called on a catch, so the screen can record the level it settled on. */
  onFailure?: (level: MapRenderLevel) => void;
}

interface MapErrorBoundaryState {
  hasFailed: boolean;
}

export class MapErrorBoundary extends React.Component<
  MapErrorBoundaryProps,
  MapErrorBoundaryState
> {
  state: MapErrorBoundaryState = { hasFailed: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasFailed: true };
  }

  componentDidCatch(error: Error): void {
    // Diagnostics, not a crash. The message is deliberately not forwarded:
    // a renderer's error text can carry a URL, and a tile URL carries a
    // viewport.
    logSafe('map_render_failed', { level_reached: 4, name: error.name });

    this.props.onFailure?.(4);
  }

  render(): React.ReactNode {
    if (this.state.hasFailed) return this.props.fallback;
    return this.props.children;
  }
}
