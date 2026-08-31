#!/usr/bin/env bash
# Capture Play Console screenshots → exact 9:16 PNG.
# Phone: 1080×1920 · Tablet 7": 1440×2560
# Play: PNG/JPEG ≤8MB, 16:9 or 9:16, each side 320–3840.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHONE_OUT="$ROOT/play-upload/03-phone-screenshots"
TAB_OUT="$ROOT/play-upload/07-tablet-7in-screenshots"
mkdir -p "$PHONE_OUT" "$TAB_OUT"

usage() {
  echo "usage: $0 phone <serial> <slug>   # → 1080×1920 9:16"
  echo "       $0 tablet <serial> <slug>  # → 1440×2560 9:16"
  exit 1
}

role="${1:-}"; serial="${2:-}"; slug="${3:-}"
[[ -n "$role" && -n "$serial" && -n "$slug" ]] || usage

case "$role" in
  phone)  out="$PHONE_OUT/screenshot-${slug}.png"; tw=1080; th=1920 ;;
  tablet) out="$TAB_OUT/screenshot-${slug}.png";   tw=1440; th=2560 ;;
  *) usage ;;
esac

tmp="$(mktemp -t playcap).png"
adb -s "$serial" exec-out screencap -p >"$tmp"

# Center-crop to exact 9:16 then scale.
# Tall phones (e.g. 1080×2316): crop height. Wide panels: crop width.
ffmpeg -y -loglevel error -i "$tmp" \
  -vf "scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th}" \
  "$out"
rm -f "$tmp"

bytes=$(wc -c <"$out" | tr -d ' ')
echo "wrote $out (${tw}x${th}, ${bytes} bytes)"
file "$out"
