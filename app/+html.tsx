// Learn more https://docs.expo.dev/router/reference/static-rendering/#root-html

import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

import { resolveLanguage } from '@/src/app-bootstrap';
import { FRAME_MAX_WIDTH, TABLET_BREAKPOINT } from '@/src/components/ui/AppFrame';
import { resources } from '@/src/i18n';
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_TYPE,
  OG_IMAGE_WIDTH,
  absoluteUrl,
  siteOrigin,
  softwareApplicationSchema,
} from '@/src/lib/seo';
import { border, palette, themes } from '@/src/theme/tokens';
import { vazirmatnFdFonts, vazirmatnFonts } from '@/src/theme/font-assets';
import { fontFaceCss } from '@/src/theme/web-font-face';

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
   *
   * The whole `web` block is read once here, because the share and structured
   * data tags below are built from the same entry — a second destructure of the
   * same node would be two sources for one page's metadata.
   */
  const web = resources[language].translation.web;
  const { documentTitle, documentDescription } = web;

  /**
   * ★ THE SHARE PREVIEW AND THE CANONICAL URL.
   *
   * Both need an absolute origin — a crawler and a chat client resolve a
   * relative `og:image` against nothing and show no card — so the origin is
   * read once here and every absolute URL below is derived from it.
   *
   * `og:locale` carries the UNDERSCORE form (`fa_IR`, not `fa-IR`); the
   * hyphenated form is silently ignored by most consumers. `og:locale:alternate`
   * names the other shipped locale, so a share in either language offers both
   * and the crawler does not have to guess that the product is bilingual.
   */
  const origin = siteOrigin(process.env);
  const canonicalUrl = absoluteUrl(origin, '/');
  const ogImageUrl = absoluteUrl(origin, OG_IMAGE_PATH);
  const ogLocale = language === 'fa' ? 'fa_IR' : 'en_US';
  const ogLocaleAlternate = language === 'fa' ? 'en_US' : 'fa_IR';

  /**
   * ★ THE STRUCTURED DATA IS A SCRIPT, AND IT IS JSON.
   *
   * `</script>` inside a string would close the tag early, so the serialised
   * JSON has every `<` escaped. The catalogue is ours and contains no such
   * sequence today, but this tag is the one place where a later copy edit could
   * break the page — escaping costs nothing and removes the class of bug.
   */
  const schema = JSON.stringify(softwareApplicationSchema(web, origin, language)).replace(
    /</g,
    '\\u003c',
  );

  /**
   * ★ THE FACES ARE DECLARED HERE BECAUSE `expo-font` DECLARES THEM TOO LATE.
   *
   * On web, `useFonts` appends `<style id="expo-generated-fonts">` after `</body>`.
   * Static export prerenders the app's markup, so a `TextInput` — a real `<input>`
   * on web — that names a family resolved before that block existed, and the
   * browser kept the fallback. Text boxes in particular lost their font.
   *
   * Declaring them in `<head>` puts the families in place before first paint and
   * ahead of the prerendered document. `useFonts` still runs, and a duplicate
   * `@font-face` for one family and file is harmless, so nothing changes natively.
   */
  const fontFaces = fontFaceCss({ vazirmatn: vazirmatnFonts, vazirmatnFd: vazirmatnFdFonts });

  const dark = themes.dark;
  const light = themes.light;

  /**
   * ★ THE COLUMN'S CLAMP IS `AppFrame`'s, READ RATHER THAN REPEATED.
   *
   * The gate:design rule that bans a literal in a style object cannot see inside a
   * CSS string, so both numbers are hoisted into named bindings and every use
   * below is an interpolation — the same discipline in a place the gate cannot
   * check.
   */
  const frameMaxWidth = FRAME_MAX_WIDTH;
  const tabletBreakpoint = TABLET_BREAKPOINT;
  const scrollbarWidth = palette.scrollbarWidth;

  /**
   * ★ THE CANVAS, THE FOCUS RING AND THE SCROLLBAR — AS ONE STRING.
   *
   * A prerendered document has to HYDRATE. Two adjacent `<style>` children
   * separated by whitespace text are emitted as `(a, b)`, and React's hydration
   * inserts `<!-- -->` between such children — which does not match the server's
   * markup, so React throws the server tree away and client-renders the app from
   * nothing. That is the full-width frame the page shows for a second before the
   * clamp appears. One string per `<style>` is the form that hydrates cleanly.
   *
   * ★ THE FRAME'S WIDTH IS DECLARED HERE AS WELL AS IN `AppFrame`.
   *
   * `AppFrame` is React, and React is not mounted until the fonts resolve, so
   * between first paint and the first frame the document held the PRERENDERED
   * markup — which has no frame. `#root` carries the same cap in CSS, so the
   * page is never wider than the app's column, not even for one frame. The
   * numbers are imported from `AppFrame`, not copied, so the two cannot drift.
   */
  const canvasCss = [
    `html,body{background-color:${dark.bg};color-scheme:dark}`,
    `@media (prefers-color-scheme: light){html,body{background-color:${light.bg};color-scheme:light}}`,

    // ★ THE DESKTOP CLAMP, BEFORE REACT EXISTS.
    //
    // `#root` is the app's mount point. Below the tablet breakpoint the window IS
    // the app, so nothing is declared; at or above it the root is the same
    // phone-width column the frame draws, centred, so the prerendered document —
    // and every frame until React takes over — is already the right shape.
    `@media (min-width:${tabletBreakpoint}px){#root{max-inline-size:${frameMaxWidth}px;margin-left:auto;margin-right:auto}}`,

    // ★ THE FOCUS RULE IS AN ACCESSIBILITY REQUIREMENT, NOT POLISH.
    //
    // Every control suppresses the browser's default outline (it drew a second
    // ring around buttons that already paint their own surface), which left
    // keyboard users with NO visible focus indicator at all — a WCAG 2.4.7
    // failure. `:focus-visible` restores one for keyboard navigation only, so a
    // mouse click stays clean while Tab is always visible. It is declared here
    // because react-native-web's style resolver has no pseudo-class support, so
    // no component can express it.
    `:focus-visible{outline:${border.ring}px solid ${palette.volt};outline-offset:${border.strong}px}`,
    // ★ BUTTONS AND FIELDS KEEP THEIR OWN FOCUS TREATMENT.
    //
    // A button paints its own surface and a field paints its own border; the
    // generic ring above drew a second, square box around both — the hard
    // rectangle seen on the chat composer. Keyboard users still get a visible
    // indicator from the component's own focused styling.
    `button:focus-visible,input:focus-visible,textarea:focus-visible{outline:none}`,

    // ★ THE SCROLLBAR IS PART OF THE DESIGN SYSTEM, NOT THE OS DEFAULT.
    //
    // A default 15px grey trough with step arrows was the last unstyled surface
    // on a page made entirely of theme tokens. It is drawn thin, in the same
    // warm neutral the cards use, with a rounded thumb and a transparent corner.
    //
    // Both mechanisms are declared because no single one is universal: the
    // standard `scrollbar-*` properties cover Firefox and Chromium 121+, the
    // WebKit pseudo-elements cover Safari and older Chromium. They cannot both
    // apply — a browser that supports `scrollbar-width` ignores the legacy
    // pseudo-elements by spec — but the `@supports not` guard makes that
    // explicit rather than left to the engine's own precedence rules.
    `*{scrollbar-width:thin;scrollbar-color:${dark.surface3} transparent}`,
    `@media (prefers-color-scheme: light){*{scrollbar-color:${light.surface3} transparent}}`,
    `@supports not (scrollbar-width: thin){`,
    `::-webkit-scrollbar{width:${scrollbarWidth}px;height:${scrollbarWidth}px}`,
    `::-webkit-scrollbar-track{background:transparent}`,
    `::-webkit-scrollbar-thumb{background-color:${dark.surface3};border-radius:${palette.scrollbarRadius}px}`,
    `::-webkit-scrollbar-thumb:hover{background-color:${dark.line}}`,
    `::-webkit-scrollbar-corner{background:transparent}`,
    `@media (prefers-color-scheme: light){`,
    `::-webkit-scrollbar-thumb{background-color:${light.surface3}}`,
    `::-webkit-scrollbar-thumb:hover{background-color:${light.line}}`,
    `}`,
    `}`,
  ].join('');

  return (
    <html lang={language} dir={dir} {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>{documentTitle}</title>
        <meta name="description" content={documentDescription} />
        <meta name="keywords" content={web.keywords} />
        <meta name="author" content={web.siteName} />
        <link rel="canonical" href={canonicalUrl} />

        {/* ★ THE LANGUAGE LINKS ARE HREFLANG, NOT DECORATION.
            The app ships in Persian and English, and the served document is one
            or the other depending on the build's locale. Without these a search
            engine treats the two as duplicate content; with them it can serve
            the right one. `x-default` names the fallback for every other
            language, which is Persian — the default locale. */}
        <link rel="alternate" hrefLang="fa" href={absoluteUrl(origin, '/?lang=fa')} />
        <link rel="alternate" hrefLang="en" href={absoluteUrl(origin, '/?lang=en')} />
        <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />

        {/* ★ OPEN GRAPH — how the link looks in a chat, a post or a message.
            `og:type` and `og:url` are required for an unfurl to be attempted at
            all, and `og:image` needs the width/height pair below or some clients
            render an empty box while the image downloads. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={web.siteName} />
        <meta property="og:title" content={documentTitle} />
        <meta property="og:description" content={documentDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:type" content={OG_IMAGE_TYPE} />
        <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
        <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
        <meta property="og:image:alt" content={web.ogImageAlt} />
        <meta property="og:locale" content={ogLocale} />
        <meta property="og:locale:alternate" content={ogLocaleAlternate} />

        {/* The large-image card. `summary` would shrink the banner to a
            thumbnail, which defeats the point of shipping a 1200×630 one. */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={documentTitle} />
        <meta name="twitter:description" content={documentDescription} />
        <meta name="twitter:image" content={ogImageUrl} />
        <meta name="twitter:image:alt" content={web.ogImageAlt} />

        {/* ★ THE APP LINKS ARE WHAT MAKES A SHARE BECOME AN INSTALL.
            A person who opens the link on a phone is offered the app if they
            have it; the web page remains the landing surface otherwise, so no
            `app-store` fallback is declared (there is no App Store listing —
            see `/start`, which ships an APK link instead). */}
        <meta property="al:android:package" content="ir.freewhen.app" />
        <meta property="al:ios:bundle_id" content="ir.freewhen.app" />
        <meta property="al:web:url" content={canonicalUrl} />

        {/* ★ THE ROBOTS DIRECTIVE IS EXPLICIT, NOT DEFAULTED.
            Everything the export serves is meant to be indexed — including
            `/start`, which is the reviewer entry point — so the tag says so
            rather than leaving the crawler to guess from the absence of one. */}
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: schema }}
        />

        {/* ★ THE FONT FACES, BEFORE ANY MARKUP THAT NAMES THEM. */}
        <style id="freewhen-fonts" dangerouslySetInnerHTML={{ __html: fontFaces }} />

        {/* Expo emits a favicon and manifest from `app.json`. These add the
            surfaces it does not generate: a scalable icon, the multi-size ICO
            older browsers and Windows shortcuts pick up, and the Android
            browser/PWA chrome colours. */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content={palette.espresso} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FreeWhen" />

        {/* ★ THE CANVAS COLOUR, THE FOCUS RING, THE DESKTOP CLAMP AND THE
            SCROLLBAR. Built above as ONE string, because a prerendered document
            that hydrates cannot have two adjacent text children here. */}
        <style id="freewhen-canvas" dangerouslySetInnerHTML={{ __html: canvasCss }} />

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
