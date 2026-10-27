/**
 * Writes `robots.txt` and `sitemap.xml` into the exported bundle.
 *
 * ★ IT RUNS AFTER THE EXPORT, BECAUSE THE EXPORT DOES NOT EMIT THEM.
 *
 * `expo export` emits HTML, JS, assets and whatever `public/` holds — nothing
 * generates a sitemap, and a `robots.txt` in `public/` could not name an
 * absolute `Sitemap:` URL without hardcoding an origin in the repository.
 *
 * ★ THE ORIGIN COMES FROM THE SAME VARIABLE THE PAGES USE.
 *
 * `EXPO_PUBLIC_APP_BASE_URL` is what `app/+html.tsx` builds `canonical` and
 * `og:url` from, so the sitemap and the canonical tags cannot disagree. With the
 * variable unset — a local export — the sitemap is SKIPPED rather than written
 * with `localhost` entries: a sitemap naming an origin nobody can reach is worse
 * than no sitemap, because a crawler that finds it reports every URL as an error.
 *
 * Usage: `npm run gen:seo` (called by `scripts/build/export-web.sh`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../db/paths';

/** The bundle the files are written into. */
const DIST_DIR = join(PROJECT_ROOT, 'dist');

/**
 * The routes worth indexing.
 *
 * `/e/<token>` and `/event/<id>` are per-event and deliberately absent: an event
 * is visible only to its participants, and listing those paths would advertise
 * the shape of a private resource. The hand-written `/dl/` and `/privacy` pages
 * live on the static root, not in `dist/`, so their own servers index them.
 */
const PUBLIC_ROUTES = ['/', '/start'] as const;

function origin(): string {
  return (process.env.EXPO_PUBLIC_APP_BASE_URL ?? '').trim().replace(/\/$/, '');
}

function robots(base: string): string {
  return [
    '# Every path the app export serves is meant to be indexed.',
    'User-agent: *',
    'Allow: /',
    '',
    '# Per-event paths are readable only by the people invited to them.',
    'Disallow: /e/',
    'Disallow: /event/',
    'Disallow: /new/',
    'Disallow: /settings/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemap(base: string, lastmod: string): string {
  const urls = PUBLIC_ROUTES.map(
    (route) => `  <url>\n    <loc>${base}${route}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
  ).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

const base = origin();

if (!base) {
  console.log(
    'gen:seo — EXPO_PUBLIC_APP_BASE_URL is unset, so no sitemap was written.\n' +
      '         The pages are otherwise complete; only the sitemap needs an origin.',
  );
  process.exit(0);
}

// `lastmod` is the day of this build, not the day the source last changed: a
// sitemap is a statement about the artifact, and a redeploy is a new artifact.
const lastmod = new Date().toISOString().slice(0, 10);

mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(join(DIST_DIR, 'robots.txt'), robots(base), 'utf8');
writeFileSync(join(DIST_DIR, 'sitemap.xml'), sitemap(base, lastmod), 'utf8');

console.log(`gen:seo — robots.txt and sitemap.xml written for ${base}`);
