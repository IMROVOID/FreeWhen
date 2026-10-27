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

# ★ A `node_modules` SEGMENT IN A PUBLIC URL IS REFUSED BY THE HOST.
#
# Metro writes every dependency asset — all 14 Plus Jakarta Sans faces and 18
# icon PNGs — under `assets/node_modules/…`, mirroring the package layout. Vercel
# will not serve a path containing that segment, whatever `.vercelignore` says:
# the deployment answered `/assets/assets/fonts/Vazirmatn-Bold.<hash>.ttf` with 200
# and `/assets/node_modules/@expo-google-fonts/…/PlusJakartaSans_400Regular.<hash>.ttf`
# with 404 from the SAME tree.
#
# That asymmetry is why it read as a font bug for so long. Vazirmatn lives under
# `assets/assets/fonts/`, so a Persian screen looked correct; only the English
# typefaces 404'd, and a page whose JS and HTML were perfect still fell back to a
# system face.
#
# So the segment is relocated rather than argued with. The files move to
# `assets/vendor/…` and every reference in the served HTML/JS/CSS is rewritten to
# match. The hashes are preserved, so the rewrite is a prefix substitution and the
# filenames the bundle expects still exist.
if [ -d "$OUT/assets/node_modules" ]; then
  mkdir -p "$OUT/assets/vendor"
  cp -R "$OUT/assets/node_modules"/. "$OUT/assets/vendor"/
  rm -rf "$OUT/assets/node_modules"

  # Rewrite the references. `-type f` over the text carriers only: the binaries
  # under `assets/vendor` are not searched, and neither is the APK placeholder.
  find "$OUT" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' \) \
    -exec sed -i 's#/assets/node_modules/#/assets/vendor/#g#' {} +

  moved="$(find "$OUT/assets/vendor" -type f | wc -l | tr -d ' ')"
  echo "  moved   assets/node_modules -> assets/vendor ($moved files)"
fi

# The APK binary is hundreds of megabytes and is not in the repository. A
# placeholder keeps `/dl/` links resolving instead of 404-ing between builds;
# the real file is written by whatever publishes it.
if [ ! -s "$OUT/dl/freewhen.apk" ]; then
  : > "$OUT/dl/freewhen.apk"
  echo "note: $WEB/dl/freewhen.apk is absent or empty — wrote a placeholder"
fi

# ★ DYNAMIC ROUTES GET A BRACKET-FREE ALIAS.
#
# `expo export` writes a dynamic route's template to its literal name —
# `e/[token].html` — because there are no static params to enumerate. Vercel and
# Netlify both REFUSE to rewrite TO a destination containing `[`: `/privacy`
# rewrote correctly while `/e/:token -> /e/[token].html` returned 404, with the
# rewrite present in the deployed `vercel.json` and the target file present in
# the deployment.
#
# So each template is copied to a name a rewrite destination can address, and
# the host rules point at the copy. The originals stay, because the app's own
# router links to `/e/[token]` only in its development form; nothing serves them
# in production and leaving them costs a few kilobytes.
alias_one() {
  local from="$1" to="$2"
  if [ -f "$OUT/$from" ]; then
    mkdir -p "$(dirname "$OUT/$to")"
    cp "$OUT/$from" "$OUT/$to"
    echo "  alias   $from -> $to"
  else
    echo "  MISSING $from (cannot alias to $to)"
    missing=1
  fi
}

missing=0
alias_one 'e/[token].html' 'e/_token.html'
alias_one 'e/[token]/location.html' 'e/_token/location.html'
alias_one 'event/[id]/index.html' 'event/_id/index.html'
alias_one 'event/[id]/venue/[vid].html' 'event/_id/venue/_vid.html'
for tab in activity chat decision map people propose time; do
  alias_one "event/[id]/$tab.html" "event/_id/$tab.html"
done

# ★ A MISSING PAGE IS A FAILURE HERE, NOT AT SMOKE-TEST TIME.
#
# `dist/` cannot contain `/privacy` and `web/` cannot contain `/start`; if the
# merge silently produced neither, the deploy would publish a site that 404s the
# one page a store listing links to.
for required in index.html start.html privacy/index.html dl/index.html e/_token.html; do
  if [ -f "$OUT/$required" ]; then
    echo "  ok      $required"
  else
    echo "  MISSING $required"
    missing=1
  fi
done
[ "$missing" -eq 0 ] || { echo "::error title=Incomplete static root::the composed tree is missing a required page"; exit 1; }

echo "composed $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
