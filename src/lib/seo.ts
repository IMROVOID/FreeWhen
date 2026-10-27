/**
 * The document metadata every statically rendered page carries.
 *
 * ★ THIS IS DATA, NOT JSX, AND NOT A COMPONENT.
 *
 * `app/+html.tsx` runs in Node during `expo export`, before React hydrates and
 * with no DOM. A `<Head>` component or a client-side effect would put these tags
 * in the browser after the response arrived — and the crawlers and chat apps
 * that read them never run the JavaScript. Everything here is resolved at export
 * time so the tags are in the served HTML.
 *
 * ★ ABSOLUTE URLs, BECAUSE THAT IS WHAT THE CONSUMERS REQUIRE.
 *
 * Open Graph and Twitter Cards reject a relative `og:image`: a chat app
 * unfurling a link resolves the path against nothing and shows no preview.
 * `og:url` and `canonical` have the same requirement. The origin therefore comes
 * from `EXPO_PUBLIC_APP_BASE_URL`, with `/` as the last resort — a local export
 * with no `.env` still produces a valid document, just one whose URLs point at
 * the export's own root.
 */

import type { Language } from '@/src/i18n/types';

/** The image Open Graph and Twitter Cards share. Served from the export root. */
export const OG_IMAGE_PATH = '/banner.webp';

/**
 * The image's pixel size, declared so the unfurl reserves the right box.
 *
 * Must match `assets/images/banner.webp`. A wrong pair makes some clients
 * letterbox or drop the image, so this is a fact about the file, not a
 * preference.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** The image's MIME type, declared because `.webp` is not guessed by every client. */
export const OG_IMAGE_TYPE = 'image/webp';

/**
 * The public origin, with no trailing slash.
 *
 * Inlined at export time (`EXPO_PUBLIC_*` is substituted by the bundler), which
 * is the same variable `resolveBaseUrlFrom` falls back to on native. Empty on a
 * developer machine is a supported state — see the module comment.
 */
export function siteOrigin(env: { EXPO_PUBLIC_APP_BASE_URL?: string }): string {
  const configured = (env.EXPO_PUBLIC_APP_BASE_URL ?? '').trim();
  if (!configured) return '';
  return configured.replace(/\/$/, '');
}

/** Joins an origin and a path into the absolute URL the meta tags need. */
export function absoluteUrl(origin: string, path = '/'): string {
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** The `web` catalogue entry these tags are built from. */
export interface WebStrings {
  documentTitle: string;
  documentDescription: string;
  siteName: string;
  tagline: string;
  keywords: string;
  ogImageAlt: string;
  audience: string;
  category: string;
}

/**
 * The schema.org entity describing the app.
 *
 * ★ `SoftwareApplication` RATHER THAN `WebSite`.
 *
 * The product is an app that also runs in a browser, not a content site — so the
 * entity a search engine should associate with this origin is the application,
 * with its platforms and its subject matter. `inLanguage` and `isAccessibleForFree`
 * carry two facts a crawler cannot otherwise infer from a client-rendered page.
 */
export function softwareApplicationSchema(
  web: WebStrings,
  origin: string,
  language: Language,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: web.siteName,
    alternateName: 'FreeWhen',
    description: web.documentDescription,
    applicationCategory: 'LifestyleApplication',
    applicationSubCategory: web.category,
    operatingSystem: 'Android, iOS, Web',
    url: absoluteUrl(origin, '/'),
    image: absoluteUrl(origin, OG_IMAGE_PATH),
    inLanguage: language,
    isAccessibleForFree: true,
    audience: { '@type': 'Audience', audienceType: web.audience },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'IRR' },
  };
}
