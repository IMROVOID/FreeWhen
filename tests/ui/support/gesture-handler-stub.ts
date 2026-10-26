/**
 * A minimal `react-native-gesture-handler` stand-in for the UI test environment.
 *
 * ★ THE REAL MODULE CANNOT LOAD IN NODE.
 *
 * It reaches for `NativeRNGestureHandlerModule` through
 * `NativeModules.getEnforcing`, which does not exist outside a native host, so
 * importing it throws before a single component renders.
 *
 * ★ GESTURES ARE NOT WHAT THESE TESTS ASSERT.
 *
 * The suites assert rendered markup — position, copy, semantics. A gesture
 * builder therefore returns an inert object and `GestureDetector` renders its
 * child unchanged, which keeps the tree real without simulating a pan.
 *
 * A missing export fails loudly on purpose: if a component starts using a new
 * gesture API, this stub should stop satisfying it rather than returning
 * `undefined` and hiding the problem inside a rendered tree.
 */

import { View, type ViewProps } from 'react-native';

/** A chainable, inert gesture description. */
interface InertGesture {
  onUpdate: () => InertGesture;
  onEnd: () => InertGesture;
  onBegin: () => InertGesture;
  onStart: () => InertGesture;
  onFinalize: () => InertGesture;
  enabled: () => InertGesture;
  runOnJS: () => InertGesture;
}

function inertGesture(): InertGesture {
  const self: InertGesture = {
    onUpdate: () => self,
    onEnd: () => self,
    onBegin: () => self,
    onStart: () => self,
    onFinalize: () => self,
    enabled: () => self,
    runOnJS: () => self,
  };
  return self;
}

export const Gesture = {
  Pan: inertGesture,
  Tap: inertGesture,
  LongPress: inertGesture,
  Fling: inertGesture,
  Pinch: inertGesture,
  Rotation: inertGesture,
  Simultaneous: (..._gestures: InertGesture[]) => inertGesture(),
  Race: (..._gestures: InertGesture[]) => inertGesture(),
  Exclusive: (..._gestures: InertGesture[]) => inertGesture(),
};

/** Renders its child untouched — there is no gesture to attach. */
export function GestureDetector({
  children,
}: {
  children: React.ReactNode;
  gesture?: unknown;
}): React.ReactNode {
  return children;
}

export function GestureHandlerRootView({ children, ...rest }: ViewProps) {
  return View({ ...rest, children });
}

/** A no-op, matching the real handler's JS-side registration. */
export function enableExperimentalWebImplementation(): void {}

export function runOnJS<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}

export const Directions = { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 };
export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
};
