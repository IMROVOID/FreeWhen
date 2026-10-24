// Learn more https://docs.expo.dev/router/reference/static-rendering/#root-html

import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

import { resolveLanguage } from '@/src/app-bootstrap';
import { palette } from '@/src/theme/tokens';

/**
 * This file is web-only and configures the root HTML for every web page
 * during static rendering. The contents run in Node.js and have no access to
 * the DOM.
 *
 * The direction and language are put in the MARKUP, before first paint. A
 * runtime `applyDirection()` alone would produce a document that paints LTR
 * and then flips — visible on a slow connection, and exactly the bug PRD-10
 * D11 exists to prevent (PRD-18 AC-18.7.1).
 */
export default function Root({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  const language = resolveLanguage();
  const dir = language === 'fa' ? 'rtl' : 'ltr';

  return (
    <html lang={language} dir={dir} {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Expo emits a favicon and manifest from `app.json`. These add the
            surfaces it does not generate: a scalable icon, the multi-size ICO
            older browsers and Windows shortcuts pick up, and the Android
            browser/PWA chrome colours. */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta name="theme-color" content={palette.espresso} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FreeWhen" />

        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
