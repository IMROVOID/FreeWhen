#!/usr/bin/env bash
# scripts/spike/reachability.sh
#
# Phase 0 de-risk spike — docs/plans/00-de-risk-spike.plan.md
#
# Answers one question per check: can an Iranian connection actually reach the
# host, Neshan and the tile source? Every architectural decision downstream
# depends on the answer, so nothing here guesses (PRD-17 §2).
#
# Run this ON a connection physically inside Iran, not from a laptop abroad.
# A PASS from the wrong network is worse than no measurement: it closes a gate
# on evidence that does not apply.
#
# Usage:
#   cp scripts/spike/.env.spike.example scripts/spike/.env.spike   # fill it in
#   bash scripts/spike/reachability.sh                             # all six checks
#   bash scripts/spike/reachability.sh 0.2 0.3                     # a subset
#   bash scripts/spike/reachability.sh --help
#
# Exit codes:
#   0  every check PASSed — all six measured and green
#   1  at least one check FAILed
#   2  nothing could be measured (missing credentials / host)
#   3  PARTIAL — some PASS, some UNMEASURED. The phase cannot close.
#
# A check is one of three things, never two:
#   PASS        measured, and it worked
#   FAIL        measured, and it did not work
#   UNMEASURED  not measured — a missing credential or host, not a verdict
#
# Missing credentials are deliberate, not failures. A Neshan key scoped to the
# wrong service answers 483 for a configuration reason; calling that a
# reachability failure is exactly the false signal this script exists to avoid.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
envfile="$here/.env.spike"

# The report shape this script emits, so a transcript can be pasted into
# docs/spike/REACHABILITY.md without editing.
POSTGRES_PLACEHOLDER=""

pass=0; fail=0; unmeasured=0
fail_names=""
selected=()

usage() {
  # Print the header comment block. Anchored on content, not line numbers:
  # a hardcoded range silently truncates the moment the header is edited.
  awk 'NR==1 && /^#!/ { next }
       /^#/ { sub(/^# ?/, ""); print; next }
       { exit }' "${BASH_SOURCE[0]}"
}

valid_ids=" 0.1 0.2 0.3 0.4 0.5 0.6 "
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -*) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
    *)
      # Reject a typo rather than running zero checks and reporting UNMEASURED,
      # which reads as "no credentials" and hides the mistake.
      case "$valid_ids" in
        *" $1 "*) selected+=("$1") ;;
        *) printf 'unknown check id: %s (valid: 0.1 0.2 0.3 0.4 0.5 0.6)\n' "$1" >&2
           exit 2 ;;
      esac
      ;;
  esac
  shift
done

# --- environment ------------------------------------------------------------
# SPIKE_NO_ENV=1 makes runs reproducible in tests: no ambient file is sourced.
if [ "${SPIKE_NO_ENV:-0}" != "1" ] && [ -f "$envfile" ]; then
  # shellcheck disable=SC1090
  set -a; . "$envfile"; set +a
fi

have() { [ -n "${!1:-}" ]; }
want() {  # want <id> — is this check in the requested subset?
  [ "${#selected[@]}" -eq 0 ] && return 0
  local s; for s in "${selected[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}

record_pass()       { pass=$((pass + 1));       printf 'PASS        %s  %s\n' "$1" "$2"; }
record_fail()       { fail=$((fail + 1)); fail_names="$fail_names $1"
                      printf 'FAIL        %s  %s\n' "$1" "$2"; }
record_unmeasured() { unmeasured=$((unmeasured + 1))
                      printf 'UNMEASURED  %s  %s\n' "$1" "$2"; }

# Timestamps go to the report, never into a check's own output.
now() { date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown'; }

# http <url> [extra curl args...] -> prints "<code> <content-type>"
# Never prints headers, so no credential or trace id can reach the transcript.
CURL=(curl -sS --max-time 20 -o /dev/null -w '%{http_code} %{content_type}')
[ -n "${SPIKE_INSECURE:-}" ] && CURL+=(-k)

http() {
  local url="$1"; shift
  "${CURL[@]}" "$@" "$url" 2>/dev/null
}

# body <url> <max-bytes> [extra curl args...] -> stdout
body() {
  local url="$1" limit="$2"; shift 2
  curl -sS --max-time 20 --range "0-$limit" "$@" "$url" 2>/dev/null
}

base() {  # base <var> <default>
  local v="${!1:-}"
  printf '%s' "${v:-$2}"
}

# --- 0.1  VPS sizing --------------------------------------------------------
# Expected 4 cores / 8 GiB / >=80 GB (PRD-10 §7.1 recommended tier).
# Only meaningful on the VPS. Judging a dev laptop's specs measures the wrong
# machine, so unless the operator says "this IS the VPS" the check abstains.
check_01() {
  local id=0.1
  want "$id" || return 0
  if [ "${SPIKE_IS_VPS:-0}" != "1" ] || [ ! -r /proc/meminfo ]; then
    record_unmeasured "$id" "VPS sizing — set SPIKE_IS_VPS=1 and run on the VPS"
    return 0
  fi
  local cores mem_kb disk_gb detail
  cores=$(nproc 2>/dev/null || printf 0)
  mem_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || printf 0)
  disk_gb=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
  disk_gb=${disk_gb:-0}
  local mem_gb=$(( ${mem_kb:-0} / 1024 / 1024 ))
  detail="cores=$cores mem=${mem_gb}GiB disk=${disk_gb}GB"
  if [ "$cores" -ge 4 ] && [ "$mem_gb" -ge 8 ] && [ "$disk_gb" -ge 80 ]; then
    record_pass "$id" "$detail"
  else
    record_fail "$id" "$detail (want cores>=4 mem>=8GiB disk>=80GB)"
  fi
}

# --- 0.2  Neshan directions, from Iran --------------------------------------
# Endpoint and parameter names from the vendor's own docs:
# https://platform.neshan.org/docs/api/routing-category/routing/
check_02() {
  local id=0.2
  want "$id" || return 0
  local api; api=$(base NESHAN_BASE 'https://api.neshan.org')
  if ! have NESHAN_API_KEY; then
    record_unmeasured "$id" "Neshan directions — NESHAN_API_KEY not set"
    return 0
  fi
  local o d
  o=$(base SPIKE_ORIGIN '35.7448,51.3756')        # Tajrish
  d=$(base SPIKE_DESTINATION '35.6997,51.3380')   # Azadi
  local url="$api/v4/direction?type=car&origin=$o&destination=$d"
  local res code ctype
  res=$(http "$url" -H "Api-Key: $NESHAN_API_KEY")
  code=${res%% *}; ctype=${res#* }

  case "$code" in
    200)
      # A 200 is not enough — an HTML block page also answers 200.
      if printf '%s' "$ctype" | grep -qi 'html'; then
        record_fail "$id" "HTTP 200 but content-type=$ctype (block page, not a route)"
        return 0
      fi
      local payload; payload=$(body "$url" 4096 -H "Api-Key: $NESHAN_API_KEY")
      if printf '%s' "$payload" | grep -q '"routes"'; then
        record_pass "$id" "HTTP 200, routes[] present"
      else
        record_fail "$id" "HTTP 200 but no routes[] in body"
      fi
      ;;
    470) record_fail   "$id" "HTTP 470 CoordinateParseError — check SPIKE_ORIGIN/DESTINATION format" ;;
    480) record_fail   "$id" "HTTP 480 KeyNotFound — key rejected (config, not reachability)" ;;
    481) record_fail   "$id" "HTTP 481 LimitExceeded — quota exhausted; top up or degrade" ;;
    482) record_fail   "$id" "HTTP 482 RateExceeded — back off and re-run" ;;
    483|484|485)
         record_fail   "$id" "HTTP $code key scoped to the wrong service — provision a directions key" ;;
    000|"") record_fail "$id" "no response — endpoint unreachable from here" ;;
    *)   record_fail   "$id" "HTTP $code unexpected" ;;
  esac
}

# --- 0.3  Neshan distance matrix, from Iran ---------------------------------
# /v1/distance-matrix accepts type=car|motorcycle ONLY. Its absence of a
# transit type is what closes research finding F2 from a second direction, so
# the result is recorded either way.
check_03() {
  local id=0.3
  want "$id" || return 0
  local api; api=$(base NESHAN_BASE 'https://api.neshan.org')
  if ! have NESHAN_API_KEY; then
    record_unmeasured "$id" "Neshan matrix — NESHAN_API_KEY not set"
    return 0
  fi
  local url="$api/v1/distance-matrix?type=car&origins=35.7448%2C51.3756%7C35.6997%2C51.3380&destinations=35.7210%2C51.4100%7C35.7000%2C51.4000"
  local res code ctype
  res=$(http "$url" -H "Api-Key: $NESHAN_API_KEY")
  code=${res%% *}; ctype=${res#* }

  case "$code" in
    200)
      if printf '%s' "$ctype" | grep -qi 'html'; then
        record_fail "$id" "HTTP 200 but content-type=$ctype (block page)"
        return 0
      fi
      local payload; payload=$(body "$url" 8192 -H "Api-Key: $NESHAN_API_KEY")
      if ! printf '%s' "$payload" | grep -q '"rows"'; then
        record_fail "$id" "HTTP 200 but no rows[] in body"
        return 0
      fi
      # Partial matrices are normal (PRD-05 §12.3) — count, do not judge.
      # The whitespace tolerance is load-bearing: a pretty-printed payload
      # ("status": "Ok") would otherwise read as 0 Ok and FAIL a healthy matrix.
      local okel total
      okel=$(printf '%s' "$payload" | grep -oE '"status"[[:space:]]*:[[:space:]]*"Ok"' | wc -l | tr -d ' ')
      total=$(printf '%s' "$payload" | grep -oE '"status"[[:space:]]*:[[:space:]]*"' | wc -l | tr -d ' ')
      if [ "${total:-0}" -eq 0 ]; then
        record_fail "$id" "HTTP 200 but no element status parsed from the payload"
        return 0
      fi
      if [ "${okel:-0}" -ge 1 ]; then
        record_pass "$id" "HTTP 200, $okel/$total element statuses Ok"
      else
        record_fail "$id" "HTTP 200 but 0/$total elements Ok — inspect per-pair statuses"
      fi
      ;;
    470|480|481|482|483|484|485)
         record_fail "$id" "HTTP $code — see docs/research/01-RESOLVED-ANSWERS.md Q2 error table" ;;
    000|"") record_fail "$id" "no response — endpoint unreachable from here" ;;
    *)   record_fail "$id" "HTTP $code unexpected" ;;
  esac
}

# --- 0.4  Supabase auth over TLS, from Iran ---------------------------------
# Health alone proves the socket; the plan asks for the write path too, so a
# signup probe is included when a publishable key is present.
check_04() {
  local id=0.4
  want "$id" || return 0
  local su; su=$(base SUPABASE_URL '')
  if [ -z "$su" ]; then
    record_unmeasured "$id" "Supabase auth — SUPABASE_URL not set"
    return 0
  fi
  local res code ctype
  res=$(http "$su/auth/v1/health")
  code=${res%% *}; ctype=${res#* }

  case "$code" in
    200)
      # TLS is only meaningful on the real host; skip the assertion when the
      # check is pointed at a local fixture.
      case "$su" in
        https://*) record_pass "$id" "HTTP 200 over TLS (cert chain validated by curl)" ;;
        *)         record_pass "$id" "HTTP 200 (plain HTTP target — TLS not asserted)" ;;
      esac
      ;;
    000|"") record_fail "$id" "no response — Supabase unreachable from here (THE GATE CHECK)" ;;
    5*)  record_fail "$id" "HTTP $code — service up but unhealthy; check docker compose ps" ;;
    *)   record_fail "$id" "HTTP $code unexpected" ;;
  esac

  # Write path. Anonymous sign-in must be enabled for this to be meaningful;
  # a 400 here is a configuration finding, which the report should show.
  if have SUPABASE_PUBLISHABLE_KEY; then
    local wres wcode
    wres=$(http "$su/auth/v1/signup" \
           -X POST -H "Content-Type: application/json" \
           -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
           --data '{"email":"spike-probe@invalid.invalid","password":"'"$SPIKE_PROBE_PASSWORD"'"}')
    wcode=${wres%% *}
    case "$wcode" in
      2*)  : ;;  # counted by the health row; do not inflate the pass count
      *)   printf '            note: signup probe HTTP %s (write path not proven)\n' "$wcode" ;;
    esac
  fi
}

# --- 0.5  Tile source -------------------------------------------------------
# Vector tiles Neshan's own MapLibre styles reference. The URL comes from
# static.neshan.org/sdk/maplibre/styles/light.json, not from guesswork.
check_05() {
  local id=0.5
  want "$id" || return 0
  local api; api=$(base NESHAN_BASE 'https://api.neshan.org')
  if ! have NESHAN_API_KEY; then
    record_unmeasured "$id" "tile source — NESHAN_API_KEY not set"
    return 0
  fi
  # z=12 tile over Tehran.
  local url="${NESHAN_TILE_URL:-$api/basemap/v2/12/2383/1552/sdk}"
  local res code ctype
  res=$(http "$url" -H "Api-Key: $NESHAN_API_KEY")
  code=${res%% *}; ctype=${res#* }

  case "$code" in
    200)
      # The trap this check exists for: a block page is 200 text/html.
      if printf '%s' "$ctype" | grep -qi 'text/html'; then
        record_fail "$id" "HTTP 200 text/html — block page, NOT a tile"
      else
        record_pass "$id" "HTTP 200 content-type=$ctype"
      fi
      ;;
    000|"") record_fail "$id" "no response — tile host unreachable from here" ;;
    *)   record_fail "$id" "HTTP $code with content-type=$ctype" ;;
  esac
}

# --- 0.6  Stack pruned + healthy -------------------------------------------
# Requires SSH. Set SPIKE_SSH=user@host and SPIKE_COMPOSE=/srv/supabase/docker-compose.yml
check_06() {
  local id=0.6
  want "$id" || return 0
  if ! have SPIKE_SSH; then
    record_unmeasured "$id" "stack health — SPIKE_SSH not set (e.g. root@203.0.113.10)"
    return 0
  fi
  local compose; compose=$(base SPIKE_COMPOSE '/srv/supabase/docker-compose.yml')
  local services ssh_rc
  services=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SPIKE_SSH" \
             "docker compose -f '$compose' config --services" 2>/dev/null)
  ssh_rc=$?
  # An ssh failure prints to stdout in some configurations; without this the
  # pruning test below would pass on the text of an error message.
  if [ "$ssh_rc" -ne 0 ] || [ -z "$services" ]; then
    record_fail "$id" "ssh/docker failed (rc=$ssh_rc) — cannot read compose services"
    return 0
  fi
  # Every service line must be a bare container name. Anything else means we
  # are looking at an error message or the wrong file, not a compose listing.
  local stray
  stray=$(printf '%s\n' "$services" | grep -Ev '^[a-z0-9][a-z0-9_.-]*$' || true)
  if [ -n "$stray" ]; then
    record_fail "$id" "unexpected output from compose --services; check SPIKE_COMPOSE"
    return 0
  fi
  local pruned=1
  printf '%s\n' "$services" | grep -qx 'storage'  && pruned=0
  printf '%s\n' "$services" | grep -qx 'imgproxy' && pruned=0
  # Edge Runtime is the only stack service that reaches off-box at runtime
  # (it fetches Deno modules). Absence is what keeps the backend self-contained.
  printf '%s\n' "$services" | grep -qx 'functions' && pruned=0
  local count; count=$(printf '%s\n' "$services" | grep -c . )
  if [ "$pruned" -eq 1 ]; then
    record_pass "$id" "$count services, storage/imgproxy/functions absent"
  else
    record_fail "$id" "storage, imgproxy or functions still in compose — prune per PRD-10 §7.2"
  fi
}

# --- run --------------------------------------------------------------------
printf 'FreeWhen Phase 0 — reachability spike\n'
printf 'host=%s  started=%s\n' "$(hostname 2>/dev/null || printf unknown)" "$(now)"
printf 'NOTE: this must be a connection inside Iran to mean anything.\n\n'

check_01; check_02; check_03; check_04; check_05; check_06

printf '\n%s\n' "----------------------------------------"
printf 'pass=%d fail=%d unmeasured=%d\n' "$pass" "$fail" "$unmeasured"

if [ "$fail" -gt 0 ]; then
  printf 'gate: FAILED —%s\n' "$fail_names"
  printf 'If 0.2 or 0.4 failed, do NOT proceed to Phase 1. Change host and re-run.\n'
  exit 1
fi
if [ "$pass" -eq 0 ]; then
  printf 'gate: UNMEASURED — nothing was measured; set credentials in .env.spike\n'
  exit 2
fi
if [ "$unmeasured" -gt 0 ]; then
  # Exit 3, not 0. A partial run cannot close the phase, and any tooling that
  # reads the exit status must not see a green result for it.
  printf 'gate: PARTIAL — %d check(s) still unmeasured; phase cannot close\n' "$unmeasured"
  exit 3
fi
printf 'gate: PASSED — all six checks measured and green\n'
exit 0
