#!/usr/bin/env bash
# Assert Android Studio + Gradle + CLI share one SDK / AVD lab.
# doc: developer.android.com/studio/run/managing-avds
#      developer.android.com/studio/run/emulator-acceleration
set -euo pipefail

SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }
ok() { say "OK: $*"; }

prop() {
  # portable: no ripgrep \K (not on all rg builds)
  local file="$1" key="$2"
  sed -n "s/^${key}=//p" "$file" 2>/dev/null | head -1
}

xml_attr() {
  local file="$1" name="$2"
  sed -n "s/.*${name}=\"\\([^\"]*\\)\".*/\\1/p" "$file" 2>/dev/null | head -1
}

# 1. Project local.properties
props="$ROOT/android/local.properties"
if [[ -f "$props" ]]; then
  dir="$(prop "$props" 'sdk.dir')"
  if [[ "$dir" == "$SDK" ]]; then
    ok "android/local.properties sdk.dir → $SDK"
  else
    bad "android/local.properties sdk.dir is '${dir:-unset}', expected $SDK"
  fi
else
  bad "missing android/local.properties (Gradle needs sdk.dir=$SDK)"
fi

# 2. Android Studio AndroidSdkPathStore (latest Google/AndroidStudio* options)
studio_xml="$(ls -d "$HOME/Library/Application Support/Google/AndroidStudio"*"/options/android.sdk.path.xml" 2>/dev/null | sort | tail -1 || true)"
if [[ -n "${studio_xml:-}" && -f "$studio_xml" ]]; then
  path="$(xml_attr "$studio_xml" 'androidSdkAbsolutePath')"
  # XML is <option name="androidSdkAbsolutePath" value="..." />
  path="$(sed -n 's/.*androidSdkAbsolutePath" value="\([^"]*\)".*/\1/p' "$studio_xml" | head -1)"
  if [[ "$path" == "$SDK" ]]; then
    ok "Android Studio SDK path → $SDK"
  else
    bad "Android Studio SDK is '${path:-unset}' ($studio_xml); set to $SDK in Settings → Languages & Frameworks → Android SDK"
  fi
else
  say "WARN: Android Studio options not found — open Studio once, then re-run"
fi

# 3. No forked default Studio SDK with its own platform-tools (silent second lab)
if [[ -d "$HOME/Library/Android/sdk/platform-tools" ]]; then
  if [[ "$(cd "$HOME/Library/Android/sdk" && pwd -P)" == "$(cd "$SDK" && pwd -P)" ]]; then
    ok "~/Library/Android/sdk is the same tree as $SDK"
  else
    bad "second SDK at ~/Library/Android/sdk — Device Manager may fork the lab; remove or symlink to $SDK"
  fi
else
  ok "no conflicting ~/Library/Android/sdk lab"
fi

# 4. Matrix AVDs use host GPU
for name in cc_api24 cc_api36_play cc_api34_profile; do
  cfg="$HOME/.android/avd/${name}.avd/config.ini"
  if [[ ! -f "$cfg" ]]; then
    say "WARN: AVD $name missing — create with scripts/avd.sh floor|play|profile"
    continue
  fi
  enabled="$(prop "$cfg" 'hw.gpu.enabled')"
  mode="$(prop "$cfg" 'hw.gpu.mode')"
  if [[ "$enabled" == "yes" && "$mode" == "host" ]]; then
    ok "AVD $name GPU host"
  else
    bad "AVD $name GPU enabled=$enabled mode=$mode — run: scripts/avd.sh accelerate"
  fi
done

# 5. Host hypervisor
if "$SDK/emulator/emulator" -accel-check 2>&1 | grep -Eq 'Hypervisor|accel'; then
  ok "emulator -accel-check reports a hypervisor"
else
  bad "emulator -accel-check failed — see developer.android.com/studio/run/emulator-acceleration"
fi

if [[ "$fail" -ne 0 ]]; then
  say "android-lab: ${fail} check(s) failed"
  exit 1
fi
# 6. Apple Silicon boot must disable Vulkan (MoltenVK SystemUI ANR)
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
  if rg -q 'feature -Vulkan|-feature -Vulkan' "$ROOT/scripts/avd.sh"; then
    ok "avd.sh disables Vulkan on Apple Silicon (host GLES kept)"
  else
    bad "avd.sh missing -feature -Vulkan — SystemUI ANR will return on M-series"
  fi
fi

say "android-lab: one SDK, host GPU AVDs, Studio aligned"
