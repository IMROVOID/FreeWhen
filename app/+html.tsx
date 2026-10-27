// Learn more https://docs.expo.dev/router/reference/static-rendering/#root-html

import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

import { resolveLanguage } from '@/src/app-bootstrap';
import { resources } from '@/src/i18n';
import { palette, themes } from '@/src/theme/tokens';

/**
 * This file is web-only and configures the root HTML for every web page
 * during static rendering. The contents run in Node.js and have no access to
 * the DOM.
 *
 * The direction and language are put in the MARKUP, before first paint. A
 * runtime `applyDirection()` alone would produce a document that paints LTR
 * and then flips — visible on a slow connection, and exactly the bug PRD-10
 * D11 exists to prevent (PRD-18 AC-18.7.1).
 *
 * ★ THE DOCUMENT ITSELF NEEDS A BACKGROUND.
 *
 * `ScrollViewStyleReset` ships `#root,body,html{height:100%}` and no colour, so
 * the canvas stayed browser-white. The app paints `t.bg` on its content
 * container, which covers the viewport only while content fills it — leaving
 * white bands on a short screen (the event list) and behind every overscroll.
 *
 * The media query means the pre-hydration canvas already matches the user's OS
 * preference, which is the same rule `useTheme` applies once React is running.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  const language = resolveLanguage();
  const dir = language === 'fa' ? 'rtl' : 'ltr';

  /**
   * ★ THE DOCUMENT NEEDS A TITLE.
   *
   * `expo-router`'s static export writes none unless the document asks for one,
   * so every route shipped with an empty `<title>`: the browser tab showed the
   * URL, a bookmark had no name, and the back button listed paths. Resolved
   * from the catalogue rather than hardcoded, because the product ships in two
   * languages and a literal would be wrong in one of them.
   */
  const { documentTitle, documentDescription } = resources[language].translation.web;

  return (
    <html lang={language} dir={dir} {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>{documentTitle}</title>
        <meta name="description" content={documentDescription} />

        {/* Expo emits a favicon and manifest from `app.json`. These add the
            surfaces it does not generate: a scalable icon, the multi-size ICO
            older browsers and Windows shortcuts pick up, and the Android
            browser/PWA chrome colours. */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta name="theme-color" content={palette.espresso} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FreeWhen" />

        {/* ★ THE CANVAS COLOUR AND THE FOCUS RING.
            Dark is the default because `useTheme` treats an unknown scheme as
            dark; the light block only overrides it. `color-scheme` is set with
            it so form controls and scrollbars follow the same choice instead of
            rendering a white input on a dark page.

            ★ THE FOCUS RULE IS AN ACCESSIBILITY REQUIREMENT, NOT POLISH.
            Every control suppresses the browser's default outline (it drew a
            second ring around buttons that already paint their own surface),
            which left keyboard users with NO visible focus indicator at all —
            a WCAG 2.4.7 failure. `:focus-visible` restores one for keyboard
            navigation only, so a mouse click stays clean while Tab is always
            visible. It is declared here because react-native-web's style
            resolver has no pseudo-class support, so no component can express it. */}
        <style
          id="freewhen-canvas"
          dangerouslySetInnerHTML={{
            __html: [
              `html,body{background-color:${themes.dark.bg};color-scheme:dark}`,
              `@media (prefers-color-scheme: light){html,body{background-color:${themes.light.bg};color-scheme:light}}`,
              `:focus-visible{outline:2px solid ${palette.volt};outline-offset:2px}`,
              // ★ BUTTONS AND FIELDS KEEP THEIR OWN FOCUS TREATMENT.
              //
              // A button paints its own surface and a field paints its own
              // border; the generic ring above drew a second, square box
              // around both — the hard rectangle seen on the chat composer.
              // Keyboard users still get a visible indicator from the
              // component's own focused styling.
              `button:focus-visible,input:focus-visible,textarea:focus-visible{outline:none}`,
            ].join(''),
          }}
        />

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
