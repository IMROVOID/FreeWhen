/**
 * The render helper for UI tests (Plan 08, TEST_STRUCTURE).
 *
 * ★ THE RUNNER CANNOT IMPORT `react-native`.
 *
 * `npm run test` executes `node --import tsx --test`, and `react-native`'s
 * entry point is Flow-typed (`Unexpected "typeof"` under esbuild). So a
 * native component tree cannot be mounted in-process at all.
 *
 * ★ BUT `react-native-web` RENDERS TO REAL MARKUP.
 *
 * `react-dom/server.renderToStaticMarkup` over `react-native-web` produces
 * actual HTML text, which is what the acceptance criteria are about: does the
 * row say «۱۸ دقیقه», does the excluded section name the person, does a map
 * failure still leave the list. Asserting on rendered text — rather than on a
 * component tree — is also the stronger test, because it cannot pass on a
 * component that renders the wrong words.
 *
 * `tests/ui/support/register` must be imported before this module reaches any
 * component; the tests import it first and load this one dynamically.
 */

import { createElement, type ComponentType, type ReactNode } from 'react';

/**
 * `react-dom/server`, typed locally.
 *
 * `@types/react-dom` is not a devDependency of this project, and adding one
 * for a test helper would be a dependency the app does not need. The single
 * signature this helper uses is declared here instead.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (element: ReactNode) => string;
};

export interface RenderedScreen {
  /** The markup, for debugging a failure. */
  html: string;
  /** The visible text with tags stripped and entities decoded. */
  text: string;
  has(needle: string): boolean;
  matches(pattern: RegExp): boolean;
}

/**
 * Renders a component with props.
 *
 * Taking the component and its props — rather than a pre-built element —
 * keeps call sites readable and makes `createElement` the helper's business
 * rather than the caller's. Rendering a component by CALLING it would leave
 * React's hook dispatcher null and every `useTranslation` would throw.
 */
export function renderComponent<P extends object>(
  component: ComponentType<P>,
  props: P,
): RenderedScreen {
  return renderMarkup(createElement(component, props));
}

/** Renders an arbitrary element, for boundary/hierarchy cases. */
export function renderMarkup(element: ReactNode): RenderedScreen {
  const html = renderToStaticMarkup(element as never);
  const text = toText(html);

  return {
    html,
    text,
    has: (needle) => text.includes(needle),
    matches: (pattern) => pattern.test(text),
  };
}

/**
 * A component that throws when rendered — the map-failure stand-in.
 *
 * Used to prove AC-4.2.1: a thrown map must leave the list fully functional.
 */
export function ThrowingComponent(_props: { message?: string }): never {
  throw new Error('map init failed');
}

/** Strips tags and decodes the entities `renderToStaticMarkup` emits. */
function toText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { createElement };
