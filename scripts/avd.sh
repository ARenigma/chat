#!/usr/bin/env bash
# Recreate a matrix AVD on demand. AVDs bloat to 6-9GB from accumulated userdata,
# so we do NOT keep them all resident — the system images (already downloaded) are
# the durable part, and an AVD is recreatable from one in seconds. See ADR-0017.
#
# Hardware acceleration (mandatory for any meaningful device QA / Macrobenchmark):
#   https://developer.android.com/studio/run/emulator-acceleration
#   https://developer.android.com/studio/run/emulator-troubleshooting
#   - CPU: Hypervisor.Framework (macOS Apple Silicon) — `emulator -accel-check`
#   - GPU: host GLES — NEVER swiftshader_indirect for day-to-day or jank numbers
#     (audit previously recorded SwiftShader as making every frame metric worthless)
#
# Apple Silicon / MoltenVK (System UI ANR + ADB death):
#   On Darwin arm64, `-gpu host` enables MoltenVK for Vulkan. That path starves
#   SystemUI's render thread → "System UI isn't responding", ADB offline, dead taps.
#   Google's sanctioned workaround: keep host GLES, disable Vulkan:
#     emulator … -gpu host -feature -Vulkan
#   Maestroq reproduced the same: host → SystemUI ANR; GLES without Vulkan stays fast.
#
# Usage:
#   scripts/avd.sh floor|play|profile|tablet|fold   # recreate + accelerate
#   scripts/avd.sh boot play|profile|floor|…        # launch stable host GPU
#   scripts/avd.sh accelerate                       # fix gpu/ram/cores on existing AVDs
#   scripts/avd.sh kill                             # stop all emulators + adb reset
set -euo pipefail
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

# Apple Silicon: disable Vulkan so host GLES does not go through MoltenVK.
# Other hosts: leave Vulkan on (empty flag).
gpu_boot_flags() {
  local arch
  arch="$(uname -m)"
  if [[ "$(uname -s)" == "Darwin" && "$arch" == "arm64" ]]; then
    echo "-gpu host -accel on -feature -Vulkan"
  else
    echo "-gpu host -accel on"
  fi
}

accelerate_ini() {
  local cfg="$1"
  [[ -f "$cfg" ]] || return 0
  # doc: developer.android.com/studio/run/emulator-acceleration
  perl -i -pe 's/^hw\.gpu\.enabled=.*/hw.gpu.enabled=yes/' "$cfg"
  if rg -q '^hw\.gpu\.enabled=' "$cfg"; then :; else echo 'hw.gpu.enabled=yes' >>"$cfg"; fi
  perl -i -pe 's/^hw\.gpu\.mode=.*/hw.gpu.mode=host/' "$cfg"
  if rg -q '^hw\.gpu\.mode=' "$cfg"; then :; else echo 'hw.gpu.mode=host' >>"$cfg"; fi
  perl -i -pe 's/^hw\.ramSize=.*/hw.ramSize=4096/' "$cfg"
  if rg -q '^hw\.ramSize=' "$cfg"; then :; else echo 'hw.ramSize=4096' >>"$cfg"; fi
  perl -i -pe 's/^hw\.cpu\.ncore=.*/hw.cpu.ncore=6/' "$cfg"
  if rg -q '^hw\.cpu\.ncore=' "$cfg"; then :; else echo 'hw.cpu.ncore=6' >>"$cfg"; fi
  # Cold boot by default after GPU/Vulkan flips — Quick Boot snapshots from a
  # different renderer (or MoltenVK-era boots) leave SystemUI wedged.
  # doc: developer.android.com/studio/run/emulator-troubleshooting
  perl -i -pe 's/^fastboot\.forceFastBoot=.*/fastboot.forceFastBoot=no/' "$cfg"
  if rg -q '^fastboot\.forceFastBoot=' "$cfg"; then :; else echo 'fastboot.forceFastBoot=no' >>"$cfg"; fi
  perl -i -pe 's/^fastboot\.forceColdBoot=.*/fastboot.forceColdBoot=yes/' "$cfg"
  if rg -q '^fastboot\.forceColdBoot=' "$cfg"; then :; else echo 'fastboot.forceColdBoot=yes' >>"$cfg"; fi
}

wipe_bad_snapshots() {
  local avd_dir="$1"
  # Snapshots taken under a different renderer crash or ANR on reload.
  rm -rf "${avd_dir}/snapshots/default_boot" 2>/dev/null || true
}

avd_name() {
  case "$1" in
    floor)   echo cc_api24 ;;
    play)    echo cc_api36_play ;;
    profile) echo cc_api34_profile ;;
    tablet)  echo cc_api34_tablet ;;
    fold)    echo cc_api34_fold ;;
    *) return 1 ;;
  esac
}

cmd="${1:-}"
case "$cmd" in
  kill)
    # Stop every qemu + adb so a wedged SystemUI cannot hold the port.
    pkill -f 'qemu-system-aarch64|qemu-system-x86_64' 2>/dev/null || true
    pkill -f '/emulator/emulator ' 2>/dev/null || true
    sleep 1
    adb kill-server 2>/dev/null || true
    adb start-server >/dev/null
    echo "emulators killed; adb restarted"
    exit 0
    ;;
  accelerate)
    shopt -s nullglob 2>/dev/null || true
    for cfg in "$HOME"/.android/avd/*.avd/config.ini; do
      accelerate_ini "$cfg"
      echo "accelerated $(basename "$(dirname "$cfg")")"
    done
    emulator -accel-check || true
    echo "boot flags: $(gpu_boot_flags)"
    exit 0
    ;;
  boot)
    role="${2:-}"
    n="$(avd_name "$role")" || { echo "usage: avd.sh boot floor|play|profile|tablet|fold"; exit 1; }
    avd_dir="$HOME/.android/avd/${n}.avd"
    accelerate_ini "$avd_dir/config.ini"
    wipe_bad_snapshots "$avd_dir"
    # shellcheck disable=SC2046
    exec emulator -avd "$n" $(gpu_boot_flags) -netdelay none -netspeed full -no-snapshot-load
    ;;
  floor|play|profile|tablet|fold)
    n="$(avd_name "$cmd")"
    case "$cmd" in
      floor)   img="system-images;android-24;google_apis;arm64-v8a";           dev=pixel ;;
      play)    img="system-images;android-36;google_apis_playstore;arm64-v8a"; dev=pixel_6 ;;
      profile) img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_6 ;;
      tablet)  img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_tablet ;;
      fold)    img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_fold ;;
    esac
    echo no | avdmanager create avd -n "$n" -k "$img" -d "$dev" --force 2>&1 \
      | grep -vE "Error: /|Could not load|Loading|null" || true
    accelerate_ini "$HOME/.android/avd/${n}.avd/config.ini"
    echo "created $n (host GPU + HVF; Apple Silicon: Vulkan off). Boot:"
    echo "  scripts/avd.sh boot $cmd"
    echo "Never use -gpu swiftshader_indirect for QA or Macrobenchmark."
    ;;
  *)
    echo "usage: avd.sh floor|play|profile|tablet|fold | boot <role> | accelerate | kill"
    exit 1
    ;;
esac
