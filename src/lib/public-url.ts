/**
 * Making a public link name the host the reader is actually on.
 *
 * ★ THE BUG THIS EXISTS FOR.
 *
 * `publicBaseUrl` in `server/lib/http.ts` builds invite links from
 * `PUBLIC_BASE_URL` when it is set, and otherwise from `new URL(request.url)
 * .origin`. On a serverless host that origin is the DEPLOYMENT's own host —
 * `freewhen-orpin.vercel.app` — because the function is invoked on the
 * deployment domain and the custom domain is only a rewrite in front of it. So a
 * person who arrived on `freewhen.rovoid.tech`, created an event, and pressed
 * Share was handed a `*.vercel.app` link, and so was everyone they sent it to.
 *
 * This is the same asymmetry `resolveBaseUrlFrom` already fixes for API calls
 * (`src/lib/api-base-url.ts`): the page's own origin wins, at runtime, with no
 * rebuild. It could not be fixed the same way — by passing the header through —
 * because the link is rendered into `invite_url` on the server and consumed by
 * native clients, where there is no page origin to consult.
 *
 * ★ ONLY THE ORIGIN MOVES.
 *
 * The path, query and hash are the invitation itself. Rebuilding the URL from
 * parts would drop a query the day one is added, so the original string's path is
 * appended verbatim.
 *
 * ★ EVERY OTHER CASE KEEPS THE SERVER VALUE.
 *
 * A missing link, a non-absolute URL, or a page origin that is not `http(s)` (a
 * `file://` bundle, a `null` origin in an opaque context) all return the input
 * untouched. Showing the platform host is worse than showing the custom domain
 * and better than showing nothing, and this runs on every render, so it has to be
 * total.
 */

export function republishOnOrigin<T extends string | null | undefined>(
  url: T,
  origin: string | null | undefined,
): T | string {
  if (!url || !origin) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  let page: URL;
  try {
    page = new URL(origin);
  } catch {
    return url;
  }

  // A page served from `file://` or an opaque origin has no host to publish on.
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return url;
  if (!page.host) return url;

  // Already on the reader's origin — return the original string rather than a
  // re-serialised one, so a clean link stays byte-identical.
  if (parsed.origin === page.origin) return url;

  return `${page.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
