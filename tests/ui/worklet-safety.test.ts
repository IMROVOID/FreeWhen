/**
 * No worklet body may call a remote function.
 *
 * ★ THE DEFECT THIS PINS, AND WHY IT IS A CLASS GUARD RATHER THAN ONE TEST.
 *
 * A `useAnimatedStyle` body runs on Reanimated's UI runtime. Values it references
 * are copied into the worklet's closure by value, so a constant or a *pure
 * function* is fine. But a native array method (`map`, `filter`, `reduce`, …)
 * called INSIDE the body must dispatch to a callback, and that callback was
 * defined on the JS runtime — a "remote function". `react-native-worklets` 0.13
 * refuses the call and aborts the process:
 *
 *   com.facebook.jni.CppException: [Worklets] Tried to synchronously call a
 *   Remote Function. Called "anonymous" on the UI Runtime.
 *
 * That is the release-blocking crash: `PullToSync`'s page style built its
 * interpolation stops with `Array.from(...).map(...)` on the UI thread, and
 * `PullToSync` wraps the event home — so opening any event killed the app on
 * Android while the web build (no UI runtime) was unaffected.
 *
 * The same shape is easy to reintroduce and impossible to see in review, so the
 * rule is enforced over the whole source tree rather than at one call site. A new
 * animated style is automatically covered.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'app'];

/** Calls that cannot run on the UI runtime when the callback is a JS closure. */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(/, 'map'],
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*filter\s*\(/, 'filter'],
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*forEach\s*\(/, 'forEach'],
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*reduce\s*\(/, 'reduce'],
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*sort\s*\(/, 'sort'],
  [/(?<![\w.])([A-Za-z_$][\w$]*)\s*\.\s*find(?:Index)?\s*\(/, 'find/findIndex'],
  [/(?<![\w.])Array\s*\.\s*from\s*\(/, 'Array.from'],
  [/(?<![\w.])Object\s*\.\s*(keys|values|entries|assign)\s*\(/, 'Object.*'],
];

/** Map constructors are fine; it is the CALLBACK that is remote. */
const ALLOWED_CALLBACKS = new Set(['Map']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/**
 * The body of every animated-style worklet in a file.
 *
 * ★ THE ARGUMENT IS TAKEN FROM THE HOOK CALL, NOT BY COUNTING EVERY BRACE.
 *
 * A first attempt walked from the hook's `(` and decremented its depth on every
 * `)`, which is wrong twice: a call's arguments end at the matching `)` of the
 * SAME bracket, so a worklet that contains any nested call (`interpolate(…)`)
 * closed the scan early, and a body with no `{` was skipped entirely. The guard
 * then found nothing and passed — the one failure mode a static check must not
 * have. So the scan first isolates the hook's own argument, then checks that the
 * argument is a function and returns its body.
 */
export function workletBodies(source: string): { body: string; line: number }[] {
  const bodies: { body: string; line: number }[] = [];
  const start = /(useAnimatedStyle|useDerivedValue|useAnimatedReaction)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = start.exec(source)) !== null) {
    const argStart = start.lastIndex;
    const argEnd = matchingParen(source, argStart - 1);
    if (argEnd < 0) continue;

    const argument = source.slice(argStart, argEnd);
    // `useAnimatedStyle(() => ({…}))` has no brace of its own; the object literal
    // is the body's value, and every identifier in the argument is in scope.
    const line = source.slice(0, match.index).split('\n').length;
    bodies.push({ body: argument, line });

    start.lastIndex = argStart;
  }

  return bodies;
}

/**
 * The index of the `)` that closes the `(` at `open`, skipping string and
 * template literals so a brace or paren inside one cannot shift the depth.
 */
function matchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const prev = source[i - 1];

    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/** Comments are stripped: prose about `map` is not code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('the extractor finds the animated-style bodies it is meant to police', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root));
  let total = 0;
  for (const file of files) {
    total += workletBodies(stripComments(readFileSync(file, 'utf8'))).length;
  }
  // A scan that silently matched nothing would pass every assertion below, which
  // is the failure mode of every "no forbidden pattern" test.
  assert.ok(total >= 10, `expected the animated-style scan to cover the codebase, found ${total}`);
});

test('no animated-style body calls a callback that lives on the JS runtime', () => {
  const offences: string[] = [];

  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = stripComments(readFileSync(file, 'utf8'));

      for (const { body, line } of workletBodies(source)) {
        for (const [pattern, label] of FORBIDDEN) {
          const found = pattern.exec(body);
          if (!found) continue;
          // `new Map(...)` / `SomeMap.map` are not the offender.
          if (label === 'map' && ALLOWED_CALLBACKS.has(found[1] ?? '')) continue;
          offences.push(`${file}:${line} — ${label} inside a worklet body`);
        }
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    `a worklet body must not call a remote function; hoist the call to module scope:\n${offences.join('\n')}`,
  );
});

test('PullToSync hoists its interpolation stops out of the worklet', () => {
  const source = stripComments(readFileSync('src/components/ui/PullToSync.tsx', 'utf8'));

  // The ranges are module scope: declared above the component, not inside it.
  const componentAt = source.indexOf('export function PullToSync');
  assert.ok(componentAt > 0, 'PullToSync component not found');

  const moduleScope = source.slice(0, componentAt);
  assert.match(moduleScope, /const PULL_INPUT_RANGE\s*:/, 'the input stops must be module scope');
  assert.match(moduleScope, /const PULL_OUTPUT_RANGE\s*:/, 'the output stops must be module scope');

  for (const { body } of workletBodies(source)) {
    assert.doesNotMatch(body, /Array\.from|\.map\(/, 'a worklet body must not build arrays at run time');
  }
});

test('the switch knob reads its direction from a shared value, not a captured boolean', () => {
  const source = stripComments(readFileSync('src/components/ui/AccentSwitch.tsx', 'utf8'));

  for (const { body, line } of workletBodies(source)) {
    // A captured react value multiplied into the transform is the same class of
    // mistake: it is stale for a frame and it is not a worklet closure constant.
    assert.doesNotMatch(
      body,
      /\*\s*travel\b/,
      `AccentSwitch:${line} multiplies a react value into the worklet; use a shared value`,
    );
    // The body may read shared values and module constants only. A bare `rtl`
    // (React state) inside it would be the captured-boolean fault again.
    assert.doesNotMatch(
      body,
      /translateX:\s*rtl\b/,
      `AccentSwitch:${line} reads the React direction inside the worklet`,
    );
  }

  // The direction is folded into the shared value on the JS side, so the worklet
  // body itself carries no sign at all.
  assert.match(source, /knobOffset\s*=\s*useSharedValue/, 'the knob offset must be a shared value');
  assert.match(source, /signedTravel/, 'the direction must be applied when writing the shared value');
});
