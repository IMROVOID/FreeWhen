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

set -euo pipefail

cd "$(dirname "$0")/../.."

DIST_APK=android/app/build/outputs/apk/release/app-release.apk
OUT_DIR=web/dl
OUT_APK="$OUT_DIR/freewhen.apk"

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

if [[ "${SKIP_GRADLE:-0}" == "1" ]]; then
  echo "   skipped (SKIP_GRADLE=1) — no artifact was produced"
  exit 0
fi

( cd android && ./gradlew assembleRelease )

echo "== 4/4  stage the artifact =="
if [[ ! -f "$DIST_APK" ]]; then
  echo "expected ${DIST_APK} and it is not there — the Gradle task did not run" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
# The download URL is stable (`/dl/freewhen.apk`), because the web/dl page and
# the QR codes already printed on slides point at it. Replacing the file in
# place is the "fix reaches a reviewer the same day" path (AC-13.5.1).
cp "$DIST_APK" "$OUT_APK"

echo "build-apk: ${OUT_APK} ($(du -h "$OUT_APK" | cut -f1))"
echo "           deploy it with the web/ static root, then re-run the /dl/ smoke test"
