#!/usr/bin/env bash
# Apply the migrations to whatever database the deployment will use.
#
# ★ TLS IS APPENDED FOR A MANAGED PROVIDER, DELIBERATELY.
#
# Neon and Supabase refuse a connection without it, and the error they return
# reads as "password authentication failed" — which sends an operator to rotate
# a password that was fine. `pg` also warns that `sslmode=require` currently
# means `verify-full`; the behaviour is what this deployment wants, so the
# warning is expected rather than suppressed.
#
# ★ THE MIGRATIONS ARE ADDITIVE AND IDEMPOTENT.
#
# `scripts/db/migrate.ts` records what it applied, so re-running a deploy with no
# new migration is a no-op. That is what makes "migrate before deploy" safe to
# put in front of every run rather than gating it on a diff.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "::error title=No database::DATABASE_URL is unset. Pass an external connection string, or set it to the host's own."
  exit 1
fi

URL="$DATABASE_URL"

# Only rewrite when it is not already present and this is not a loopback host.
case "$URL" in
  *sslmode=*) ;;
  *localhost*|*127.0.0.1*|*::1*) ;;
  *)
    case "$URL" in
      *\?*) URL="$URL&sslmode=require" ;;
      *)    URL="$URL?sslmode=require" ;;
    esac
    echo "appended sslmode=require for a managed provider"
    ;;
esac

# The host, without credentials, so the log says where this ran.
HOST="$(printf '%s' "$URL" | sed -E 's#^[^@]*@##; s#/.*$##')"
echo "applying migrations against $HOST"

DATABASE_URL="$URL" npm run db:migrate

echo "migrations applied"
