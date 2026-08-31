#!/usr/bin/env bash
# One-shot device QA install: debug APK with JS **embedded** (no Metro).
# Fixes the "Unable to load script" / adb reverse death spiral that blocked
# Maestro, Cashfree, and Macrobenchmark when the debug variant skipped bundling.
#
# Prereq: host-GPU emulator already booted (`scripts/avd.sh boot play`).
# Hot reload: temporarily restore debuggableVariants = ["debug"] in
# android/app/build.gradle and use `npm start` + `adb reverse tcp:8081 tcp:8081`.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! adb devices | grep -qE 'device$'; then
  echo "qa-device: no adb device. Boot: scripts/avd.sh boot play (leave Terminal open)"
  exit 1
fi

echo "qa-device: installing debug with embedded bundle (arm64)…"
./android/gradlew -p android :app:installDebug \
  -x lint -x test \
  -PreactNativeArchitectures=arm64-v8a

adb shell am force-stop com.companionchat || true
adb shell am start -n com.companionchat/.MainActivity
echo "qa-device: launched. No Metro required."
