#!/usr/bin/env bash
#
# scripts/build/export-web.sh — the web artifact, and the only one a reviewer
# needs (PRD-18 D18-1, PRD-13 §15.1).
#
# ★ IT IS NOT A ONE-LINE WRAPPER AROUND `npm run export:web`, AND THE DIFFERENCE
#   MATTERS.
#
# Two things have to be true before a `dist/` is allowed to reach a host:
#
#   1. the SOURCE gates are green, and
#   2. the BUILT bundle passes `gate:web`.
#
# `gate:web` cannot run before the export — it scans `dist/`. And it must not
# run after the rsync — by then the artifact is public. So the ordering below is
# the whole script: source gates → export → bundle gate. Anything that flips
# those three lines has removed the check that exists because the web bundle is
# a second thing shipped to strangers.
#
# ★ `--clear` IS NOT OPTIONAL.
#
# A stale `dist/` keeps the previous build's hashed chunks while the new
# `index.html` references different ones. The page works locally (the old chunks
# are still on disk) and 404s on the host (they are not). `--clear` arrives from
# `package.json`'s `export:web` script, so this file must call the script rather
# than reimplementing the command.
#
# ★ THE DEMO TOKEN IS INLINED AT EXPORT TIME.
#
# `EXPO_PUBLIC_*` is substituted by the bundler, not read at runtime, so the demo
# token has to be in THIS shell. Setting it only on the host produces a bundle
# whose `/start` renders the "not configured" state — and that is exactly why
# `gate:web` scans the output rather than the source.
#
# Usage:
#   bash scripts/build/export-web.sh
#   DEPLOY_SKIP_SOURCE_GATES=1 bash scripts/build/export-web.sh   # not for prod

set -euo pipefail

cd "$(dirname "$0")/../.."

echo "== 1/3  source gates =="
if [[ "${DEPLOY_SKIP_SOURCE_GATES:-0}" == "1" ]]; then
  echo "   skipped (DEPLOY_SKIP_SOURCE_GATES=1) — the export is NOT deployable"
else
  npm run gate:secrets
  npm run gate:location
  npm run gate:engine-purity
  npm run gate:logs
  npm run gate:design
  npm run gate:i18n
fi

echo "== 2/3  export =="
# `--clear` lives in the npm script. A reviewer who needs the demo event must
# have `EXPO_PUBLIC_DEMO_TOKEN` here, not only in the host's environment.
if [[ -z "${EXPO_PUBLIC_DEMO_TOKEN:-}" ]]; then
  echo "   WARNING: EXPO_PUBLIC_DEMO_TOKEN is unset — /start will say the demo is" >&2
  echo "            not configured. Set it in this shell, not on the host." >&2
fi

npm run export:web

# The sitemap and robots.txt are not part of the export and cannot live in
# `public/`: both need the absolute origin, which only the environment knows.
# Running here means the sitemap names the same origin the canonical tags do.
echo "== 2b   seo (robots.txt, sitemap.xml) =="
npm run gen:seo

echo "== 3/3  gate:web (the built bundle) =="
npm run gate:web

# The two assertions that make the artifact a deploy candidate rather than just
# a successful build. Both are cheap and both have failed in the past: an empty
# index and an LTR document are the two ways a green build ships a broken page.
test -s dist/index.html || { echo "dist/index.html is missing or empty" >&2; exit 1; }

if ! grep -q 'dir="rtl"' dist/index.html; then
  echo "dist/index.html has no dir=\"rtl\" — direction must be in the markup (AC-18.7.1)" >&2
  exit 1
fi

echo "export-web: dist/ is ready ($(find dist -type f | wc -l | tr -d ' ') files)"
