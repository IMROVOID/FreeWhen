#!/usr/bin/env bash
# scripts/spike/gate-secrets.sh
#
# Secret-hygiene gate. Fails if a credential VALUE is written down in the spike
# artifacts.
#
# Scope: documentation is checked strictly, because that is where a real key
# gets pasted. Executable scripts are exempt — they pass keys as variable
# references and use throwaway fixture values, neither of which is a credential.
#   scripts/spike/*.sh        exempt
#   scripts/spike/.env.spike* exempt (gitignored; holds the real values)
#   docs/spike/**             checked
#
# Prints only file:line, never the matched text — a gate that echoes the secret
# it found has just written it into a second place.
set -uo pipefail

[ -d "scripts/spike" ] || { printf 'run from the repository root\n' >&2; exit 2; }
[ -d "docs/spike" ] || { printf 'docs/spike missing — nothing to check\n' >&2; exit 2; }

# Detecting "name = value" by separator does not survive contact with reports:
# a markdown table separates with a pipe, a fenced block puts the value on the
# next line, and a value can be shorter than any arbitrary threshold. So match
# the credential SHAPE instead — a long opaque token — wherever it appears.
shapes=(
  'eyJ[A-Za-z0-9_-]{10,}'                       # JWT (Supabase, Bearer tokens)
  'sb_(secret|publishable)_[A-Za-z0-9_-]{8,}'   # Supabase key prefix
  '\bsk-[A-Za-z0-9_-]{16,}'                     # OpenAI-style
  # A long unbroken alphanumeric run. Anchored on non-alphanumerics so ordinary
  # prose and URLs never match — only something deliberately opaque does.
  '(^|[^A-Za-z0-9])[A-Za-z0-9]{24,}([^A-Za-z0-9]|$)'
)

# Passwords are the one credential with no memorable shape, so they keep a
# name-based rule. Without this, a 10-character DB password reads as clean.
weak='(password|passwd|pwd|secret|token|apikey|api_key)[[:space:]]*[=:][[:space:]]*["'"'"'`]?[A-Za-z0-9_!@#$%^&*+-]{8,}'

leak_in() {  # leak_in <file> -> line numbers
  local f="$1" pat
  for pat in "${shapes[@]}"; do
    grep -En "$pat" "$f" 2>/dev/null | cut -d: -f1
  done
  # Only flag the weak rule when the value is not a reference or placeholder.
  grep -Ein "$weak" "$f" 2>/dev/null | grep -Ev '\$|<|REDACTED|redacted|none' | cut -d: -f1
}

found=0
while IFS= read -r f; do
  case "$f" in
    *.sh|*.example|*.gitignore|*/.env.spike) continue ;;
  esac
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    printf 'REDACTED  %s:%s\n' "$f" "$n"
    found=1
  done < <(leak_in "$f" | sort -un)
done < <(find scripts/spike docs/spike -type f 2>/dev/null)

if [ "$found" -eq 1 ]; then
  printf '\ngate: FAILED — a credential-shaped value is written down. Rotate it now.\n'
  exit 1
fi
printf 'gate: clean — no credential-shaped value in the spike documentation\n'
exit 0
