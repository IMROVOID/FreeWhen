/**
 * A minimal `react-native-reanimated` stand-in for the UI test environment.
 *
 * ★ ONLY WHAT THE PRODUCT'S SHARED COMPONENTS ACTUALLY USE IS STUBBED.
 *
 * The real module needs a Babel plugin and a UI thread; `useAnimatedStyle`
 * throws without them. Animation is not what these tests are about — the
 * rendered copy is — so the stub keeps the component tree intact and makes
 * every animated style a static object.
 *
 * A missing export is a loud failure on purpose: if a component starts using
 * a new Reanimated API, this stub should stop satisfying it rather than
 * silently returning `undefined` and hiding the problem in a rendered tree.
 */

interface AnimatedStyle {
  [key: string]: unknown;
}

export const Easing = {
  linear: (t: number): number => t,
  ease: (t: number): number => t,
  quad: (t: number): number => t,
  cubic: (t: number): number => t,
  bezier: () => (t: number): number => t,
  in: (fn: (t: number) => number) => fn,
  out: (fn: (t: number) => number) => fn,
  inOut: (fn: (t: number) => number) => fn,
};

/** Animation builders return their target value; nothing is animated. */
const identityValue = (toValue: unknown): unknown => toValue;

export const withSpring = identityValue;
export const withTiming = identityValue;
export const withDelay = (_delay: number, animation: unknown): unknown => animation;
export const withSequence = (...animations: unknown[]): unknown => animations[0];
export const withRepeat = (animation: unknown): unknown => animation;
export const cancelAnimation = (): void => undefined;

/** A shared value is a boxed number, as in the real API. */
export function useSharedValue<T>(initial: T): { value: T } {
  return { value: initial };
}

export function useAnimatedStyle<T extends AnimatedStyle>(factory: () => T): T {
  return factory();
}

export function useDerivedValue<T>(factory: () => T): { value: T } {
  return { value: factory() };
}

export function useAnimatedScrollHandler(): () => void {
  return () => undefined;
}

export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };

export function interpolate(value: number): number {
  return value;
}

/**
 * `Animated.View` and friends: the plain component, so markup is real.
 *
 * The `react-native` import resolves to `react-native-web` through the
 * resolution hook installed in `register.ts`.
 */
import { View, Text, ScrollView, Image } from 'react-native';

export const Animated = {
  View,
  Text,
  ScrollView,
  Image,
  createAnimatedComponent: <P>(component: React.ComponentType<P>): React.ComponentType<P> =>
    component,
};

export default Animated;
