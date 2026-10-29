#!/usr/bin/env bash
# Verify one APK before it is allowed near a release.
#
# Every check here exists because of a specific way a build can look successful
# and ship something unusable:
#
#   - the wrong ABI inside the file (installs on an emulator, on no phone)
#   - an unsigned or debug-signed APK released as production
#   - a missing or truncated artifact (a 0-byte upload passes every "uploaded"
#     check, and so does a 2 KB HTML error page)
#   - an APK whose bundle carries no server URL, so the app throws on launch
#     (src/lib/api-base-url.ts falls back to 127.0.0.1 — the phone itself)
#
# Usage: validate-apk.sh <apk-path> <arch> [expected-host]
#   arch: arm64-v8a | armeabi-v7a | x86 | x86_64 | universal
#
# Exits non-zero on the first failing check. Emits GitHub `::error::`
# annotations when GITHUB_ACTIONS is set, a plain message otherwise.
set -uo pipefail

APK="${1:-}"
ARCH="${2:-}"
EXPECTED_HOST="${3:-}"

fail() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error title=APK validation::$*"
  else
    echo "ERROR: $*" >&2
  fi
  exit 1
}

pass() { echo "  OK   $*"; }

# ★ THE ZIP HELPERS FALL BACK TO python3, DELIBERATELY.
#
# `unzip` is on the runner but not on Git Bash for Windows, and this script is
# meant to be runnable on a developer's machine so the checks can be proven
# there rather than discovered broken on a first release.
list_entries() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -Z1 "$1" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    for name in z.namelist():
        print(name)
PY
  else
    return 1
  fi
}

# ★ ASK THE ARCHIVE, DO NOT PIPE A STRING OF EVERY ENTRY.
#
# The membership checks used to be `printf '%s\n' "$ENTRIES" | grep -q …`.
# That is correct for a small file and wrong for a universal APK: it carries
# every ABI's native libraries and tens of thousands of entries, the captured
# string reaches shell limits, and `grep -q` closes the pipe early — the run
# reported
#
#   printf: write error: Broken pipe
#   FreeWhen-v0.1.0-universal.apk is missing classes.dex
#
# on a 147 MB APK that plainly contained `classes.dex`. The artifact was fine;
# the check was not. This asks the archive one name at a time, so size stops
# mattering.
has_member() {
  local apk="$1" pattern="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -Z1 "$apk" 2>/dev/null | grep -qxF "$pattern"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$apk" "$pattern" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    sys.exit(0 if sys.argv[2] in z.namelist() else 1)
PY
  else
    return 2
  fi
}

# Whether ANY entry matches a substring — for `lib/<abi>/`, where the exact
# member name varies with every native dependency.
has_member_matching() {
  local apk="$1" pattern="$2"
  if command -v unzip >/dev/null 2>&1; then
    unzip -Z1 "$apk" 2>/dev/null | grep -qF "$pattern"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$apk" "$pattern" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    sys.exit(0 if any(sys.argv[2] in name for name in z.namelist()) else 1)
PY
  else
    return 2
  fi
}

read_member() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -p "$1" "$2" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$1" "$2" <<'PY'
import sys, zipfile
try:
    with zipfile.ZipFile(sys.argv[1]) as z, z.open(sys.argv[2]) as f:
        sys.stdout.buffer.write(f.read())
except KeyError:
    pass
PY
  fi
}

[ -n "$APK" ] || fail "usage: validate-apk.sh <apk-path> <arch> [expected-host]"
[ -f "$APK" ] || fail "APK not found: $APK"

case "$ARCH" in
  arm64-v8a|armeabi-v7a|x86|x86_64|universal) ;;
  *) fail "unknown architecture '$ARCH'; expected arm64-v8a, armeabi-v7a, x86, x86_64 or universal" ;;
esac

SIZE_BYTES="$(wc -c < "$APK" | tr -d ' ')"
SIZE_MB=$(( SIZE_BYTES / 1048576 ))

echo "Validating $APK"
echo "  arch=$ARCH size=${SIZE_MB}MB (${SIZE_BYTES} bytes)"

# ── 1. A readable archive with the parts an installable app must have ───────
# ★ READABILITY IS CHECKED BEFORE SIZE, AND THE ORDER IS THE DIAGNOSIS.
#
# An HTML error page saved as `.apk` is small too, so a size floor first would
# report "never under 1 MB" for what is really "this is not an APK". The reader
# is told the specific cause, once, in the order that identifies it.
ENTRIES="$(list_entries "$APK")" || fail "$(basename "$APK") is not a readable zip archive — it is probably an HTML error page or a truncated download"
[ -n "$ENTRIES" ] || fail "$(basename "$APK") is an empty or unreadable archive"

# The size floor then catches a truncated-but-valid zip and an implausibly small
# build. An installable React Native APK is tens of megabytes.
[ "$SIZE_BYTES" -gt 1048576 ] || fail "$(basename "$APK") is ${SIZE_BYTES} bytes; an installable APK is never under 1 MB"

for required in AndroidManifest.xml classes.dex resources.arsc; do
  has_member "$APK" "$required" \
    || fail "$(basename "$APK") is missing $required"
done
pass "archive contains AndroidManifest.xml, classes.dex, resources.arsc"

# ── 2. The ABI inside the file matches the ABI in the name ─────────────────
# ★ THIS RUNS BEFORE THE SIZE CHECK, DELIBERATELY.
#
# A universal APK missing three of its four ABIs is both "too small" and "wrong
# contents". The contents are the useful diagnosis — "contains no lib/x86/" names
# what to fix, where "under 8 MB" only says something is wrong.
if [ "$ARCH" = "universal" ]; then
  REQUIRED_ABIS="arm64-v8a armeabi-v7a x86 x86_64"
else
  REQUIRED_ABIS="$ARCH"
fi

for abi in $REQUIRED_ABIS; do
  has_member_matching "$APK" "lib/$abi/" \
    || fail "$(basename "$APK") is labelled $ARCH but contains no lib/$abi/ — the architecture was not built in"
done
pass "native libraries present for: $REQUIRED_ABIS"

if [ "$ARCH" != "universal" ]; then
  for other in arm64-v8a armeabi-v7a x86 x86_64; do
    [ "$other" = "$ARCH" ] && continue
    if has_member_matching "$APK" "lib/$other/"; then
      fail "$(basename "$APK") claims to be $ARCH but also contains lib/$other/; a per-ABI APK carries one ABI"
    fi
  done
  pass "carries exactly one ABI"
fi

# ── 3. Size sanity, so a truncated or exploded build is visible ────────────
if [ "$ARCH" = "universal" ]; then
  # Four ABIs plus assets. Below 8 MB something is missing.
  [ "$SIZE_MB" -ge 8 ] || fail "universal APK is only ${SIZE_MB}MB; a four-ABI build is never under 8MB"
else
  # A Hermes APK with four ABI directories is large; one ABI under 120 MB.
  [ "$SIZE_MB" -le 120 ] || fail "$ARCH APK is ${SIZE_MB}MB; over the 120MB sanity ceiling"
fi
pass "size ${SIZE_MB}MB is within bounds for $ARCH"

# ── 4. Signature ───────────────────────────────────────────────────────────
# `apksigner` ships with the Android SDK build-tools but is not on PATH.
APKSIGNER=""
if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/build-tools" ]; then
  APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
  if [ -z "$APKSIGNER" ]; then
    APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner.bat 2>/dev/null | sort -V | tail -1)"
  fi
fi
if [ -z "$APKSIGNER" ] && command -v apksigner >/dev/null 2>&1; then
  APKSIGNER="$(command -v apksigner)"
fi

if [ -n "$APKSIGNER" ] && [ -f "$APKSIGNER" ]; then
  SIG="$("$APKSIGNER" verify --verbose --print-certs "$APK" 2>&1)"
  SIG_RC=$?

  # ★ "COULD NOT RUN" IS NOT "DID NOT VERIFY".
  #
  # A Windows `apksigner.bat` under a POSIX shell fails to execute, and treating
  # that as an unsigned APK would be a false negative on a good build. The two
  # are distinguished so a skipped check is reported as skipped.
  #
  # ★ A SKIP IS ONLY EVER ALLOWED ON A DEVELOPER'S MACHINE.
  #
  # When `REQUIRE_RELEASE_SIGNING=1` — which the release workflow always sets —
  # an unusable `apksigner` is a HARD FAILURE, never a skip. A release whose
  # signature nobody checked is exactly how unsigned APKs reached v0.1.3.
  if [ "$SIG_RC" -ne 0 ] && printf '%s\n' "$SIG" | grep -qiE 'command not found|syntax error|Exec format error|not recognized'; then
    if [ "${REQUIRE_RELEASE_SIGNING:-0}" = "1" ]; then
      fail "cannot verify a release signature with an unusable apksigner ($APKSIGNER) — refusing to publish an unchecked artifact"
    fi
    echo "  SKIP signature check: $APKSIGNER cannot run in this shell (local run)"
  else
    printf '%s\n' "$SIG" | grep -qi '^Verifies' \
      || fail "$(basename "$APK") does not verify: $(printf '%s' "$SIG" | head -3 | tr '\n' ' ')"
    pass "signature verifies"

    # Only enforced when a real keystore was supplied — the workflow sets
    # REQUIRE_RELEASE_SIGNING=1 when ANDROID_KEYSTORE_BASE64 was present.
    if [ "${REQUIRE_RELEASE_SIGNING:-0}" = "1" ]; then
      # The debug keystore's DN contains "Android Debug". A release APK signed
      # with it installs nowhere but a machine that already trusts the debug
      # key, and every future release is a different app to Android.
      if printf '%s\n' "$SIG" | grep -qi 'Android Debug'; then
        fail "$(basename "$APK") is signed with the DEBUG keystore but a release keystore was supplied. Check that scripts/build/build-apk.sh wrote the signing block into android/gradle.properties."
      fi

      if [ -n "${RELEASE_CERT_SHA256:-}" ]; then
        ACTUAL="$(printf '%s\n' "$SIG" | grep -i 'certificate SHA-256 digest' | head -1 | awk '{print $NF}' | tr -d ':' | tr 'A-F' 'a-f')"
        WANT="$(printf '%s' "$RELEASE_CERT_SHA256" | tr -d ':' | tr 'A-F' 'a-f')"
        [ -n "$ACTUAL" ] || fail "could not read the signer's SHA-256 digest"
        [ "$ACTUAL" = "$WANT" ] || fail "signer digest $ACTUAL does not match the expected release certificate. Publishing this would strand every installed copy."
        pass "signer matches the expected release certificate"
      fi

      pass "signed with a non-debug certificate"
    fi
  fi
else
  # ★ THE `&& fail` FORM WAS A TRAP HERE.
  #
  # `[ cond ] && fail "…"` as the LAST statement of a branch evaluates to
  # false when the condition is false, and that non-zero becomes the branch's
  # status — so a release run without `apksigner` could pass this section with
  # the signature never examined. An explicit `if` cannot be read that way.
  if [ "${REQUIRE_RELEASE_SIGNING:-0}" = "1" ]; then
    fail "cannot verify a release signature: apksigner not found under ANDROID_HOME (${ANDROID_HOME:-unset}) — refusing to publish an unchecked artifact"
  fi
  echo "  SKIP signature check: apksigner not found under ANDROID_HOME (local run)"
fi

# ── 5. The server URL is actually inside the bundle ────────────────────────
# ★ THIS IS THE CHECK THAT CATCHES A SILENTLY EMPTY BUILD-TIME VARIABLE.
#
# Expo substitutes `EXPO_PUBLIC_*` at build time. Absent, the bundle falls back
# to `http://127.0.0.1:8787` — which on a participant's phone is the phone
# itself — and the app opens to a spinner while every "the build succeeded"
# signal is green.
if [ -n "$EXPECTED_HOST" ]; then
  found=0
  # Hermes emits `assets/index.android.bundle`; a non-Hermes build puts the JS
  # in `classes.dex`. Check whichever is present rather than requiring one — and
  # try both names directly, rather than filtering a 147 MB entry list through
  # `grep -o` first.
  for member in assets/index.android.bundle classes.dex; do
    if read_member "$APK" "$member" | grep -qaF "$EXPECTED_HOST"; then
      found=1
      break
    fi
  done
  [ "$found" = "1" ] || fail "server URL '$EXPECTED_HOST' is not in the bundle; EXPO_PUBLIC_APP_BASE_URL / EXPO_PUBLIC_API_URL was empty at build time"
  pass "server URL '$EXPECTED_HOST' is baked into the bundle"
else
  echo "  SKIP server-URL check: no expected host given (mode is not production)"
fi

# ── 6. The checksum the release publishes ─────────────────────────────────
if command -v sha256sum >/dev/null 2>&1; then
  SUM="$(sha256sum "$APK" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  SUM="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
else
  fail "no sha256sum or shasum available to record a checksum"
fi

echo "  OK   sha256 $SUM"
# The publish job re-verifies from this line after downloading every artifact.
#
# ★ THE FORMAT IS `sha256sum -c`'s, EXACTLY.
#
# This wrote `SHA256 <sum> <name>`, and `sha256sum -c` rejected the whole
# manifest:
#
#   sha256sum: SHA256SUMS.txt: no properly formatted checksum lines found
#
# A leading label is not part of the format — `<sum>` then TWO spaces then the
# filename, or `<sum> *<name>` for binary mode. Anything else is "not a checksum
# line", so the release could never be published.
#
# ★ THE NAME IS THE PUBLISHED NAME, WHICH THE VALIDATOR NO LONGER OWNS.
#
# It used to write `basename "$APK"`. The APK is now the Gradle output
# (`app-release.apk`), so the manifest would have named a file the release never
# carries — `sha256sum -c` in the publish job would fail on every entry. The
# caller passes the name it will publish under; `basename` is the fallback for a
# developer running this by hand.
printf '%s  %s\n' "$SUM" "${PUBLISHED_NAME:-$(basename "$APK")}" >> "${SUMS_FILE:-SHA256SUMS.txt}"
exit 0
