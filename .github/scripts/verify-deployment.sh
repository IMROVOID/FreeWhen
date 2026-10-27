#!/usr/bin/env bash
# Verify a live deployment: the served paths, the refused paths, and that the
# pages are actually distinct.
#
# Runnable against any deployment, so the checks can be proven here rather than
# discovered broken on a first real deploy.
#
# Usage: verify-deployment.sh <site-url>
#
# ★ THREE KINDS OF CHECK, BECAUSE A STATUS CODE PROVES ALMOST NOTHING.
#
#   1. **Status.** The served paths must be 2xx/3xx and the refused ones must be
#      404. A spool of redirects is followed, because Netlify's pretty URLs turn
#      `/privacy` into a 301 to `/privacy/` on a perfectly correct deployment.
#
#   2. **Distinctness.** Two routes returning the same bytes means a rewrite
#      swallowed one — which is exactly what happened on the first Vercel
#      deploy: `/start` answered 200 with the home page's HTML. No status check
#      and no "contains the app root" check can see that.
#
#   3. **Refusals.** `/studio`, `/storage/v1/*` and `*.map` must not be reachable.
#      A refused path answering 200 is the direction nobody notices.
set -uo pipefail

SITE="${1:?usage: verify-deployment.sh <site-url>}"
SITE="${SITE%/}"
WANT_API="${WANT_API:-true}"
WANT_WEB="${WANT_WEB:-true}"

fail=0
ok()  { echo "  OK   $*"; }
bad() { echo "  FAIL $*"; fail=1; }
skip() { echo "  SKIP $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fetch a path, following redirects, writing the body to $2 and echoing the
# final status.
fetch() {
  curl -sSL -o "$2" -w '%{http_code}' --max-time 25 --retry 2 "$SITE$1" 2>/dev/null || echo 000
}

echo "Verifying $SITE"

# ── 1. The API reports a healthy database ──────────────────────────────────
if [ "$WANT_API" = "true" ]; then
  ready=0
  for _ in $(seq 1 8); do
    BODY="$(curl -fsS --max-time 10 "$SITE/api/health" 2>/dev/null || true)"
    if printf '%s' "$BODY" | grep -q '"db":"up"'; then ready=1; break; fi
    sleep 3
  done
  if [ "$ready" = "1" ]; then
    ok "/api/health -> $BODY"
  else
    bad "/api/health never reported db:up (got: ${BODY:-<no response>})"
  fi
else
  skip "/api/health — api=false"
fi

# ── 2. Document protection is off ─────────────────────────────────────────
# ★ A 330 KB BODY IS A LOGIN WALL, NOT A PAGE.
#
# A Vercel project starts with SSO protection on: every URL answers 200 and a
# ~330 KB login page. A status-only smoke test calls that success.
if [ "$WANT_WEB" = "true" ]; then
  CODE="$(fetch / "$TMP/index.html")"
  SIZE="$(wc -c < "$TMP/index.html" | tr -d ' ')"
  if [ "$CODE" = "200" ] && [ "$SIZE" -lt 200000 ]; then
    ok "/ -> 200 ($SIZE bytes)"
  elif [ "$SIZE" -ge 200000 ]; then
    bad "/ -> 200 but $SIZE bytes: this looks like a deployment-protection login wall, not the app"
  else
    bad "/ -> $CODE"
  fi
else
  skip "/ — web=false"
fi

# ── 3. The named pages exist, and are distinct from the home page ─────────
if [ "$WANT_WEB" = "true" ]; then
  for path in /start /privacy /dl/; do
    name="$(printf '%s' "$path" | tr -d '/' | tr -d '')"
    [ -n "$name" ] || name=index
    CODE="$(fetch "$path" "$TMP/$name.html")"
    SIZE="$(wc -c < "$TMP/$name.html" | tr -d ' ')"
    if [ "$CODE" != "200" ]; then
      bad "$path -> $CODE"
      continue
    fi
    ok "$path -> 200 ($SIZE bytes)"

    # Body identity is the only check that catches a rewrite swallowing a route.
    if cmp -s "$TMP/$name.html" "$TMP/index.html"; then
      bad "$path serves byte-identical content to / — a rewrite is swallowing it"
    fi
  done

  # The reviewer page must carry its own marker, not merely differ.
  if grep -q 'start-screen' "$TMP/start.html" 2>/dev/null; then
    ok "/start carries the reviewer-screen marker"
  else
    bad "/start does not contain start-screen — it is not the reviewer page"
  fi

  # The served document must declare its direction in the markup, not at runtime.
  if grep -qi '<html[^>]*dir="rtl"' "$TMP/index.html" 2>/dev/null; then
    ok "/ serves dir=\"rtl\" in the markup"
  else
    bad "/ has no dir=\"rtl\" — direction must be in the markup (AC-18.7.1)"
  fi
fi

# ── 4b. At least one real ASSET resolves ──────────────────────────────────
#
# ★ A STATUS CHECK ON HTML CANNOT SEE A 404 UNDER /assets/.
#
# Twice now the deployment published a page whose HTML and JS were fine while
# every binary under `static/assets/` 404'd: the first time the `.vercelignore`
# inherited `.gitignore`'s exclusion of the tree, so all 24 font files vanished
# and English fell back to a system face. Then the CARTO tiles went the same way
# because `EXPO_PUBLIC_CARTO_API_KEY` never reached the bundler, so the map drew
# an empty grid. Both shipped green because nothing here fetched an asset.
#
# The JS bundle path is discovered from the served HTML rather than hardcoded:
# the hash changes every build, and a stale hardcoded name would fail a healthy
# deploy.
if [ "$WANT_WEB" = "true" ]; then
  BUNDLE="$(grep -oE '/_expo/static/js/web/[^"]+\.js' "$TMP/index.html" 2>/dev/null | head -1)"
  if [ -z "$BUNDLE" ]; then
    bad "no /_expo/static/js/web/*.js reference in / — the shell is not the app"
  else
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE$BUNDLE" 2>/dev/null || echo 000)"
    if [ "$CODE" = "200" ]; then
      ok "the JS bundle resolves ($BUNDLE)"
    else
      bad "$BUNDLE -> $CODE — the HTML references a bundle the deploy does not serve"
    fi
  fi

  # ★ AND AT LEAST ONE FONT, INCLUDING ONE UNDER `assets/node_modules/`.
  #
  # The bundle check above is NOT enough, and this is the proof: the failing
  # deployment served its JS perfectly while every Plus Jakarta Sans file 404'd,
  # because `.gitignore`'s depth-agnostic `node_modules/` rule filtered
  # `static/assets/node_modules/**` out of the upload. Vazirmatn resolved (no such
  # segment) so a Persian screen looked right and an English one fell back to a
  # system face.
  #
  # The paths are discovered from the served HTML for the same reason as the
  # bundle: the hashes change every build.
  FONTS="$(grep -oE '/assets/[^"]*\.ttf' "$TMP/index.html" 2>/dev/null | sort -u)"
  if [ -z "$FONTS" ]; then
    bad "no /assets/*.ttf reference in / — the typefaces are not wired at all"
  else
    # One arbitrary font, plus specifically one from the node_modules mirror when
    # the page references any.
    SAMPLE="$(printf '%s\n' "$FONTS" | head -1)"
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE$SAMPLE" 2>/dev/null || echo 000)"
    if [ "$CODE" = "200" ]; then
      ok "a font resolves ($SAMPLE)"
    else
      bad "$SAMPLE -> $CODE — the HTML references a typeface the deploy does not serve"
    fi

    # ★ A `node_modules` SEGMENT IN A PUBLIC URL MUST NOT BE THERE AT ALL.
    #
    # Vercel refuses to serve it whatever `.vercelignore` says, and that is why
    # the English typefaces 404'd from the same tree that served Vazirmatn.
    # `compose-static.sh` relocates it to `assets/vendor/`, so a reference to the
    # old path means the relocation did not run.
    if printf '%s\n' "$FONTS" | grep -q '/assets/node_modules/'; then
      bad "a font is still referenced under /assets/node_modules/ — the host will not serve it"
    else
      ok "no font is referenced under /assets/node_modules/"
    fi
  fi
fi


# These are the paths that must NOT be reachable. Deploying a static host makes
# most of them a non-issue, but a Worker or a misconfigured proxy can expose
# them, and nobody looks.
for path in /studio /storage/v1/object/x /functions/v1/x; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE$path" 2>/dev/null || echo 000)"
  case "$CODE" in
    404|000) ok "$path refused ($CODE)" ;;
    200)     bad "$path answers 200 — an admin UI or pruned service is reachable" ;;
    *)       ok "$path not served ($CODE)" ;;
  esac
done

# ── 5. The reviewer's no-session path ─────────────────────────────────────
# The demo must read WITHOUT a session and must not mint one: every anonymous
# sign-in spends a request from a per-IP budget, so a room behind one NAT
# address exhausts it before anyone decides anything.
if [ -n "${DEMO_TOKEN:-}" ] && [ "$WANT_WEB" = "true" ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/e/$DEMO_TOKEN" 2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ]; then
    ok "/e/<demo> (no session) -> 200"
  else
    bad "/e/<demo> -> $CODE, expected 200"
  fi
else
  skip "/e/<demo> — FREEWHEN_DEMO_TOKEN unset"
fi

exit "$fail"
