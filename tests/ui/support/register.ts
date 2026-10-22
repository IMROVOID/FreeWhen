/**
 * Activates the test environment for the UI suite.
 *
 * Three things have to be true before a component renders under
 * `react-dom/server` + `react-native-web` in plain Node:
 *
 *  1. **`react-native` must resolve to `react-native-web`.** The native entry
 *     point is Flow-typed and esbuild cannot parse it.
 *  2. **`react-native-reanimated` must be stubbed.** Its real module needs a
 *     Babel plugin and a UI thread; `useAnimatedStyle` throws without them.
 *     Animation is not what these tests are about — the rendered copy is.
 *  3. **`requestAnimationFrame` must exist.** `react-native-web` and some
 *     primitives schedule work on the next frame, and Node has no opinion.
 *
 * ★ WHY THE ALIAS IS A CJS RESOLUTION HOOK AND NOT `module.register()`.
 *
 * `register()` installs an ESM resolver, but `tsx` answers every import
 * through its own esbuild loader first — so an ESM hook never sees the
 * specifier, and `react-native`'s Flow-typed entry point still reaches
 * esbuild and fails to parse (`Unexpected "typeof"`).
 *
 * Patching `Module._resolveFilename` sits underneath the loader instead: every
 * module resolution — including tsx's — passes through it.
 *
 * Imported for its side effect, before any component under test:
 *
 *   import './support/register';
 *   const { renderComponent } = await import('./support/render');
 *
 * The render helper is imported dynamically on purpose: a static import would
 * be hoisted above this registration and its module graph would be evaluated
 * before the alias exists.
 */

import Module from 'node:module';
import { sep } from 'node:path';

/** This directory, so the stub resolves by absolute path. */
const HERE = import.meta.dirname;

/** Specifiers redirected to a different implementation. */
const ALIASES: Record<string, string> = {
  'react-native': 'react-native-web',
  // Reanimated needs a Babel plugin and a UI thread; the stub keeps the tree
  // intact and makes every animated style static.
  'react-native-reanimated': JOIN_SUPPORT('reanimated-stub.ts'),
};

/** An absolute path to a file in this directory, for the resolver. */
function JOIN_SUPPORT(file: string): string {
  return `${HERE}${sep}${file}`;
}

type ResolveFilename = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

interface ModuleWithResolver {
  _resolveFilename: ResolveFilename;
}

const module_ = Module as unknown as ModuleWithResolver;
const original = module_._resolveFilename;

module_._resolveFilename = function patched(
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
  options?: unknown,
): string {
  const target = ALIASES[request];
  if (target) {
    try {
      return original.call(this, target, parent, isMain, options);
    } catch {
      // Fall through to the original specifier so an unexpected internal path
      // surfaces as a normal resolution error rather than a silent skip.
    }
  }
  return original.call(this, request, parent, isMain, options);
};

// ── The frame-loop stubs ─────────────────────────────────────────────────

const globalScope = globalThis as unknown as Record<string, unknown>;

if (typeof globalScope.requestAnimationFrame !== 'function') {
  globalScope.requestAnimationFrame = (callback: (time: number) => void): number =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (typeof globalScope.cancelAnimationFrame !== 'function') {
  globalScope.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
}

export {};
