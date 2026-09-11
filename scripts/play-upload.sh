#!/usr/bin/env bash
#
# Upload the closed-test AAB to the Play closed-testing track and commit the edit.
#
# WHY A SCRIPT AND NOT FOUR CURLS IN A RUNBOOK: the four calls have to share one
# edit id, and the third one (the track assignment) silently does nothing useful
# if the second one failed — the failure then shows up as "the testers never got
# it" rather than as an error. This fails on the first bad step instead.
#
# The pieces, all from play-upload/README.md:
#   - ADC, not a service-account JSON. There is no JSON in this repo.
#     Needs the androidpublisher scope AND a quota project:
#       gcloud auth application-default login \
#         --scopes=https://www.googleapis.com/auth/androidpublisher,https://www.googleapis.com/auth/cloud-platform
#   - `x-goog-user-project: chat-d8c87` on every call, or the API answers
#     "requires a quota project".
#   - CLOSED testing is the `alpha` track. Play reserves no id called
#     "closed"; `beta` is OPEN testing, which is not what this ships to.
#   - `versionCode` is global across tracks and Play rejects a repeat, so the
#     ladder is READ from the API rather than trusted from any doc.
#
# Usage:  bash scripts/play-upload.sh [path/to.aab]
set -euo pipefail

PKG=com.companionchat
PROJECT=chat-d8c87
TRACK=alpha
AAB="${1:-android/app/build/outputs/bundle/closedTest/app-closedTest.aab}"
NOTES_FILE=play-upload/05-release/whatsnew-en-IN.txt

# arm-only for the shipped bundle: real phones are all arm64-v8a (armeabi-v7a for
# older 32-bit); x86/x86_64 are emulator/ChromeOS ABIs the India market does not
# use, and dropping them from the release bundle cuts build time and AAB size with
# zero delivered-download impact (Play splits per ABI). Debug keeps all four.
[ -f "$AAB" ] || { echo "No AAB at $AAB — build it first:"; echo "  ./gradlew -p android bundleClosedTest -PversionCode=<n> -PreactNativeArchitectures=arm64-v8a,armeabi-v7a"; exit 1; }

API=https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PKG
UPLOAD=https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$PKG

TOK=$(gcloud auth application-default print-access-token)
auth=(-H "Authorization: Bearer $TOK" -H "x-goog-user-project: $PROJECT")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Opening an edit"
ED=$(curl -sS -X POST "${auth[@]}" -H "Content-Length: 0" "$API/edits" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "edit $ED"

say "Ladder already used (Play rejects a repeat)"
curl -sS "${auth[@]}" "$API/edits/$ED/bundles" \
  | python3 -c "import sys,json;print(sorted(b['versionCode'] for b in json.load(sys.stdin).get('bundles',[])))"

say "Uploading $(du -h "$AAB" | cut -f1) — this takes a few minutes"
VC=$(curl -sS -X POST "${auth[@]}" \
  -H "Content-Type: application/octet-stream" --data-binary "@$AAB" \
  "$UPLOAD/edits/$ED/bundles?uploadType=media" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print(json.dumps(d['error'], indent=2), file=sys.stderr)
    sys.exit(1)
print(d['versionCode'])
")
echo "uploaded versionCode $VC"

say "Assigning $VC to the $TRACK track"
NOTES=$(python3 -c "
import json,sys,pathlib
p = pathlib.Path('$NOTES_FILE')
print(json.dumps(p.read_text().strip() if p.exists() else ''))
")
VERSION_NAME=$(sed -n 's/^VERSION_NAME=//p' android/gradle.properties)
curl -sS -X PUT "${auth[@]}" -H "Content-Type: application/json" \
  -d "{\"track\":\"$TRACK\",\"releases\":[{\"name\":\"$VERSION_NAME\",\"versionCodes\":[\"$VC\"],\"status\":\"completed\",\"releaseNotes\":[{\"language\":\"en-IN\",\"text\":$NOTES}]}]}" \
  "$API/edits/$ED/tracks/$TRACK" | python3 -m json.tool

say "Committing the edit"
# Checked explicitly, not assumed: a 500-char release-notes overflow returns
# HTTP 403 with an `error` key here while every earlier step in this script
# still prints its own success banner, so a prior run of this script reported
# "Done — live" after the commit had actually failed (caught 2026-09-12).
COMMIT=$(curl -sS -X POST "${auth[@]}" -H "Content-Length: 0" "$API/edits/$ED:commit")
echo "$COMMIT" | python3 -m json.tool
if echo "$COMMIT" | python3 -c "import sys,json; sys.exit(1 if 'error' in json.load(sys.stdin) else 0)"; then
  say "Done — $VERSION_NAME ($VC) is live on $TRACK for opted-in testers."
  echo "Committing does NOT send anything for review, and production is untouched."
else
  say "COMMIT FAILED — the edit above was NOT applied. $VERSION_NAME ($VC) is NOT live."
  echo "Fix the reported error (e.g. shorten $NOTES_FILE) and re-run — the edit id" \
       "above may still be open, or open a fresh one if it has expired."
  exit 1
fi
