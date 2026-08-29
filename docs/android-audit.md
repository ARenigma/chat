# Android platform audit

One row per doc page read, what it requires, and whether we comply. Appended to,
never rewritten — a finding's history is the useful part.

Method and scope: `.claude/skills/android-docs/SKILL.md`. Enforcement:
`__tests__/platform.test.ts`.

**Scope is our surface, not the site.** Compose, Wear, TV, Auto, XR, games, ML
Kit, CameraX and Health do not apply to this app and reading them is waste.
Coverage means exhaustive over what we actually ship.

---

## Closed

| Area                    | Page                                                                                                   | Requirement                                                                                                              | State                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| System bars             | `develop/ui/views/layout/edge-to-edge`                                                                 | Call `enableEdgeToEdge()` for pre-15 parity                                                                              | **Fixed** 2026-08-26. Was relying on RN's internal call; on API 24–34 insets landed twice          |
| System bars             | `design/ui/mobile/guides/foundations/system-bars`                                                      | `isNavigationBarContrastEnforced = false` before enabling                                                                | **Fixed**. Verified on API 34 three-button nav                                                     |
| Text input              | RN `textinput#disablefullscreenui`                                                                     | IME must not take the window                                                                                             | **Fixed**. `TextField` wrapper forces it; orientation lock removed as a result                     |
| Orientation             | `guide/topics/large-screens`                                                                           | Do not restrict orientation                                                                                              | **Fixed**. Lock removed once the IME cause was fixed                                               |
| Conversations           | `develop/ui/views/notifications/conversations`                                                         | Long-lived shortcut + `Person` + `MessagingStyle` + `shortcutId`                                                         | **Fixed**. Was generic notifications with no channel at all                                        |
| Identity                | `identity/sign-in/credential-manager-siwg-implementation`                                              | Ship both `GetGoogleIdOption` and `GetSignInWithGoogleOption`                                                            | **Fixed** after only the sheet shipped. Tier 3 verified on API 36 / GMS 25.08.34                   |
| Performance             | `topic/performance/baselineprofiles/*`                                                                 | Baseline + startup profile, `profileinstaller` for non-Play installs                                                     | **Fixed**. DEX split confirmed: 4.29MB single dex → 1.95MB startup + 2.66MB rest                   |
| Call — FGS manifest     | `develop/background-work/services/foreground-services`, `about/versions/14/changes/fgs-types-required` | `<service android:foregroundServiceType="phoneCall\|microphone\|camera"/>` + four permissions                            | **Fixed** 2026-08-29. Added all four permissions + service element to `AndroidManifest.xml`        |
| Call — FGS start        | `develop/background-work/services/foreground-services`                                                 | `ServiceCompat.startForeground()` with type mask within 5 s                                                              | **Fixed** 2026-08-29. `CallForegroundService.kt` implements this; `core:1.12.0` added to Gradle    |
| Call — Audio focus      | `media/optimize/audio-focus`                                                                           | `AudioFocusRequest` + `AUDIOFOCUS_GAIN_TRANSIENT` + `MODE_IN_COMMUNICATION`; abandon on end; SDK_INT guard for minSdk 24 | **Fixed** 2026-08-29. `CallAudioFocusManager.kt` with API 26+ guard                                |
| Call — CallStyle        | `reference/androidx/core/app/NotificationCompat.CallStyle`                                             | `BroadcastReceiver` PendingIntents with `FLAG_IMMUTABLE`; unique requestCode per action; no `fullScreenIntent`           | **Fixed** 2026-08-29. `CallForegroundService` owns lifecycle; `CallActionReceiver` handles actions |
| Call — Video deep-link  | `App.tsx` L211                                                                                         | `medium` was hardcoded `'voice'` for notification-driven answers                                                         | **Fixed** 2026-08-29. Parsed from query string; defaults to `'voice'` when absent                  |
| Call — FCM ring timeout | `develop/background-work/services/foreground-services`                                                 | FCM TTL 30 s to drop stale call pushes                                                                                   | **Fixed** 2026-08-29. Changed `'45s'` → `'30s'` in `send-call/index.ts`                            |
| D2D transfer            | `about/versions/12/behavior-changes-12#backup-restrictions`                                            | `android:dataExtractionRules` with empty `<device-transfer>` to stop session migration                                   | **Fixed** 2026-08-29. `data_extraction_rules.xml` created; attribute added to `<application>`      |

## Open

| Area                    | Finding                                                   | Why it matters                                                                                                      |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Window size classes     | Only compact (411dp) has ever been run                    | Orientation is now unlocked, so medium and expanded are reachable and unverified                                    |
| Performance measurement | Both AVDs are SwiftShader, no GPU                         | Every jank number so far is meaningless. Needs a throttled mid-range or real device                                 |
| minSdk                  | No ADR records the choice                                 | 99.1% reach is currently an accident, not a decision                                                                |
| Old-API coverage        | Nothing has run below API 34                              | The minSdk 24 claim is assumed, never demonstrated                                                                  |
| Identity                | Token exchange never completed                            | Needs a real Google account signed in on the AVD by hand                                                            |
| IME compliance          | `IME_FLAG_NO_FULLSCREEN` is advisory                      | Verified on Gboard only; Samsung/SwiftKey/Indic keyboards untested                                                  |
| Testing tiers           | No instrumented tier                                      | 600 unit tests, zero Espresso/UI Automator in CI                                                                    |
| Quality                 | Core app quality checklist never run                      | Google's own pre-launch gate                                                                                        |
| Security                | Data safety form, network security config, Play Integrity | None reviewed                                                                                                       |
| Call — SQL ring timeout | `meter_active_calls` ringing expiry is 45 s; target 30 s  | Migration 011 cannot be edited in place. Fix lands in migration 028+ (session work). FCM TTL already fixed to 30 s. |

---

## Corrections to earlier ADRs

- **ADR-0009 / ADR-0006** claimed phone OTP was gated on our own TRAI/DLT
  registration. `send-sms` has only ever used Fast2SMS, which sends on their
  template. The gate described was for a carrier we do not use.

---

## Full-surface audit, 2026-08-26 (13 areas, 104 findings)

Ran a parallel doc audit across all four pillars — 13 reader agents, adversarial
verification of every high-severity item, per-area doc pages recorded in the
workflow journal. Net after verification: 5 confirmed high, several downgraded to
medium, one refuted-as-high-but-real.

### Fixed this pass

| Finding                                                                                                                           | Doc                                | Fix                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation notification opened nothing once payload goes data-only (implicit `companionchat://peer/<id>` matched no filter)     | app-links / insecure-deeplink      | Explicit component intent in `Conversations.peerIntent`; peer link routed via `Linking` in App.tsx, uuid-gated. Latent until stage 2, fixed before it.                  |
| Chat transcript unreadable by TalkBack — every bubble's `accessibilityLabel` was the long-press hint, overriding the message text | reactnative.dev/docs/accessibility | Both bubbles in `Turn.tsx` use `accessibilityHint` (appends) instead.                                                                                                   |
| Welcome screen collided / white-rectangle carousel on short (16:9) windows                                                        | large-screens adaptive quality     | Flex `welcome` column replaces two absolute blocks; carousel scrims removed; gradient stops use alpha-0-of-hue not the `transparent` keyword. Verified API 24 + API 36. |
| minSdk 24 had no recorded rationale                                                                                               | Play distribution                  | ADR-0017.                                                                                                                                                               |

### Confirmed HIGH, deferred to P4 (Play launch) — not runtime bugs, and we have not launched

| Finding                                      | Doc                                    | Why deferred                                                                                        |
| -------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| No in-app privacy policy link                | support.google.com/googleplay 10144311 | Needs the deployed web/privacy.html URL and a Settings row. Play-console blocker, not a device bug. |
| No terms-acceptance gate before creating UGC | Play UGC policy 9876937                | Onboarding needs a "by continuing you agree" gate with tappable links. Same launch phase.           |

### Confirmed MEDIUM, queued

| Finding                                                                           | Doc                  | Note                                                                                                                                                      |
| --------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowBackup=false` does not stop D2D transfer on Android 12+                     | behavior-changes-12  | Needs `android:dataExtractionRules` with an empty `<device-transfer>` so the session cannot migrate to a second device. Real for a paid-chat app; latent. |
| Bloom radii fixed at 402dp reference width                                        | adaptive quality     | Scale `BLOOM_LAYERS` radii by `width/402`; cosmetic drain on very wide screens only.                                                                      |
| High-priority FCM engagement / OEM delivery risk                                  | fcm message-priority | Monitor after stage 2; MIUI/ColorOS killers are unemulatable.                                                                                             |
| Network cleartext is a global boolean, not a scoped `network_security_config.xml` | security-config      | Debug needs localhost cleartext; scope it to localhost/10.0.2.2 rather than a variant-wide flag.                                                          |

### Still open (from the area reports, lower severity or needs-device)

Accessibility: live-region announcements for phase/error changes; tab `selected`
state + role on `Pressable`; disabled state on the dimmed Send button; font-scale
overflow on the 49dp tab row at 2x. Testing: no instrumented tier (4-item plan in
the journal). Lifecycle: `welcomeSeen` is component state, lost on process death.

The coverage critic did not complete (session limit); a second pass should re-run
it against this record.

---

## Call lifecycle audit, 2026-08-29

Pages read: [self-managed/telecom](https://developer.android.com/develop/connectivity/telecom/self-managed), [fgs-types-required Android 14](https://developer.android.com/about/versions/14/changes/fgs-types-required), [foreground-services](https://developer.android.com/develop/background-work/services/foreground-services), [audio-focus](https://developer.android.com/media/optimize/audio-focus), [CallStyle API](https://developer.android.com/reference/androidx/core/app/NotificationCompat.CallStyle).

### Confirmed OPEN — required before calls ship to production

| Area                   | Requirement                                                                                                                                                                                                               | Current state                                                                                          | Fix required                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Core-Telecom           | `androidx.core:core-telecom` dep + `CallsManager.registerAppWithTelecom()` in Application init + `callsManager.addCall()` coroutine session                                                                               | Zero implementation; no Gradle dep, no `CallsManager`, no Kotlin service                               | New `CallForegroundService.kt`, `CallTelecomModule.kt`, Gradle dep                                          |
| FGS manifest           | `<service android:foregroundServiceType="phoneCall\|microphone\|camera"/>` + `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_CAMERA`, `MANAGE_OWN_CALLS` permissions                | None declared in `AndroidManifest.xml`                                                                 | Add all four permissions + service element                                                                  |
| FGS start              | `ServiceCompat.startForeground()` with type mask (requires `androidx.core:core:1.12+`); must happen within 5s of `startForegroundService()`                                                                               | No service class exists                                                                                | Implement in `CallForegroundService`                                                                        |
| Audio focus            | `AudioFocusRequest` with `AUDIOFOCUS_GAIN_TRANSIENT` + `USAGE_VOICE_COMMUNICATION` + `AudioManager.MODE_IN_COMMUNICATION`; abandon on call end; `AudioFocusRequest` API requires API 26+ with SDK_INT guard for minSdk 24 | Not implemented                                                                                        | New `CallAudioFocusManager.kt`                                                                              |
| CallStyle notification | `NotificationCompat.CallStyle.forIncomingCall()` / `forOngoingCall()` with `BroadcastReceiver` PendingIntents, `FLAG_IMMUTABLE`; unique `requestCode` per action; no `fullScreenIntent`                                   | Partial: `Conversations.kt` builds CallStyle but is called from JS — no FGS wrapper owns the lifecycle | Move notification build into `CallForegroundService`; keep existing `Conversations.kt` for `MessagingStyle` |
| Ring timeout           | Server `meter_active_calls` expires at **45 s**; FCM TTL **45 s**; target is **30 s**                                                                                                                                     | Mismatch                                                                                               | Change SQL + FCM TTL to 30 s, update `100_calls_and_metering.sql` test                                      |
| Video deep-link        | `App.tsx` L211 hardcodes `medium: 'voice'` for notification-driven answers                                                                                                                                                | Bug                                                                                                    | Parse `medium` from intent/query string                                                                     |
| Background survival    | Active WebRTC runs in-process; no FGS to hold the process under Doze                                                                                                                                                      | Complete: app dies in background mid-call                                                              | Bind WebRTC lifecycle to `CallForegroundService`                                                            |
| Audio-focus API guard  | minSdk 24; `AudioFocusRequest` is API 26+; pappal targets API 36                                                                                                                                                          | Not yet written                                                                                        | Gate on `Build.VERSION.SDK_INT >= 26` in `CallAudioFocusManager`                                            |

### Implementation notes (from doc pages read 2026-08-29)

- `MANAGE_OWN_CALLS` in manifest is the OS prerequisite that unlocks `FOREGROUND_SERVICE_TYPE_PHONE_CALL`; both must be present.
- `CallsManager.registerAppWithTelecom()` must run once at app start (`Application.onCreate()` or module init), not per call.
- `callsManager.addCall(...)` is a suspend function that does not return until the call ends — run in `serviceScope`, not a request scope.
- Audio focus must be requested **after** FGS has started (API 35+ enforces this; targetSdk 36 means it applies).
- `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK`: voice apps should mute, not duck.
- Do NOT use `fullScreenIntent`; the existing `platform.test.ts` assertion that it is absent is correct and must be preserved.
- `FLAG_IMMUTABLE` on every `PendingIntent` action is mandatory for API 31+.
- `androidx.core:core-telecom:1.0.0` and `androidx.core:core:1.12.0` (minimum) to be added to `android/app/build.gradle`.

### Deferred (out of scope for calls)

- `FOREGROUND_SERVICE_MEDIA_PROJECTION` and screen share — product does not include screen sharing; do not add this capability.
