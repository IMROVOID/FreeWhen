#!/usr/bin/env bash
# scripts/spike/test-reachability.sh
# Tests the contract of reachability.sh. Runs offline against a local fixture
# server, so it asserts behaviour without needing Iran, a VPS, or a real key.
#
# Contract under test:
#   - exit 0 when every check PASSes
#   - exit 1 when any check FAILs
#   - exit 2 when nothing could be measured at all
#   - a missing credential yields UNMEASURED, never PASS and never FAIL
#   - credentials never appear in stdout, even on failure
#   - --help exits 0 without needing curl or a network
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
subject="$here/reachability.sh"
failures=0

ok()   { printf 'ok    %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

assert_exit() {  # assert_exit <label> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1 (exit $3)"; else bad "$1 (exit $3, wanted $2)"; fi
}

assert_absent() {  # assert_absent <label> <haystack> <needle>
  case "$2" in
    *"$3"*) bad "$1 — found '$3'" ;;
    *)      ok "$1" ;;
  esac
}

# --- 0. the subject exists and is executable -------------------------------
if [ -x "$subject" ]; then ok "reachability.sh is executable"; else
  bad "reachability.sh missing or not executable"
  printf '\n%d failure(s)\n' "$failures"; exit 1
fi

# --- 1. --help needs no network and no credentials ------------------------
out="$(SPIKE_NO_ENV=1 "$subject" --help 2>&1)"; rc=$?
assert_exit "--help" 0 "$rc"
case "$out" in
  *"reachability"*) ok "--help prints usage" ;;
  *) bad "--help does not print usage" ;;
esac

# --- 2. no credentials at all -> nothing measurable -> exit 2 -------------
# SPIKE_NO_ENV stops the script sourcing .env.spike, so this is deterministic
# even on a machine where a real key file happens to exist.
out="$(SPIKE_NO_ENV=1 "$subject" 2>&1)"; rc=$?
assert_exit "no credentials -> exit 2" 2 "$rc"
case "$out" in
  *UNMEASURED*) ok "no credentials -> UNMEASURED reported" ;;
  *)            bad "no credentials -> UNMEASURED not reported" ;;
esac
case "$out" in
  *"PASS        0.2"*) bad "missing key must not PASS 0.2" ;;
  *)             ok "missing key does not PASS 0.2" ;;
esac

# --- 3. a credential must never be echoed ---------------------------------
sentinel="SPIKE_SENTINEL_SECRET_$$"
out="$(SPIKE_NO_ENV=1 NESHAN_API_KEY="$sentinel" SPIKE_HOST=127.0.0.1:1 \
       "$subject" 2>&1)"; rc=$?
assert_absent "key never echoed" "$out" "$sentinel"
assert_exit "unreachable host FAILs (exit 1)" 1 "$rc"

# --- 3a. an unknown check id must fail loudly, not run nothing -------------
# Previously this ran zero checks and exited 2, which is indistinguishable from
# "no credentials" — a typo would look like an unmeasured run.
out="$(SPIKE_NO_ENV=1 "$subject" 0.9 2>&1)"; rc=$?
assert_exit "unknown check id -> exit 2" 2 "$rc"
case "$out" in
  *"unknown check id"*) ok "unknown check id is named" ;;
  *)                    bad "unknown check id is not named" ;;
esac

# --- 4. a live PASS path, via a local fixture server ----------------------
# Serves the exact payload shapes Neshan and Supabase return, so a green run
# here proves the assertion logic, not the network.
if command -v curl >/dev/null 2>&1; then
  port=$(( 20000 + ($$ % 20000) ))
  fixture_dir="$(mktemp -d)"
  # Folder names must mirror the real paths, so the checks hit real URL shapes.
  mkdir -p "$fixture_dir/v4" "$fixture_dir/v1" "$fixture_dir/auth/v1" "$fixture_dir/basemap/v2/12/2383/1552"
  printf '{"routes":[{"overview_polyline":{"points":"abc"},"legs":[]}]}' > "$fixture_dir/v4/direction"
  printf '{"status":"Ok","rows":[{"elements":[{"status": "Ok","duration":{"value":699}}]}]}' > "$fixture_dir/v1/distance-matrix"
  printf '{"version":"10"}' > "$fixture_dir/auth/v1/health"
  # A vector tile served as octet-stream: present, but NOT text/html.
  printf '\x1a\x00\x00' > "$fixture_dir/basemap/v2/12/2383/1552/sdk"

  # A tiny static server. python3 is present on any Linux VPS per PRD-10.
  ( cd "$fixture_dir" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 ) &
  server_pid=$!
  # Give the server a moment; poll rather than sleep blindly.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sS -o /dev/null "http://127.0.0.1:$port/auth/v1/health" 2>/dev/null; then break; fi
    sleep 0.2
  done

  out="$(SPIKE_NO_ENV=1 \
         NESHAN_API_KEY=fake-key-for-fixture \
         NESHAN_BASE="http://127.0.0.1:$port" \
         SUPABASE_URL="http://127.0.0.1:$port" \
         SPIKE_INSECURE=1 \
         "$subject" 2>&1)"; rc=$?

  kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  rm -rf "$fixture_dir"

  case "$out" in
    *"PASS        0.2"*) ok "fixture: directions PASSes on routes[]" ;;
    *)             bad "fixture: directions did not PASS" ;;
  esac
  # The payload above is spaced ("status": "Ok") on purpose: a whitespace-blind
  # matcher reads a healthy matrix as 0 Ok and FAILs a gate check.
  case "$out" in
    *"PASS        0.3"*) ok "fixture: spaced matrix PASSes" ;;
    *)             bad "fixture: spaced matrix did not PASS" ;;
  esac
  case "$out" in
    *"PASS        0.4"*) ok "fixture: auth health PASSes" ;;
    *)             bad "fixture: auth health did not PASS" ;;
  esac
  assert_absent "fixture: key never echoed" "$out" "fake-key-for-fixture"
  # 0.1 and 0.6 stay UNMEASURED here, so the run must report PARTIAL (3), never
  # a green 0 — a phase that cannot close must not exit as if it did.
  assert_exit "fixture: partial run -> exit 3" 3 "$rc"
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
  printf 'all contract tests pass\n'; exit 0
fi
printf '%d failure(s)\n' "$failures"; exit 1
