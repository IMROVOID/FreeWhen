#!/usr/bin/env bash
# scripts/spike/test-gate-secrets.sh
#
# Every case here exists because it was once a real gap or a real false alarm.
# The gate has to catch a pasted credential in any report layout, and stay quiet
# on documentation that merely talks about credentials.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

pass=0; fail=0
check() {  # check <want 0|1> <label> <content>
  local want="$1" label="$2" content="$3"
  printf '%s\n' "$content" > docs/spike/_probe.md
  bash scripts/spike/gate-secrets.sh >/dev/null 2>&1
  local got=$?
  rm -f docs/spike/_probe.md
  if [ "$got" = "$want" ]; then
    printf 'ok    %s\n' "$label"; pass=$((pass + 1))
  else
    printf 'FAIL  %s (rc %s, want %s)\n' "$label" "$got" "$want"; fail=$((fail + 1))
  fi
}

# --- must be caught ---------------------------------------------------------
check 1 "JWT in prose"          'token eyJhbGciOiJIUzI1NiIsInR5cCI6'
check 1 "supabase-prefixed key" 'SUPABASE_SECRET_KEY=sb_secret_9f8e7d6c5b4a2e'
check 1 "markdown table cell"   '| NESHAN_API_KEY | eyJhbGciOiJIUzI1NiIs |'
check 1 "value on next line"    '"api_key": "abc123def456ghi789jklmnopqrstuv"'
check 1 "short password"        'password=abcdefghij'
check 1 "backtick-wrapped"      'set KEY=`eyJhbGciOiJIUzI1NiIs`'

# --- must stay quiet --------------------------------------------------------
check 0 "plain prose"           'Status: UNMEASURED. No credential recorded here.'
check 0 "variable reference"    'curl -H "Api-Key: $NESHAN_API_KEY" https://x'
check 0 "angle placeholders"    'POSTGRES_PASSWORD=<server only>'
check 0 "an endpoint URL"       'Endpoint: https://api.neshan.org/v1/distance-matrix'
check 0 "a repository path"     'Recorded in docs/spike/REACHABILITY.md by the script.'
check 0 "the pinned-tag state"  'PINNED=none'

# --- the repository as it actually stands -----------------------------------
check 0 "repository is clean"   ''

printf '\npass=%d fail=%d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
