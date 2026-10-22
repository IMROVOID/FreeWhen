#!/usr/bin/env bash
#
# scripts/deploy/deploy.sh — gates → export → rsync → migrate → reload → smoke.
#
# ★ THE ORDER IS THE SAFETY PROPERTY, NOT A CONVENIENCE.
#
# Every step either proves the next one is safe or makes it unnecessary:
#
#   1. gates that read the SOURCE     — a leak fails before an artifact exists
#   2. export                         — `--clear`, so no orphaned hashed chunk
#   3. gate:web on the BUILT bundle   — the only scan that sees an inlined .env
#   4. rsync                          — `--delete`, AFTER the bundle is clean
#   5. migrate                        — additive and reversible
#   6. caddy reload                   — picks up the new Caddyfile, if changed
#   7. smoke                          — the contract, from the outside
#
# Moving the rsync above step 3 publishes an artifact that was never scanned.
# That is the one edit this script must never receive.
#
# ★ `--delete` ON BOTH ROOTS, AND WHY IT IS SAFE.
#
# `dist/` is generated: anything left in `/srv/web/` that is not in the new
# export is a stale hashed chunk the new HTML cannot reference, and keeping it
# is how a "works locally" build 404s on the host. `web/` holds only `dl/` and
# `privacy/` (the two hand-written pages) so a delete there cannot remove a
# route — there are no routes on that root.
#
# ★ NO CI, AND THAT IS THE DECISION.
#
# Manual is correct at this scale (PRD-13 §3): one host, one operator, one
# deploy per day at most. The script exists so the manual step is repeatable
# rather than remembered.
#
# Usage:
#   DEPLOY_HOST=deploy@example.com bash scripts/deploy/deploy.sh
#
# Environment:
#   DEPLOY_HOST        required  ssh target (user@host, or a Host alias)
#   DEPLOY_WEB_ROOT    default   /srv/web
#   DEPLOY_STATIC_ROOT default   /srv/static
#   DEPLOY_BASE_URL    required for the smoke test (e.g. https://example.com)
#   DEPLOY_SKIP_SSH    1 = build and gate only, publish nothing

set -euo pipefail

cd "$(dirname "$0")/../.."

: "${DEPLOY_WEB_ROOT:=/srv/web}"
: "${DEPLOY_STATIC_ROOT:=/srv/static}"

log() { printf '\n== %s\n' "$*"; }

log "1/7  release gates (source)"
npm run gate:all -- --skip-web

log "2/7  web export"
bash scripts/build/export-web.sh

log "3/7  release gate (built bundle)"
npm run gate:web

if [[ "${DEPLOY_SKIP_SSH:-0}" == "1" ]]; then
  echo
  echo "DEPLOY_SKIP_SSH=1 — dist/ is built and gated, nothing was published."
  exit 0
fi

: "${DEPLOY_HOST:?DEPLOY_HOST is required (user@host). Set DEPLOY_SKIP_SSH=1 to build only.}"
: "${DEPLOY_BASE_URL:?DEPLOY_BASE_URL is required — the smoke test has no default}"

log "4/7  rsync the export and the static pages"
# The APK lives in web/dl/. It is large and unchanged between deploys, so it is
# synced with the static root in one pass rather than by a second transfer.
rsync -az --delete dist/ "${DEPLOY_HOST}:${DEPLOY_WEB_ROOT}/"

# ★ Two roots, deliberately. `web/` is NOT merged into `dist/`: the app's
# client-side routing would otherwise shadow `/dl/` and `/privacy`, and the
# hand-written pages must load before any JavaScript is agreed to.
rsync -az --delete \
  --exclude 'freewhen.apk' \
  web/ "${DEPLOY_HOST}:${DEPLOY_STATIC_ROOT}/"

# The APK is copied without `--delete` semantics of its own: a failed upload
# should not remove a working download.
rsync -az web/dl/freewhen.apk "${DEPLOY_HOST}:${DEPLOY_STATIC_ROOT}/dl/freewhen.apk" 2>/dev/null || {
  echo "   note: no APK staged (run scripts/build/build-apk.sh) — /dl/ will 404 on the binary" >&2
}

log "5/7  migrations"
# Run on the host, against the host's DATABASE_URL. `db:migrate` is idempotent:
# it records what it applied, so a deploy with no new migration is a no-op.
ssh "${DEPLOY_HOST}" "cd /srv/app && npm run db:migrate"

log "6/7  caddy reload"
# `--config` is explicit so a systemd default cannot point at a different file
# than the one this repo ships.
ssh "${DEPLOY_HOST}" 'sudo caddy reload --config /etc/caddy/Caddyfile'

log "7/7  smoke test"
BASE="$DEPLOY_BASE_URL"
fail=0

check() {
  local description="$1" url="$2" want="$3"
  local got
  got="$(curl -o /dev/null -s -w '%{http_code}' --max-time 15 "$url" || echo '000')"
  if [[ "$got" == "$want" ]]; then
    printf '   %-34s %s\n' "$description" "$got"
  else
    printf '   %-34s %s (want %s)  ← FAILED\n' "$description" "$got" "$want"
    fail=1
  fi
}

# The served paths. A refused path returning 200 is the direction that matters
# most: it means an admin UI or a pruned service is reachable (AC-18.5.1).
check "/health"            "$BASE/health"                 200
check "/start"             "$BASE/start"                  200
check "/privacy"           "$BASE/privacy"                200
check "/dl/"               "$BASE/dl/"                    200
check "/dl/freewhen.apk"   "$BASE/dl/freewhen.apk"        200
check "/api/health"        "$BASE/api/health"             200

check "/studio (refused)"          "$BASE/studio"                  404
check "/storage/v1/x (refused)"    "$BASE/storage/v1/object/x"     404
check "/functions/v1/x (refused)"  "$BASE/functions/v1/x"          404
check "/assets/x.js.map (refused)" "$BASE/assets/x.js.map"         404

# ★ The demo must read WITHOUT a session, and must not mint one.
#
# Every anonymous sign-in spends one request from a 30/hour/IP budget. If the
# demo event is not anonymously readable, every reviewer visit creates a user
# and a room full of reviewers behind one address exhausts the budget before
# they decide anything (AC-18.2.1).
if [[ -n "${EXPO_PUBLIC_DEMO_TOKEN:-}" ]]; then
  check "/e/<demo> (no session)" "$BASE/e/${EXPO_PUBLIC_DEMO_TOKEN}" 200
else
  echo "   /e/<demo>                          skipped — EXPO_PUBLIC_DEMO_TOKEN unset"
fi

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "smoke test FAILED — the deploy is published but the contract is not met." >&2
  echo "Roll back with: rsync -az --delete <previous dist>/ ${DEPLOY_HOST}:${DEPLOY_WEB_ROOT}/" >&2
  exit 1
fi

echo
echo "deploy: published to ${DEPLOY_HOST} and the contract holds."
