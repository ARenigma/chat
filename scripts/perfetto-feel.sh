#!/usr/bin/env bash
# Perfetto trace for FrameTimeline + VSYNC-app tracks.
#
# Records a Perfetto trace configured for the two data sources that expose
# per-frame timing on Android, pulls the trace off the device, and prints
# where it landed and how to open it.
#
# References (read before writing this script — RULE 1):
#   https://perfetto.dev/docs/data-sources/frametimeline
#   https://perfetto.dev/docs/quickstart/android-tracing
#
# ---------------------------------------------------------------------------
# On-device binary and minSdk note
# ---------------------------------------------------------------------------
# The `adb shell perfetto` binary is shipped as part of Android 10 (API 29)
# and later. This project's minSdk is 24 (Android 7), so this script CANNOT
# be used on Android 7-9 devices. On those devices the on-device binary does
# not exist and adb will exit with an error. This is intentional: frame-rate
# measurement is only meaningful on the S22 (API 36) and the Redmi (API 29)
# — exactly at the API 29 floor.
#
# The textproto config is passed to the on-device binary on stdin via the
# --config - --txt flags, which are available from Android 10 onwards.
# https://perfetto.dev/docs/quickstart/android-tracing#recording-a-trace-on-android
#
# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
#   npm run android:perfetto                             # 10-second trace
#   npm run android:perfetto -- -d 20                   # 20-second trace
#   npm run android:perfetto -- -d 10 -p com.other.app  # other package
#   npm run android:perfetto -- -s R3CN70FAKE123        # specific device serial
#   ADB=/custom/adb npm run android:perfetto
#
# Output is written to /tmp/perfetto-feel-<timestamp>.perfetto-trace on the
# host. Open it at https://ui.perfetto.dev (File > Open trace file).
# Look for the "FrameTimeline" section and the "VSYNC-app" track.

set -euo pipefail

DURATION=10
PACKAGE="com.companionchat"
SERIAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--duration) DURATION="$2"; shift 2 ;;
    -p|--package)  PACKAGE="$2";  shift 2 ;;
    -s|--serial)   SERIAL="$2";   shift 2 ;;
    *) printf 'perfetto-feel: unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve adb — mirrors the same resolution order as scripts/framestats.mjs
# so both tools reach the same binary without requiring a separate setup step.
# ---------------------------------------------------------------------------
resolve_adb() {
  # 1. Explicit override
  if [[ -n "${ADB:-}" && -x "${ADB}" ]]; then
    printf '%s' "${ADB}"
    return
  fi
  # 2. sdk.dir from android/local.properties (the canonical per-machine location)
  local props
  props="$(cd "$(dirname "$0")/.." && pwd)/android/local.properties"
  if [[ -f "$props" ]]; then
    local sdk_dir
    sdk_dir="$(grep '^sdk\.dir=' "$props" | cut -d= -f2-)"
    if [[ -n "$sdk_dir" && -x "$sdk_dir/platform-tools/adb" ]]; then
      printf '%s' "$sdk_dir/platform-tools/adb"
      return
    fi
  fi
  # 3. Known Homebrew and system paths
  local candidates=(
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
    "/opt/homebrew/bin/adb"
    "/usr/local/bin/adb"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      printf '%s' "$c"
      return
    fi
  done
  # 4. Hope it is on PATH
  printf '%s' "adb"
}

ADB_BIN="$(resolve_adb)"

adb_run() {
  if [[ -n "$SERIAL" ]]; then
    "$ADB_BIN" -s "$SERIAL" "$@"
  else
    "$ADB_BIN" "$@"
  fi
}

DURATION_MS=$(( DURATION * 1000 ))
ON_DEVICE_PATH="/data/misc/perfetto-traces/feel-${PACKAGE}.perfetto-trace"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOCAL_PATH="/tmp/perfetto-feel-${TIMESTAMP}.perfetto-trace"

printf 'perfetto-feel: recording %ds trace for %s\n' "$DURATION" "$PACKAGE"
printf '  data sources : FrameTimeline + linux.ftrace (gfx / view / sched)\n'
printf '  on-device    : %s\n' "$ON_DEVICE_PATH"
printf '  local output : %s\n' "$LOCAL_PATH"
printf '\n'
printf '  Keep the app in the foreground and drive the flow you want to measure.\n'
printf '  The trace will stop automatically after %d seconds.\n' "$DURATION"
printf '\n'

# ---------------------------------------------------------------------------
# Record the trace.
#
# The config is piped to the on-device perfetto binary on stdin. Two data
# sources are configured:
#
# android.surfaceflinger.frametimeline
#   Emits actual-timeline and expected-timeline slices for every app surface.
#   The Perfetto UI renders these as the "FrameTimeline" section. The per-
#   frame slice names and the "FrameMissed" annotations come from this source.
#   https://perfetto.dev/docs/data-sources/frametimeline
#
# linux.ftrace / atrace
#   Restricts the event stream to our package via atrace_apps so the trace
#   does not fill with system noise. The gfx category adds Choreographer and
#   hardware-layer fence events that populate the "VSYNC-app" track; view adds
#   layout and draw events; sched adds thread-wakeup edges.
#   https://perfetto.dev/docs/quickstart/android-tracing
# ---------------------------------------------------------------------------
adb_run shell perfetto \
  --config - \
  --txt \
  --out "$ON_DEVICE_PATH" <<TEXTPROTO
duration_ms: ${DURATION_MS}
buffers {
  size_kb: 65536
  fill_policy: RING_BUFFER
}
data_sources {
  config {
    name: "android.surfaceflinger.frametimeline"
  }
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      atrace_apps: "${PACKAGE}"
      atrace_categories: "gfx"
      atrace_categories: "view"
      atrace_categories: "sched"
    }
  }
}
TEXTPROTO

printf '\nperfetto-feel: trace recorded. Pulling off device ...\n'
adb_run pull "$ON_DEVICE_PATH" "$LOCAL_PATH"
adb_run shell rm -f "$ON_DEVICE_PATH"

printf '\nperfetto-feel: trace written to:\n'
printf '  %s\n' "$LOCAL_PATH"
printf '\nOpen it in the Perfetto UI:\n'
printf '  https://ui.perfetto.dev\n'
printf '  File > Open trace file > select the file above\n'
printf '\nWhat to look for:\n'
printf '  FrameTimeline track — per-surface actual vs expected slices;\n'
printf '    red slices are missed frames.\n'
printf '  VSYNC-app track — choreographer wakeups; period should be ~8.3ms\n'
printf '    on a 120Hz panel (the S22) and ~16.7ms on the 60Hz Redmi.\n'
