#!/usr/bin/env bash
# Install a Metro-served debug build on the connected device and wire hot reload.
#
# The default debug build embeds the JS bundle (see debuggableVariants in
# android/app/build.gradle) so QA and Maestro never depend on a dev server. That
# also means a plain `installDebug` runs whatever JS was bundled at build time and
# ignores Metro entirely — which is invisible until you notice your edits do not
# show up. This script is the explicit opposite: no embedded bundle, Metro over
# `adb reverse`, and the debug network-security config already permits cleartext
# to localhost for exactly this.
#
# Usage: scripts/dev-device.sh [ANDROID_SERIAL]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
if [ -n "${1:-}" ]; then export ANDROID_SERIAL="$1"; fi
curl -fs http://localhost:8081/status >/dev/null || { echo "Metro is not running: npm start"; exit 1; }
adb reverse tcp:8081 tcp:8081
( cd "$ROOT/android" && ./gradlew :app:installDebug \
  -PmetroHotReload \
  -PreactNativeDevServerPort=8081 \
  -PreactNativeArchitectures=arm64-v8a \
  -x lint \
  -x test \
  --no-configuration-cache \
  --console=plain )
if unzip -l "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" |
  grep -q index.android.bundle; then
  echo "ERROR: the APK still embeds a bundle; the metroHotReload flag did not apply" >&2
  exit 1
fi
adb shell am start -n com.companionchat/.MainActivity >/dev/null
echo "Metro-served debug build installed. Edits hot-reload; a cold start fetches the bundle from Metro."
