#!/usr/bin/env bash
# Recreate a matrix AVD on demand. AVDs bloat to 6-9GB from accumulated userdata,
# so we do NOT keep them all resident — the system images (already downloaded) are
# the durable part, and an AVD is recreatable from one in seconds. See ADR-0017.
#
#   scripts/avd.sh floor    # cc_api24        API 24 google_apis   minSdk floor
#   scripts/avd.sh play     # cc_api36_play   API 36 playstore     Credential Manager
#   scripts/avd.sh profile  # cc_api34        API 34 userdebug     Baseline Profiles
#   scripts/avd.sh tablet   # cc_api34_tablet expanded window
#   scripts/avd.sh fold     # cc_api34_fold   foldable boundary
set -euo pipefail
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
case "${1:-}" in
  floor)   n=cc_api24;         img="system-images;android-24;google_apis;arm64-v8a";           dev=pixel ;;
  play)    n=cc_api36_play;    img="system-images;android-36;google_apis_playstore;arm64-v8a"; dev=pixel_6 ;;
  profile) n=cc_api34;         img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_6 ;;
  tablet)  n=cc_api34_tablet;  img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_tablet ;;
  fold)    n=cc_api34_fold;    img="system-images;android-34;google_apis;arm64-v8a";           dev=pixel_fold ;;
  *) echo "usage: avd.sh floor|play|profile|tablet|fold"; exit 1 ;;
esac
echo no | avdmanager create avd -n "$n" -k "$img" -d "$dev" --force 2>&1 | grep -vE "Error: /|Could not load|Loading|null" || true
echo "created $n — boot: emulator -avd $n -no-snapshot-load -no-boot-anim -gpu swiftshader_indirect"
