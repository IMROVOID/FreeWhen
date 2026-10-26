#!/usr/bin/env bash
#
# scripts/build/build-apk.sh — the Android build, locally, with no Expo account.
#
# ★ NO EAS, NO EXPO LOGIN, NO BUILD QUEUE.
#
# EAS Build is a US service with no published policy for Iran residents, so
# delegating the build to it reintroduces the exact question the whole
# submission exists to sidestep (AC-10.1.1). `expo prebuild` + Gradle runs on
# this machine, needs no account, and the artifact is a file. That is also the
# rollback strategy: a fix reaches a reviewer the same day (PRD-13 §8).
#
# ★ THE KEYSTORE IS THE WHOLE UPDATE PATH.
#
# Android refuses an update signed by a different key. Lose the keystore and
# every build from here on is a NEW app that cannot be installed over the old
# one — the installed participants are stranded with no error message that
# explains why. The file lives outside the repo and its location belongs in the
# README (KEYSTORE_STORAGE). This script fails when it is missing, rather than
# producing an unsigned build that looks like a success.
#
# ★ THE APK IS THE SECONDARY PATH.
#
# The reviewer never needs it — the web export carries steps 1–4. It is built
# for the participant experience and for the honest "install" affordance on
# /dl/, which is why the Play Protect note there is part of the deliverable and
# not a footnote.
#
# Usage:
#   bash scripts/build/build-apk.sh
#
# Environment (see the README):
#   FREE_WHEN_RELEASE_STORE_FILE      path to freewhen-release.keystore
#   FREE_WHEN_RELEASE_STORE_PASSWORD  the store password
#   FREE_WHEN_RELEASE_KEY_ALIAS       the key alias (default: freewhen)
#   FREE_WHEN_RELEASE_KEY_PASSWORD    the key password (defaults to the store one)
#   APK_ARCHS                         a single ABI to build, or empty (see below)
#   UNIVERSAL_APK                     1 = this run is producing the universal APK
#
# ★ APK_ARCHS IS HOW ONE ABI IS BUILT; ITS ABSENCE IS HOW ALL OF THEM ARE.
#
# `android/gradle.properties` declares `reactNativeArchitectures` for four ABIs,
# and Gradle emits `app-<abi>-release.apk` for each *plus* an un-suffixed
# `app-release.apk` containing all of them. Historically this script only looked
# at the un-suffixed file, so every release carried all ABIs under one name and
# the per-ABI outputs were discarded.
#
# Setting `APK_ARCHS=arm64-v8a` passes
# `-PreactNativeArchitectures=arm64-v8a`, which makes the per-ABI output the only
# one produced. Leaving it empty reproduces the previous behaviour exactly — the
# universal artifact — so a caller that says nothing gets what it always got.
#
# ★ THE TWO FORMS NEED TWO RUNS.
#
# The universal artifact is not a fifth `-P` value: it is what Gradle emits when
# the property is *absent*. Building both in one invocation would have the
# per-ABI task overwrite the shared output directory, which is why the release
# workflow invokes this script once per ABI and once more with `APK_ARCHS` unset.

set -euo pipefail

cd "$(dirname "$0")/../.."

OUT_DIR=web/dl
OUT_APK="$OUT_DIR/freewhen.apk"

# ★ `UNIVERSAL` IS NOT AN ABI, AND GRADLE SAYS SO.
#
# The workflow's matrix names the fifth build `universal`, and it arrives here as
# `APK_ARCHS=universal`. Passed through to `-PreactNativeArchitectures`, Gradle
# refuses the whole project:
#
#   [CXX1201] ABIs [universal] are not supported
#   Supported ABIs are [arm64-v8a, armeabi-v7a, riscv64, x86, x86_64]
#
# So the sentinel is normalised to "no arch filter" here, which is what actually
# produces the all-ABI artifact. Doing it in the script rather than in a GitHub
# expression is deliberate: `cond && '' || value` cannot yield an empty string,
# because an empty string is falsy in those expressions.
if [[ "${APK_ARCHS:-}" == "universal" ]]; then
  APK_ARCHS=""
  UNIVERSAL_APK=1
fi

# ★ THE OUTPUT IS ALWAYS `app-release.apk`, WHATEVER `APK_ARCHS` SAYS.
#
# This used to expect `app-${APK_ARCHS}-release.apk`, on the theory that Gradle
# suffixes the artifact per ABI. It does not: the template `expo prebuild`
# generates has no `splits` block and no `archivesBaseName` of its own, so
# `assembleRelease` writes one un-suffixed APK in every case. `-P
# reactNativeArchitectures=x86` selects WHICH ABIs go INSIDE that APK; it does not
# rename it.
#
# The old expectation made every per-ABI run fail after a successful build
# ("expected app-x86-release.apk and it is not there — the Gradle task did not
# run") on a run whose log ended in BUILD SUCCESSFUL.
APK_OUTPUT_DIR=android/app/build/outputs/apk/release
DIST_APK="$APK_OUTPUT_DIR/app-release.apk"

echo "== 1/4  release gates =="
# Both artifacts are built from the same source, and a key that reaches the APK
# is a key that reaches a stranger's phone. `gate:web` needs `dist/`, so it is
# not part of this run — the native bundle is scanned by `gate:secrets`.
npm run gate:secrets
npm run gate:location
npm run gate:engine-purity
npm run gate:logs
npm run gate:design
npm run gate:i18n

echo "== 2/4  keystore =="
if [[ -z "${FREE_WHEN_RELEASE_STORE_FILE:-}" ]]; then
  echo "FREE_WHEN_RELEASE_STORE_FILE is unset." >&2
  echo "Generate the keystore ONCE (keytool -genkeypair ...) and store it OUTSIDE" >&2
  echo "the repo; the location belongs in the README. Without it no future build" >&2
  echo "can update an installed app." >&2
  exit 1
fi

if [[ ! -f "${FREE_WHEN_RELEASE_STORE_FILE}" ]]; then
  echo "keystore not found at ${FREE_WHEN_RELEASE_STORE_FILE}" >&2
  exit 1
fi

echo "== 3/4  prebuild + assembleRelease =="
# `prebuild` regenerates android/ from app.json. It is idempotent for an
# unchanged config; `--no-install` keeps it from re-resolving node_modules on
# every build.
npx expo prebuild --platform android --no-install

# The signing config is written into gradle.properties, which is gitignored.
# A committed keystore password is the single worst credential to leak here: it
# is unrotatable without shipping an app update that nobody can install.
GRADLE_PROPS=android/gradle.properties
{
  echo ""
  echo "# Written by scripts/build/build-apk.sh — gitignored, never committed."
  echo "FREE_WHEN_RELEASE_STORE_FILE=${FREE_WHEN_RELEASE_STORE_FILE}"
  echo "FREE_WHEN_RELEASE_STORE_PASSWORD=${FREE_WHEN_RELEASE_STORE_PASSWORD:-}"
  echo "FREE_WHEN_RELEASE_KEY_ALIAS=${FREE_WHEN_RELEASE_KEY_ALIAS:-freewhen}"
  echo "FREE_WHEN_RELEASE_KEY_PASSWORD=${FREE_WHEN_RELEASE_KEY_PASSWORD:-${FREE_WHEN_RELEASE_STORE_PASSWORD:-}}"
} >> "$GRADLE_PROPS"

# ★ AN EMPTY ARRAY NEEDS THE `${ARR[@]+…}` GUARD UNDER `set -u`.
#
# Bash 4.4+ expands an empty `"${ARCH_ARGS[@]}"` to nothing, but bash 3.2 — which
# is what `/bin/bash` is on macOS — raises "unbound variable" instead. The guard
# is what lets a developer on either shell run the universal path.
ARCH_ARGS=()
if [[ -n "${APK_ARCHS:-}" ]]; then
  ARCH_ARGS=(-PreactNativeArchitectures="$APK_ARCHS")
  echo "   architectures: $APK_ARCHS -> $(basename "$DIST_APK")"
else
  echo "   architectures: all (universal) -> $(basename "$DIST_APK")"
fi

# ★ A STALE APK WOULD PASS THE EXISTENCE CHECK.
#
# The artifact name is the same for every run now, so a previous build's
# `app-release.apk` sitting in the output directory would satisfy the check below
# even if THIS run produced nothing — and the wrong ABI mix would ship under the
# right name. Clearing it first makes the file's presence proof that Gradle wrote
# it.
rm -f "$DIST_APK"

if [[ "${SKIP_GRADLE:-0}" == "1" ]]; then
  echo "   skipped (SKIP_GRADLE=1) — no artifact was produced"
  exit 0
fi

( cd android && ./gradlew assembleRelease ${ARCH_ARGS[@]+"${ARCH_ARGS[@]}"} )
echo "== 4/4  stage the artifact =="
if [[ ! -f "$DIST_APK" ]]; then
  echo "expected ${DIST_APK} and it is not there — the Gradle task did not run" >&2
  echo "the release output directory holds:" >&2
  # Listing the directory is the difference between "the build failed" and "the
  # build succeeded with a name nobody predicted" — and the second is the one
  # that ships the wrong artifact.
  if [[ -d "$APK_OUTPUT_DIR" ]]; then
    ( cd "$APK_OUTPUT_DIR" && ls -1 2>/dev/null | sed 's/^/   /' >&2 ) || true
  else
    echo "   (the directory does not exist)" >&2
  fi
  exit 1
fi

mkdir -p "$OUT_DIR"
# The download URL is stable (`/dl/freewhen.apk`), because the web/dl page and
# the QR codes already printed on slides point at it. Replacing the file in
# place is the "fix reaches a reviewer the same day" path (AC-13.5.1).
#
# ★ IN A PER-ABI RUN THIS COPY IS A SCRATCH FILE, NOT THE PUBLICATION.
#
# The release workflow renames and uploads it; `/dl/freewhen.apk` on a host is
# only ever written by the deploy path. Keeping the copy here means the local
# build flow still ends with an APK where a human expects to find one.
cp "$DIST_APK" "$OUT_APK"

ARCH_LABEL="${APK_ARCHS:-universal}"
if [[ "${UNIVERSAL_APK:-0}" == "1" ]]; then
  ARCH_LABEL=universal
fi

echo "build-apk: ${OUT_APK} ($(du -h "$OUT_APK" | cut -f1), ${ARCH_LABEL})"
echo "           deploy it with the web/ static root, then re-run the /dl/ smoke test"
