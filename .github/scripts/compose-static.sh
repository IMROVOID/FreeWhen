#!/usr/bin/env bash
# Compose a single static root from `dist/` and `web/`.
#
# ★ THE TWO-ROOT SPLIT IS A CADDY PROPERTY, NOT A UNIVERSAL ONE.
#
# `scripts/deploy/deploy.sh` and the `Caddyfile` keep `dist/` and `web/` apart so
# the app's client-side router cannot shadow `/dl/` and `/privacy`. Caddy does
# that with explicit `handle` blocks.
#
# Vercel, Netlify and Cloudflare Pages serve ONE directory, and their routers
# also let an SPA catch-all swallow a static path. So the split has to be
# reproduced as an explicit rule per host, and the tree itself has to be merged
# first.
#
# ★ `web/` IS COPIED LAST.
#
# A same-named file in `dist/` must not overwrite a hand-written page that has
# to load before any JavaScript is agreed to.
set -euo pipefail

DIST="${DIST_DIR:-dist}"
WEB="${WEB_DIR:-web}"
OUT="${STATIC_DIR:-static}"

[ -d "$DIST" ] || { echo "::error::$DIST is missing — run the web export first"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

# `cp -R src/. dst` copies contents, not the directory itself, and works the
# same on GNU and BSD.
cp -R "$DIST"/. "$OUT"/
cp -R "$WEB"/. "$OUT"/

# The APK binary is hundreds of megabytes and is not in the repository. A
# placeholder keeps `/dl/` links resolving instead of 404-ing between builds;
# the real file is written by whatever publishes it.
if [ ! -s "$OUT/dl/freewhen.apk" ]; then
  : > "$OUT/dl/freewhen.apk"
  echo "note: $WEB/dl/freewhen.apk is absent or empty — wrote a placeholder"
fi

# ★ A MISSING PAGE IS A FAILURE HERE, NOT AT SMOKE-TEST TIME.
#
# `dist/` cannot contain `/privacy` and `web/` cannot contain `/start`; if the
# merge silently produced neither, the deploy would publish a site that 404s the
# one page a store listing links to.
missing=0
for required in index.html start.html privacy/index.html dl/index.html; do
  if [ -f "$OUT/$required" ]; then
    echo "  ok      $required"
  else
    echo "  MISSING $required"
    missing=1
  fi
done
[ "$missing" -eq 0 ] || { echo "::error title=Incomplete static root::the composed tree is missing a required page"; exit 1; }

echo "composed $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
