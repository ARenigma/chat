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

| Area          | Page                                                      | Requirement                                                          | State                                                                                     |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| System bars   | `develop/ui/views/layout/edge-to-edge`                    | Call `enableEdgeToEdge()` for pre-15 parity                          | **Fixed** 2026-08-26. Was relying on RN's internal call; on API 24–34 insets landed twice |
| System bars   | `design/ui/mobile/guides/foundations/system-bars`         | `isNavigationBarContrastEnforced = false` before enabling            | **Fixed**. Verified on API 34 three-button nav                                            |
| Text input    | RN `textinput#disablefullscreenui`                        | IME must not take the window                                         | **Fixed**. `TextField` wrapper forces it; orientation lock removed as a result            |
| Orientation   | `guide/topics/large-screens`                              | Do not restrict orientation                                          | **Fixed**. Lock removed once the IME cause was fixed                                      |
| Conversations | `develop/ui/views/notifications/conversations`            | Long-lived shortcut + `Person` + `MessagingStyle` + `shortcutId`     | **Fixed**. Was generic notifications with no channel at all                               |
| Identity      | `identity/sign-in/credential-manager-siwg-implementation` | Ship both `GetGoogleIdOption` and `GetSignInWithGoogleOption`        | **Fixed** after only the sheet shipped. Tier 3 verified on API 36 / GMS 25.08.34          |
| Performance   | `topic/performance/baselineprofiles/*`                    | Baseline + startup profile, `profileinstaller` for non-Play installs | **Fixed**. DEX split confirmed: 4.29MB single dex → 1.95MB startup + 2.66MB rest          |

## Open

| Area                    | Finding                                                        | Why it matters                                                                      |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Window size classes     | Only compact (411dp) has ever been run                         | Orientation is now unlocked, so medium and expanded are reachable and unverified    |
| Performance measurement | Both AVDs are SwiftShader, no GPU                              | Every jank number so far is meaningless. Needs a throttled mid-range or real device |
| minSdk                  | No ADR records the choice                                      | 99.1% reach is currently an accident, not a decision                                |
| Old-API coverage        | Nothing has run below API 34                                   | The minSdk 24 claim is assumed, never demonstrated                                  |
| Identity                | Token exchange never completed                                 | Needs a real Google account signed in on the AVD by hand                            |
| IME compliance          | `IME_FLAG_NO_FULLSCREEN` is advisory                           | Verified on Gboard only; Samsung/SwiftKey/Indic keyboards untested                  |
| Testing tiers           | No instrumented tier                                           | 600 unit tests, zero Espresso/UI Automator in CI                                    |
| Quality                 | Core app quality checklist never run                           | Google's own pre-launch gate                                                        |
| Security                | Data safety form, network security config, Play Integrity      | None reviewed                                                                       |
| Architecture            | Startup, process death, saved state, Doze, foreground services | None reviewed; calls will need foreground service types                             |

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
