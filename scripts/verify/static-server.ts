/**
 * A static server for a `expo export` bundle, with the host's rewrite rules.
 *
 * ★ `python -m http.server` IS NOT ENOUGH FOR THIS BUILD.
 *
 * The export writes `/start.html`, but the app links to `/start` and the
 * deployed site rewrites the extension away (see `.github/workflows/deploy.yml`).
 * Served naively, every internal link 404s — which looks exactly like a routing
 * bug in the app when it is only the wrong local server.
 *
 * This mirrors the host: a request for a path with no extension falls back to
 * `<path>.html`, then to `<path>/index.html`, and finally to the 404 page. The
 * dynamic-route aliases the deploy maps are NOT reproduced — those need the
 * live dataset.
 *
 *   npx tsx scripts/verify/static-server.ts [dir] [port]
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 8088);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/** The file a request resolves to, or `null`. */
function resolveFile(pathname: string): string | null {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const base = join(root, clean);

  if (!base.startsWith(normalize(root))) return null;
  if (existsSync(base) && statSync(base).isFile()) return base;

  if (extname(base) === '') {
    if (existsSync(`${base}.html`)) return `${base}.html`;
    const index = join(base, 'index.html');
    if (existsSync(index)) return index;
  }

  return null;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const file = resolveFile(pathname);

  if (!file) {
    const fallback = join(root, '404.html');
    response.writeHead(404, { 'content-type': TYPES['.html']! });
    response.end(existsSync(fallback) ? readFileSync(fallback) : 'not found');
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    // The real host serves these with long-lived caching; locally there is no
    // point, and a stale bundle is a confusing failure.
    'cache-control': 'no-store',
  });
  response.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}/`);
});
