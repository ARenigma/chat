# Wave 2 — the v13 Figma frames, built with the Fuse system, doc-conformant

**SOURCE OF TRUTH: the v13 frames in Figma `bond Copy` (file 2PjJLeNzXXq3Hs2ItwRWsr).**
These screens are NOT designed here — they already exist in v13. The job is to
BUILD them to match, with the Fuse system integrated (Nunito, Material Symbols
Rounded, coral tokens, bloom where v13 uses it) and each Android function
doc-conformant. Reinventing a layout that v13 already specifies is the failure
mode RULE 3 exists to prevent — read v13 first, the same way onboarding was built
from OnboardingFlow.swift rather than from a screenshot.

Figma MCP needs interactive auth (it is in the requires-authentication list), so
reading v13 headless is blocked; a turn that builds these must have Figma
connected first, or work from exported v13 frames.

Every screen matches its v13 frame, on the decided system (Nunito type ladder, Material Symbols
Rounded via design/icons.json, coral accent tokens, iOS-metric sizes, M3
controls, bloom field where the design calls for it). Every Android-facing
function follows its developer.android.com page via `.claude/skills/android-docs`
and carries the test that page prescribes, gated in `__tests__/platform.test.ts`.

## Screen set and the pillar/doc each pulls in

| Screen                          | Reachable pre-auth?         | Governing docs (per function)                                                                                               |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Splash                          | yes                         | core-app-quality (cold-start, no white flash in dark), app-startup                                                          |
| Sign in                         | yes                         | Credential Manager SIWG (done), a11y focus order                                                                            |
| OTP / code                      | yes                         | autofill SMS (SMS Retriever, gated on DLT), a11y live-region on error                                                       |
| Explore / See all               | no                          | large-screen adaptive (grid at medium/expanded), list a11y                                                                  |
| Provider detail                 | no                          | shared-element nav, image loading, a11y labels                                                                              |
| Chat                            | no                          | conversations (done), IME insets (done), a11y transcript (done)                                                             |
| Recharge                        | no                          | Play Billing (User Choice Billing, India 11% rail), no financial autofill                                                   |
| Success / Low balance           | no                          | notifications, a11y announcements                                                                                           |
| Calls: Audio / Video / Incoming | BUILD (CALLS_ENABLED=false) | **FGS types** (microphone/camera), self-managed Telecom ConnectionService, POST full-screen-intent restriction, audio focus |
| Settings                        | no                          | per-app-language (localeConfig), data-safety surfacing                                                                      |
| Blocked users                   | no                          | UGC policy (block/report reachable)                                                                                         |
| Provider home / SP onboarding   | no                          | same system; provider surface                                                                                               |

## Hard blocker to resolve FIRST

Signed-in screens cannot be device-verified without a session, and RULE 2 forbids
claiming a screen works without seeing it on a device. `exchangeCodeForSession`
needs the on-device PKCE verifier, so the admin key cannot inject a session
cleanly. Two legitimate unlocks, pick one next turn:

1. Recreate `cc_api36_play` (scripts/avd.sh play), sign in with the emulator's
   bundled test Google account — the path already proven to reach the inbox.
2. Wire the e2e seed harness (scripts/e2e.mjs already seeds a member) to inject a
   session onto the dev build, dev-only, never shipped.

Option 1 is faster and adds no app code. Preferred.

## Verification loop (chosen)

internal build per screen batch → install on one AVD → screenshot → fix → repeat.
No distribution until Amit says the first full build is done. Metro hot-reload is
available for JS-only tweaks but is flaky headless here, so batches use internal.

## Status at plan time (2026-08-26)

System is applied globally: type = Nunito, icons = Material Symbols Rounded
(verified rendering on device), colour/space/radius = tokens. Static conformance
scan across all 15 screens found ZERO real violations (raw-hex hits are comments;
raw fontSize hits are the wordmark/reaction/rating one-offs). Onboarding is fully
built and device-verified across API 24/34/36 and both screen heights. So wave 2
is: build the not-yet-built screens (calls) and device-verify the rest end to end.
