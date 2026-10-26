#!/usr/bin/env bash
# Deploy the composed static root and/or the backend to one host.
#
# Usage: host-platform.sh <target> <shape>
#   target: vps | vercel | netlify | cloudflare | railway | render | fly
#   shape:  serverless | vm
#
# Every branch is driven by what was actually observed against a real account,
# not by what the vendor's quickstart shows:
#
#   vercel     A new project has SSO protection ON. Every URL answers 200 with a
#              ~330 KB login wall, and the production domain does NOT move when a
#              deployment is created. Both are handled here.
#   netlify    Pretty URLs turn `/privacy` into a 301. A status-only check
#              reports a false negative on a correct deploy.
#   cloudflare The `pg` transport cannot run in a Worker. `validate` refuses it
#              before this script is reached.
#   railway    A project token cannot read the domain list, so the origin comes
#              from PUBLIC_ORIGIN rather than the API.
#   render     `static_site` requires a git repo; there is no directory upload.
#   fly        The org token is `FlyV1 <payload>,<mac>` with a space — the value
#              is the credential, so the header is not `Bearer`.
#   vps        Compose on an ssh host, with the host key pinned.
set -uo pipefail

TARGET="${1:?usage: host-platform.sh <target> <shape>}"
SHAPE="${2:?usage: host-platform.sh <target> <shape>}"
STATIC="${STATIC_DIR:-static}"

SITE=""
log() { echo "== $*"; }

finish() {
  # The caller reads `SITE` from this step's output.
  echo "SITE=${SITE:-$PUBLIC_ORIGIN}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
}

require() {
  if [ -z "$(eval "printf '%s' \"\${$1:-}\"")" ]; then
    echo "::error title=Missing credential::$1 is required to deploy to $TARGET. $2"
    exit 1
  fi
}

[ -d "$STATIC" ] || { echo "::error::$STATIC is missing — run compose-static.sh first"; exit 1; }

case "$TARGET" in
  # =========================================================================
  # Vercel — serverless
  # =========================================================================
  vercel)
    require VERCEL_TOKEN "Create one at https://vercel.com/account/tokens and store it as VERCEL_TOKEN."

    # Link the project so a deploy cannot create a new one. Without this the CLI
    # derives the project name from the directory and silently starts a second
    # project — which is how a "successful" deploy ends up somewhere nobody
    # looks.
    if [ -n "${VERCEL_ORG_ID:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
      mkdir -p "$STATIC/.vercel"
      printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > "$STATIC/.vercel/project.json"
      log "linked to project $VERCEL_PROJECT_ID"
    fi

    # ★ `vercel.json` IS WRITTEN HERE, NOT COMMITTED.
    #
    # `cleanUrls` maps `/start` to `start.html`. Without it the app's one-HTML-
    # per-route output is reachable only at `/start.html`, and a catch-all
    # rewrite would serve the home page instead — which is what happened on the
    # first attempt and looked like a 200.
    # ★ THE DESTINATION MUST NOT CONTAIN `[` AND MUST NOT END IN `.html`.
    #
    # Two separate failures, both found by testing the live deployment rather
    # than the exit code:
    #
    #   1. A destination containing `[` — `e/[token].html` — never resolves.
    #      `compose-static.sh` writes a bracket-free alias for it.
    #   2. With `cleanUrls: true`, a destination ending in `.html` also never
    #      matches. `/e/:token -> /e/_token.html` returned 404 while
    #      `/e/:token -> /e/_token` returned 200 against the same file, on a
    #      preview deployment built from the same tree.
    #
    # `cleanUrls` already maps an extension-less path onto its `.html`, so the
    # destinations below omit it. `/privacy` also needed no rule at all — it
    # was `cleanUrls` resolving the directory, which is why the first deploy
    # looked like rewrites worked.
    #
    # Rewrites are matched IN ORDER, so the longer patterns come first: with
    # `/event/:id/:tab` above `/event/:id/venue/:vid`, a venue URL would match
    # the tab rule and ask for a file that does not exist.
    # ★ THE `/health` RULE EXISTS ONLY WHEN THE FUNCTION DOES.
    #
    # Vercel already serves `api/index.js` at `/api/health`. The APK's
    # preflight and `verify-deployment.sh` both check `/health` (no prefix), so
    # that path needs a rule — but a static-only deploy has no function to send
    # it to, and a rewrite to a non-existent destination is worse than a plain
    # 404.
    HEALTH_RULE=""
    FUNCTIONS_RULE=""
    if [ "${WANT_API:-false}" = "true" ]; then
      HEALTH_RULE=$',\n    { "source": "/health", "destination": "/api" }'
      FUNCTIONS_RULE=$'"functions": { "api/index.js": { "memory": 1024, "maxDuration": 30 } },\n  '
    fi
    cat > "$STATIC/vercel.json" <<JSON
{
  "cleanUrls": true,
  "trailingSlash": false,
  ${FUNCTIONS_RULE}"rewrites": [
    { "source": "/dl/(.*)", "destination": "/dl/\$1" },
    { "source": "/e/:token/location", "destination": "/e/_token/location" },
    { "source": "/e/:token", "destination": "/e/_token" },
    { "source": "/event/:id/venue/:vid", "destination": "/event/_id/venue/_vid" },
    { "source": "/event/:id/:tab", "destination": "/event/_id/:tab" },
    { "source": "/event/:id", "destination": "/event/_id" }${HEALTH_RULE}
  ]
}
JSON

    # ★ THE API IS A FUNCTION, AND ONLY WHEN `api=true`.
    #
    # `server/runtime/README.md` says the function directory "belongs to the
    # host, not to this project", so nothing in the repository is named for
    # Vercel. A Vercel function is one file exporting
    # `default (request: Request) => Promise<Response>` — exactly the
    # `web-fetch.ts` convention — so `scripts/build/bundle-api.mjs` emits that
    # file from the real adapter and this script places it next to the
    # `vercel.json` it already writes for the same reason.
    #
    # `pg` is INLINED, so no package.json ships.
    #
    # An earlier version left it external and wrote a package.json for the
    # platform to install. Vercel restored a build cache, printed
    # `Installing dependencies... up to date in 456ms`, installed nothing, and
    # the function then hung on its first request with no error in the log.
    if [ "${WANT_API:-false}" = "true" ]; then
      log "bundling the API function"
      node scripts/build/bundle-api.mjs
      mkdir -p "$STATIC/api"
      cp api/index.js "$STATIC/api/index.js"
      log "api/index.js placed ($(wc -c < "$STATIC/api/index.js" | tr -d ' ') bytes)"
    fi

    log "vercel deploy --prod"
    OUT="$(cd "$STATIC" && VERCEL_ORG_ID="$VERCEL_ORG_ID" VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID" \
      npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" 2>&1)"
    printf '%s\n' "$OUT"
    DEPLOY_URL="$(printf '%s\n' "$OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' | tail -1)"
    [ -n "$DEPLOY_URL" ] || { echo "::error::Vercel did not report a deployment URL."; exit 1; }

    log "disabling deployment protection"
    # ★ A FRESH PROJECT ANSWERS EVERY URL WITH A LOGIN WALL.
    #
    # It is a 200 with ~330 KB of HTML, so nothing but a body check notices.
    # `ssoProtection: null` turns it off for the project.
    if [ -n "${VERCEL_PROJECT_ID:-}" ] && [ -n "${VERCEL_ORG_ID:-}" ]; then
      curl -sS -X PATCH "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID" \
        -H "Authorization: Bearer $VERCEL_TOKEN" \
        -H 'Content-Type: application/json' \
        -d '{"ssoProtection":null}' -o /dev/null -w '  PATCH -> %{http_code}\n'
    fi

    # ★ CREATING A DEPLOYMENT DOES NOT MOVE THE PRODUCTION DOMAIN.
    #
    # The first deploy keeps it; every later one sits on a hashed preview URL
    # until it is aliased. Without this step a redeploy looks like a no-op.
    DEPLOY_ID="$(printf '%s\n' "$OUT" | grep -oE 'dpl_[A-Za-z0-9]+' | tail -1)"
    if [ -n "$DEPLOY_ID" ] && [ -n "${VERCEL_ORG_ID:-}" ]; then
      ALIAS="$(printf '%s' "$PUBLIC_ORIGIN" | sed -E 's#^https?://##')"
      if printf '%s' "$ALIAS" | grep -qE '\.vercel\.app$'; then
        log "aliasing $DEPLOY_ID to $ALIAS"
        curl -sS -X POST "https://api.vercel.com/v2/deployments/$DEPLOY_ID/aliases?teamId=$VERCEL_ORG_ID" \
          -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
          -d "{\"alias\":\"$ALIAS\"}" -o /dev/null -w '  alias -> %{http_code}\n'
      fi
    fi

    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # Netlify — serverless (static half)
  # =========================================================================
  netlify)
    require NETLIFY_AUTH_TOKEN "Create one at https://app.netlify.com/user/applications."

    # The site id is optional: the API can create one by name, which keeps the
    # first deploy from needing a manual step in the dashboard.
    SITE_ID="${NETLIFY_SITE_ID:-}"
    NAME="$(printf '%s' "$PUBLIC_ORIGIN" | sed -E 's#^https?://##; s#\..*$##')"

    if [ -z "$SITE_ID" ]; then
      log "creating site '$NAME'"
      CREATED="$(curl -fsS -X POST "https://api.netlify.com/api/v1/sites" \
        -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "{\"name\":\"$NAME\"}" 2>&1)"
      SITE_ID="$(printf '%s' "$CREATED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})')"
      [ -n "$SITE_ID" ] || { printf '%s\n' "$CREATED"; echo "::error::Netlify did not return a site id."; exit 1; }
      log "created $SITE_ID"
    fi

    # ★ NETLIFY'S EQUIVALENT OF THE VERCEL REWRITES.
    #
    # Same bracket-free aliases as the Vercel block — a destination containing
    # `[` does not resolve on either host.
    #
    # ★ THE `.html` STAYS HERE, UNLIKE ON VERCEL.
    #
    # Netlify has no `cleanUrls`: its `200` rewrites are served as written, so
    # an extension-less destination would ask for a file with no extension.
    # Vercel omits it precisely because `cleanUrls` supplies that mapping.
    #
    # First match wins, longest first.
    cat > "$STATIC/_redirects" <<'RULES'
/dl/*        /dl/:splat        200
/e/:token/location  /e/_token/location.html  200
/e/:token    /e/_token.html   200
/event/:id/venue/:vid  /event/_id/venue/_vid.html  200
/event/:id/:tab  /event/_id/:tab.html  200
/event/:id   /event/_id/index.html  200
RULES

    # A ZIP deploy is one request; the documented cap is 25,000 extracted files.
    log "zip + deploy"
    ( cd "$STATIC" && zip -qr "$RUNNER_TEMP/static.zip" . )
    OUT="$(curl -sS -X POST "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" \
      -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
      -H 'Content-Type: application/zip' \
      --data-binary "@$RUNNER_TEMP/static.zip")"
    DEPLOY_ID="$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})')"
    [ -n "$DEPLOY_ID" ] || { printf '%s\n' "$OUT"; echo "::error::Netlify did not return a deploy id."; exit 1; }

    log "waiting for $DEPLOY_ID"
    for _ in $(seq 1 60); do
      STATE="$(curl -fsS "https://api.netlify.com/api/v1/deploys/$DEPLOY_ID" \
        -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).state||"")}catch{}})')"
      [ "$STATE" = "ready" ] && break
      [ "$STATE" = "error" ] && { echo "::error::Netlify deploy errored."; exit 1; }
      sleep 3
    done
    [ "$STATE" = "ready" ] || echo "::warning::Netlify had not reached 'ready' within 3 minutes; the verify job will decide."

    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # Cloudflare Pages — static only
  # =========================================================================
  cloudflare)
    require CLOUDFLARE_API_TOKEN "Create one with Pages:Edit."
    require CLOUDFLARE_ACCOUNT_ID "The account id from the dashboard URL."
    PROJECT="${CF_PAGES_PROJECT:-freewhen}"

    # ★ THE API IS NOT DEPLOYED HERE, AND THE SUMMARY SAYS SO.
    #
    # A Worker can serve the API on this host, but only over the `supabase_rest`
    # transport — `validate` refuses `pg` before reaching this script. When the
    # caller asked for api=true this branch has already been told the transport
    # is compatible; it still publishes only the static half, because deploying
    # the Worker is a separate unit whose entry file is `server/runtime/`.
    if [ "${WANT_API:-false}" = "true" ]; then
      echo "::warning title=API not deployed from this workflow::Cloudflare Workers need server/runtime/edge-no-process-env.ts and DATABASE_BACKEND=supabase_rest. Only the static half was published here."
    fi

    # A single-root host needs the exclusions stated, because its SPA fallback
    # would otherwise serve the app shell for `/dl/` and `/privacy`.
    cat > "$STATIC/_routes.json" <<'JSON'
{ "version": 1, "include": ["/*"], "exclude": [] }
JSON

    log "wrangler pages deploy"
    OUT="$(CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
      npx --yes wrangler@latest pages deploy "$STATIC" \
        --project-name "$PROJECT" --branch main 2>&1)"
    printf '%s\n' "$OUT"
    DEPLOY_URL="$(printf '%s\n' "$OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.pages\.dev' | tail -1)"
    [ -n "$DEPLOY_URL" ] || { echo "::error::wrangler did not report a deployment URL."; exit 1; }

    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # Railway — vm, container
  # =========================================================================
  railway)
    require RAILWAY_TOKEN "Railway → Project → Settings → Tokens."

    log "railway up"
    OUT="$(npx --yes @railway/cli@latest up \
      --service "${RAILWAY_SERVICE:-freewhen-api}" --detach --ci 2>&1)" \
      || { printf '%s\n' "$OUT"; echo "::error::railway up failed."; exit 1; }
    printf '%s\n' "$OUT"

    # A project token cannot read the domain list by design, so the origin is
    # the one the operator configured.
    require PUBLIC_ORIGIN "The Railway service URL, stored as FREEWHEN_SERVER_URL."
    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # Render — vm, container from a connected repository
  # =========================================================================
  render)
    require RENDER_API_KEY "https://dashboard.render.com/u/settings#api-keys"

    API=https://api.render.com/v1

    if [ -z "${RENDER_SERVICE_ID:-}" ]; then
      # ★ RENDER CANNOT TAKE A DIRECTORY UPLOAD.
      #
      # `POST /services` with `type: static_site` and no repo answers
      # 400 "repo is required when using service type: static_site". So a
      # Render deploy builds from a connected repository, which means the export
      # runs on Render and `EXPO_PUBLIC_*` must be *service environment
      # variables* — the opposite of every other target, where the export runs
      # here and the values are inlined.
      require RENDER_OWNER_ID "The owner id from https://api.render.com/v1/owners"
      require GITHUB_REPOSITORY "github.repository, set automatically"

      log "creating the Render service"
      cat > "$RUNNER_TEMP/render-service.json" <<JSON
{
  "type": "web_service",
  "name": "freewhen-api",
  "ownerId": "${RENDER_OWNER_ID}",
  "repo": "https://github.com/${GITHUB_REPOSITORY}",
  "branch": "${GITHUB_REF_NAME:-main}",
  "autoDeploy": "no",
  "envVars": [
    { "key": "DATABASE_URL", "value": "${DATABASE_URL:-}" },
    { "key": "JWT_SECRET", "value": "${JWT_SECRET:-}" },
    { "key": "PUBLIC_BASE_URL", "value": "${PUBLIC_ORIGIN}" },
    { "key": "APP_ORIGIN", "value": "${APP_ORIGIN:-$PUBLIC_ORIGIN}" },
    { "key": "DATABASE_BACKEND", "value": "local_pg" },
    { "key": "API_HOST", "value": "0.0.0.0" },
    { "key": "NODE_ENV", "value": "production" }
  ],
  "serviceDetails": {
    "env": "docker",
    "healthCheckPath": "/health",
    "plan": "starter"
  }
}
JSON
      curl -fsS -X POST "$API/services" \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' \
        --data-binary "@$RUNNER_TEMP/render-service.json" -o "$RUNNER_TEMP/render-out.json" \
        || { cat "$RUNNER_TEMP/render-out.json" 2>/dev/null; echo "::error::Render rejected the service definition."; exit 1; }
      RENDER_SERVICE_ID="$(node -e 'const j=require(process.argv[1]);process.stdout.write((j.service&&j.service.id)||j.id||"")' "$RUNNER_TEMP/render-out.json")"
      [ -n "$RENDER_SERVICE_ID" ] || { cat "$RUNNER_TEMP/render-out.json"; echo "::error::Render did not return a service id."; exit 1; }
      log "created $RENDER_SERVICE_ID"
    fi

    log "triggering a deploy"
    curl -fsS -X POST "$API/services/$RENDER_SERVICE_ID/deploys" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H 'Content-Type: application/json' -H 'Accept: application/json' \
      -d '{"clearCache":"do_not_clear"}' -o /dev/null

    require PUBLIC_ORIGIN "The Render service URL, stored as FREEWHEN_SERVER_URL."
    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # Fly.io — vm, container
  # =========================================================================
  fly)
    require FLY_API_TOKEN "Run \`fly tokens create org\`."
    require FLY_APP "The Fly app name, stored as FLY_APP."

    # ★ THE ORG TOKEN IS `FlyV1 <payload>,<mac>` — A SPACE, AND NO `Bearer`.
    #
    # The value carries its own scheme, so `Authorization: Bearer $TOKEN` is
    # wrong and is rejected. flyctl reads FLY_API_TOKEN directly and knows this,
    # which is why the CLI is used rather than a hand-rolled curl.
    curl -fsSL https://fly.io/install.sh | sh
    export FLYCTL_INSTALL="${FLYCTL_INSTALL:-$HOME/.fly}"
    export PATH="$FLYCTL_INSTALL/bin:$PATH"

    log "launching $FLY_APP (no deploy yet)"
    if [ ! -f fly.toml ]; then
      flyctl launch --copy-config --no-deploy --name "$FLY_APP" --region "${FLY_REGION:-fra}" --yes
    fi

    log "setting secrets"
    {
      [ -n "${DATABASE_URL:-}" ] && echo "DATABASE_URL=$DATABASE_URL"
      [ -n "${JWT_SECRET:-}" ] && echo "JWT_SECRET=$JWT_SECRET"
      echo "PUBLIC_BASE_URL=$PUBLIC_ORIGIN"
      echo "APP_ORIGIN=${APP_ORIGIN:-$PUBLIC_ORIGIN}"
      echo "DATABASE_BACKEND=local_pg"
      echo "API_HOST=0.0.0.0"
      echo "PORT=8787"
      echo "NODE_ENV=production"
    } > "$RUNNER_TEMP/fly-secrets.env"
    flyctl secrets import --app "$FLY_APP" < "$RUNNER_TEMP/fly-secrets.env"
    rm -f "$RUNNER_TEMP/fly-secrets.env"

    log "deploying"
    flyctl deploy --app "$FLY_APP" --remote-only --wait-timeout 15m

    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  # =========================================================================
  # VPS — vm, Compose over ssh
  # =========================================================================
  vps)
    require VPS_HOST "The server address."
    require VPS_SSH_KEY "A private key with access to that host."
    require VPS_SSH_HOST_FINGERPRINT "Run: ssh-keyscan $VPS_HOST | ssh-keygen -lf - -E sha256"

    SSH_USER="${VPS_USER:-deploy}"
    REMOTE="${VPS_PATH:-/srv/app}"

    log "verifying the host key"
    # ★ `ssh-keyscan` ALONE IS NOT A VERIFICATION.
    #
    # It populates known_hosts from whatever answers on that address. The pinned
    # fingerprint comparison is what proves the host is the intended one.
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    printf '%s\n' "$VPS_SSH_KEY" > "$HOME/.ssh/deploy_key"
    chmod 600 "$HOME/.ssh/deploy_key"
    ssh-keyscan -H "$VPS_HOST" > "$HOME/.ssh/known_hosts" 2>/dev/null
    ACTUAL="$(ssh-keygen -lf "$HOME/.ssh/known_hosts" -E sha256 | awk '{print $2}' | sort -u | head -1)"
    if [ "$ACTUAL" != "$VPS_SSH_HOST_FINGERPRINT" ]; then
      echo "::error title=Host key mismatch::expected $VPS_SSH_HOST_FINGERPRINT, got $ACTUAL. If the host was legitimately rebuilt, update VPS_SSH_HOST_FINGERPRINT."
      exit 1
    fi
    log "host key verified"

    SSH_OPTS=(-i "$HOME/.ssh/deploy_key" -o StrictHostKeyChecking=yes)

    log "syncing the source"
    rsync -az --delete \
      --exclude '.git' --exclude '.env' --exclude 'node_modules' \
      --exclude 'dist' --exclude 'static' --exclude 'android' --exclude 'ios' \
      -e "ssh ${SSH_OPTS[*]}" \
      ./ "$SSH_USER@$VPS_HOST:$REMOTE/"

    if [ -d "$STATIC" ]; then
      log "syncing the static root"
      # Two roots on the host, as the Caddyfile expects: dist as the app and
      # web as the separate static root, so the app router cannot shadow them.
      rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$STATIC/" "$SSH_USER@$VPS_HOST:$REMOTE/static/"
    fi

    log "rendering the environment file"
    # ★ THE VALUES NEVER LAND IN THE REPOSITORY.
    #
    # Written over ssh with `umask 077`, so it is 0600 from the moment it exists.
    # Single-quoted with embedded quotes escaped: a password containing `$`, a
    # space or a quote survives intact and is never expanded by the remote shell.
    quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
    {
      echo "umask 077"
      echo "cat > $REMOTE/.env <<'FREEWHEN_ENV_EOF'"
      echo "NODE_ENV=production"
      echo "PORT=8787"
      echo "API_HOST=0.0.0.0"
      echo "PUBLIC_BASE_URL=$(quote "$PUBLIC_ORIGIN")"
      echo "APP_ORIGIN=$(quote "${APP_ORIGIN:-$PUBLIC_ORIGIN}")"
      if [ "${EXTERNAL_DB:-false}" = "true" ]; then
        echo "DATABASE_BACKEND=local_pg"
        echo "DATABASE_URL=$(quote "${DATABASE_URL:-}")"
      else
        echo "DATABASE_BACKEND=local_pg"
        echo "POSTGRES_PASSWORD=$(quote "${POSTGRES_PASSWORD:-}")"
      fi
      echo "JWT_SECRET=$(quote "${JWT_SECRET:-}")"
      [ -n "${NESHAN_MATRIX_API_KEY:-}" ]    && echo "NESHAN_MATRIX_API_KEY=$(quote "$NESHAN_MATRIX_API_KEY")"
      [ -n "${NESHAN_DIRECTION_API_KEY:-}" ] && echo "NESHAN_DIRECTION_API_KEY=$(quote "$NESHAN_DIRECTION_API_KEY")"
      [ -n "${ORS_API_KEY:-}" ]              && echo "ORS_API_KEY=$(quote "$ORS_API_KEY")"
      echo "FREEWHEN_ENV_EOF"
      echo "chmod 600 $REMOTE/.env"
    } | ssh "${SSH_OPTS[@]}" "$SSH_USER@$VPS_HOST" bash -s

    log "compose up"
    # `docker-compose.deploy.yml` declares postgres, api and realtime with no
    # profiles, so naming services is what selects a subset: an external DB
    # means api+realtime, a bundled one means all three.
    if [ "${EXTERNAL_DB:-false}" = "true" ]; then SERVICES="api realtime"; else SERVICES=""; fi
    ssh "${SSH_OPTS[@]}" "$SSH_USER@$VPS_HOST" \
      "cd $REMOTE && docker compose -f docker-compose.deploy.yml up -d --build $SERVICES"

    log "reloading Caddy"
    ssh "${SSH_OPTS[@]}" "$SSH_USER@$VPS_HOST" \
      'sudo caddy reload --config /etc/caddy/Caddyfile'

    SITE="$PUBLIC_ORIGIN"
    finish
    ;;

  *)
    echo "::error::unknown target '$TARGET'"
    exit 1
    ;;
esac

echo "deployed $TARGET ($SHAPE) -> ${SITE:-$PUBLIC_ORIGIN}"

