# Pappal — Architecture Reference

Target reader: a new engineer or agent picking up work in under 15 minutes.  
Last updated: 2026-08-29.

---

## Stack

| Layer           | Choice                                                           | Version                   |
| --------------- | ---------------------------------------------------------------- | ------------------------- |
| Framework       | React Native (New Architecture / Fabric / Hermes)                | 0.86.2                    |
| Language        | TypeScript                                                       | 5.8                       |
| React           | React 19                                                         | 19.2.3                    |
| Animation       | Reanimated                                                       | 4.5.3                     |
| Backend         | Supabase (Auth + Postgres + Realtime + Storage + Edge Functions) | supabase-js 2.112         |
| Auth providers  | Firebase phone OTP + Google OAuth (Credential Manager)           | firebase 26.3             |
| WebRTC          | react-native-webrtc                                              | 124.0.8                   |
| State           | Zustand                                                          | 5.0                       |
| Data fetching   | TanStack React Query                                             | 5.101                     |
| Storage (local) | react-native-mmkv                                                | 4.3                       |
| Push            | Firebase Cloud Messaging                                         | firebase/messaging 26.3   |
| Error tracking  | Sentry                                                           | @sentry/react-native 8.23 |
| Platform        | Android-only                                                     | minSdk 24 / compileSdk 36 |
| Package name    | `com.companionchat`                                              | —                         |

**Banned:** `react-native-svg` (throws `synchronouslyUpdateUIProps` inside Reanimated views, kills touch). All shapes drawn with Views; all icons rendered as a font glyph.

---

## Directory Map

```
App.tsx                  Root component: boot state machine, navigation state, back handler
index.js                 RN entry point

src/
  screens/               One file per full-page destination or bottom-sheet
  components/            Shared UI primitives (never import a screen)
  api/                   Supabase queries, React Query hooks, Realtime subscriptions
  lib/                   Pure logic: no RN imports, fully testable without a device
  store/                 Zustand slices (useStore, useFavorites)
  theme/
    tokens.json          (in design/) source of truth → never edit generated files
    tokens.generated.ts  Generated from design/tokens.json via `npm run tokens`
    icons.generated.ts   Generated from design/icons.json via `npm run icons:font`
    tokens.ts            Re-exports TOKENS + Theme type, the one import path for tokens
    ThemeProvider.tsx    Light/dark mode context, useStyles, useTheme, useThemeMode
    motion.ts            Every spring, duration, stagger, and animation builder
  config.ts              All build-time feature flags (single source of truth)

design/
  tokens.json            Colour, space, radius, motion, typography values
  icons.json             Icon name → Lucide codepoint + weight config
  references/            Reference screenshots/clips used during design translation
  brand/                 Brand assets

assets/
  fonts/                 Geist (Regular/SemiBold/Bold), TitanOne, Lucide.ttf
                         (+ PappalGlyphs.ttf, orphaned since 2026-09-07 — see Design System)

  supabase/
  migrations/            001–047: sequential SQL migrations (applied in order)
  functions/             Deno edge functions (9 total)
  tests/                 pgTAP SQL test suites (run via npm run test:db, needs Docker)
  config.toml            Supabase project config (authoritative; db push applies this)

android/                 Standard RN Android project; do not hand-edit generated files
  app/src/main/java/com/companionchat/
    MainActivity.kt      FLAG_SECURE (release only), edge-to-edge, baseline profiles
    InAppUpdateModule.kt Native Play In-App Update bridge
    Conversations.kt     Notification builder: MessagingStyle, CallStyle, PendingIntents

scripts/                 Node/mjs tooling scripts (gen-tokens, distribute, db-test, etc.)
__tests__/               Jest unit tests + contract/invariant tests
__mocks__/               Jest module mocks (@env, react-native-get-random-values)
.maestro/                Maestro E2E flows (01–06)
  docs/
  adr/                   Architecture Decision Records 0001–0023
  android-audit.md       Platform compliance audit log (open + closed findings)
  play/                  Play Store assets (512px icon, feature graphic)
keys-backup/             Signing keys — git-ignored, never delete
```

---

## Data Flow

### Auth

**Google OAuth (primary)**

1. App calls `signInWithGoogle()` → Credential Manager sheet (API 28+) or browser fallback.
2. Supabase OAuth redirect → deep link `companionchat://auth/callback`.
3. `handleAuthDeepLink()` in `src/api/auth.ts` exchanges the code; Supabase issues a session.
4. `currentSession()` on boot re-reads the MMKV-persisted session.

**Firebase phone OTP (gated by `PHONE_AUTH_ENABLED`)**

1. `sendPhoneOtp()` → Firebase `verifyPhoneNumber()` → SMS.
2. User enters code → `verifyPhoneOtp()` → Firebase ID token.
3. Client POSTs token to `exchange-firebase-token` edge function.
4. Edge function verifies JWKS, maps phone → Supabase user, returns a Supabase session JWT.

Key files: `src/api/auth.ts`, `src/lib/firebasePhone.ts`, `src/lib/googleCredential.ts`, `supabase/functions/exchange-firebase-token/`.

### Chat

- **Sending**: `send_message(conversation_id, body)` RPC (migration 003, session-aware in 037). Clients cannot INSERT directly. The RPC enforces membership, policy, rate limits, and session linking; it does **not** debit tokens.
- **Realtime**: `src/api/realtime.ts` subscribes to `messages` and `conversations` channels (`supabase_realtime` publication, replica identity FULL on messages so UPDATE payloads include `read_at`).
- **Read receipts**: `mark_read(conversation_id)` RPC → sets `read_at` on messages; Realtime UPDATE delivers the tick to the sender.
- **Typing**: presence channel broadcast (`typing_start` / `typing_stop`), consumed in `src/components/PeerTyping.tsx`.
- **Voice notes**: recorded via `src/lib/recorder.ts`, uploaded to Supabase Storage (`voice-notes` bucket), path written into `messages.voice_path`. `src/lib/voice.ts` owns the bounds checks that mirror the DB CHECK constraint.
- **Image attachments**: `src/lib/attachments.ts` + `src/api/attachments.ts`; picker via `react-native-image-picker`; stored in `attachments` bucket (migration 014).
- **Reactions**: `src/api/reactions.ts` + `add_reaction` / `remove_reaction` RPCs (migration 011).

Key files: `src/api/chat.ts`, `src/api/realtime.ts`, `src/api/reactions.ts`, `src/lib/conversations.ts`.

### Calls (WebRTC)

1. Caller: `start_call(callee_id, medium)` RPC → inserts into `calls` table → triggers `call_push_on_insert` → fires `send-call` edge function → FCM data-only push.
2. Callee's device: builds a CallStyle notification (ring). Deep link `companionchat://call/<peerId>?callId=<id>&action=answer` routes to `CallScreen` via `Linking`.
3. In-app foreground: `useIncomingCalls()` in `src/api/calls.ts` listens on the Realtime `calls` channel; fires `onIncoming` callback.
4. Media: `src/api/callSession.ts` owns WebRTC offer/answer/ICE exchange over Realtime.
5. End: `end_call(call_id)` RPC.

Key files: `src/api/calls.ts`, `src/api/callSession.ts`, `src/api/voice.ts`, `src/screens/CallScreen.tsx`.

### Payments / Ledger

- **Token balance**: `profiles.promo_balance` + `profiles.purchased_balance` (migration 028). `token_balance` is a compatibility column synced by trigger. Promo tokens spend first; purchased tokens never expire. `deduct_user_token` is retired for chat (ADR-0020); the credit path is `complete_recharge` → `purchased_balance`.
- **Recharge**: `RechargeScreen` → `PaymentSheet` (modal). With `PAYMENTS_ENABLED=false` the Pay button is shown but does not charge. `MOCK_PAYMENTS` (true in non-production) enables the `mock_recharge(pack_id, amount)` RPC.
- **`complete_recharge`**: service-role function called by Cashfree webhook / create-order; credits `purchased_balance` and writes a `token_transactions` row.
- **Invoices**: `generate-invoice` edge function produces a GST invoice PDF from a `token_transactions` row; callable only by service_role.
- **`app_flags`**: table with `mock_payments boolean`; read by `mock_recharge` as a server-side gate independent of the client flag.
- **Per-minute metering**: migrations 021–022 implemented client-side `spend_chat_minute()`. Migration 037 (ADR-0020) retires that path in favour of server-authoritative `claim_session_lease`, ticked by `meter_active_sessions`. `src/api/sessions.ts` owns the client lease heartbeat.
- **Payment rail (planned)**: Play Billing via the UCB India programme (Play products) plus Cashfree Payments as the alternative billing choice (ADR-0022). Cashfree Payouts handles provider settlements (ADR-0021). `PAYMENTS_ENABLED=false` until UCB enrollment, Cashfree KYC, and GSTIN fields are confirmed.

Key files: `src/api/transactions.ts`, `src/api/sessions.ts`, `src/screens/RechargeScreen.tsx`, `src/screens/PaymentSheet.tsx`.

### Presence / Last Seen

- Presence is **declared**, not derived from activity (ADR-0013).
- `profiles.presence` is an enum: `here | away | hidden` (migration 012). Providers set it via their home screen toggle.
- `src/lib/presence.ts` + `src/api/realtime.ts` subscribe to profile changes.
- `last_active_at` is NOT computed by the server watching messages; the client calls `declare_presence()` RPC on foreground transitions.

---

## Feature Flags (`src/config.ts`)

| Flag                 | Current value              | Effect when changed                                                                                                                                               |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CALLS_ENABLED`      | `true`                     | Compile-time master for in-chat call affordances. Live voice/video knobs are admin `kill_switches` (`voice_calls_enabled`, `video_calls_enabled`, migration 044). |
| `CALLS_TAB_ENABLED`  | `false`                    | When `true`, adds a Calls tab to the bottom nav (`FloatingToolbar`) and mounts `CallsScreen`. The tab is hidden while `CallsScreen` is still a stub.              |
| `PAYMENTS_ENABLED`   | `false`                    | When `true`, wires the Pay button to a real UPI/Play Billing rail (not yet built).                                                                                |
| `MOCK_PAYMENTS`      | `APP_ENV !== 'production'` | Enables the mock recharge flow; also gated server-side by `app_flags.mock_payments`.                                                                              |
| `PHONE_AUTH_ENABLED` | `true`                     | Gates every phone sign-in entry point (button + send/verify functions). Flip to `false` to revert to Google-only in one diff.                                     |

Runtime config also covers rates, packs, and kill switches via `get_public_config` (migration 035). Theme preference is client-only MMKV (`light` default on install).

---

## Design System

**Tokens**: `design/tokens.json` → `src/theme/tokens.generated.ts` (via `npm run tokens`). Source of truth is the JSON file, not Figma (Figma is downstream). Never edit `tokens.generated.ts` by hand — `npm run tokens:check` fails the build if they drift.

**Fonts**:

- Body/UI: Geist (Regular, SemiBold, Bold) — `assets/fonts/`
- Display/wordmark: TitanOne
- Icons: `Lucide.ttf` — generated from `design/icons.json` by `npm run icons:font` into `src/theme/icons.generated.ts`
- Active favourite heart: **no second face** — the same `Lucide.ttf` outline drawn heavier. Four over-drawn copies offset half a Lucide grid unit (`HEAVY_DILATION = 1/48` in `src/components/Icon.tsx`) take the stroke from Lucide's shipped 2 to 3. `fontWeight` cannot do it: with no `Lucide_bold.ttf` on the asset family, ReactFontManager falls through to `Typeface.create("Lucide", BOLD)`, an unknown family whose fallback has no glyph in the Private Use Area — a silent tofu heart.
- **Superseded 2026-09-07.** The line above replaced "Filled heart: `PappalGlyphs.ttf` — a custom font with a single glyph (U+2665 BLACK HEART SUIT) for the favourite toggle active state (Lucide has no filled-heart variant)." Amit removed the fill ("Remove the heart fill; keep the outline, heavier"); full reasoning in [ADR-0018](adr/0018-icons-are-a-config-driven-font.md)'s 2026-09-07 update. `PappalGlyphs.ttf` is still in `assets/fonts/` and is now referenced by nothing — see the orphan-face note in `__tests__/theme.test.ts`.

**Icons**: `react-native-svg` is banned. All icons are `<Text>` nodes rendering Lucide font glyphs via `src/components/Icon.tsx`. Adding an icon = add it to `design/icons.json` → run `npm run icons:font`.

**Colour system**: "Signal on Neutral". Hue is reserved for meaning: coral = action, sage = presence, citrus = token balance. Everything else is neutral. Light and Dark modes.

**Motion**: all animation builders live in `src/theme/motion.ts`. Four springs (snap, smooth, bounce, gentle) and timed durations for opacity/colour only. No component may declare its own spring constant.

**Contrast**: `npm run contrast:check` recomputes WCAG 2.1 luminance for all 19 foreground/background token pairs in both modes.

---

## Database Migrations (001–047)

| #   | File                                          | Purpose                                                                                                                      |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 001 | `001_initial_schema.sql`                      | Core schema: `profiles`, `token_balance`, wallet RPCs (`deduct_user_token`, `credit_user_token`), RLS base                   |
| 002 | `002_bootstrap_and_grants.sql`                | Daily refill cron, grant/revoke model, wallet primitives locked to service_role                                              |
| 003 | `003_human_conversations.sql`                 | Human-to-human chat: `conversations`, `messages`, `send_message` RPC, `approve_provider_application`, Realtime publication   |
| 004 | `004_message_guard_and_directory.sql`         | `guard_message_columns` trigger, `provider_directory` view (discovery surface), narrows INSERT policy                        |
| 005 | `005_trust_and_safety.sql`                    | `blocks` table, `report_user` RPC, RLS rules for blocking/reporting                                                          |
| 006 | `006_phone_auth_and_provider_onboarding.sql`  | Phone number on profile, provider application flow, `provider_directory` view refresh                                        |
| 007 | `007_conversation_side.sql`                   | `i_am_member` and `i_am_provider` columns on `conversation_summaries`; prevents role confusion in UI                         |
| 008 | `008_push_tokens.sql`                         | `push_tokens` table (FCM device token per user), RLS                                                                         |
| 009 | `009_push_sender.sql`                         | `push_sender` helper view; what the `send-push` edge function reads                                                          |
| 010 | `010_phone_verification.sql`                  | `profiles.phone_verified` flag; `verify_phone` RPC (MSG91 JWT path)                                                          |
| 011 | `011_reactions_replies_voice_calls.sql`       | `reactions`, voice note fields on `messages`, `calls` table, presence fields, pseudonymous `display_name`                    |
| 012 | `012_declared_presence_and_pii_guard.sql`     | `presence_choice` enum (`here`/`away`/`hidden`), `declare_presence` RPC, `guard_privileged_profile_columns` trigger          |
| 013 | `013_provider_avatars.sql`                    | `profiles.avatar_url` (provider photo), Storage bucket `avatars`                                                             |
| 014 | `014_message_attachments.sql`                 | `messages.attachment_path`, `attachments` Storage bucket, `send_attachment` RPC                                              |
| 015 | `015_push_avatar.sql`                         | Adds provider avatar URL to push payload so the notification shows the sender's face                                         |
| 016 | `016_engagement_nudges.sql`                   | `engagement_nudges` table, `engagement_candidates` view; drives the daily inactive-member push                               |
| 017 | `017_call_push.sql`                           | `call_push_on_insert` trigger → fires `send-call` edge function in real-time when a call is created                          |
| 018 | `018_firebase_phone_exchange.sql`             | `exchange_firebase_token` helper; RLS changes to support Firebase-issued Supabase sessions                                   |
| 019 | `019_token_ledger_and_invoices.sql`           | `token_transactions` table, `complete_recharge` RPC (service_role), `generate_invoice` counter, invoice number sequence      |
| 020 | `020_mock_recharge.sql`                       | `app_flags` table, `mock_recharge(pack_id, amount)` RPC (authenticated, gated by `app_flags.mock_payments`)                  |
| 021 | `021_chat_minute.sql`                         | `spend_chat_minute()` RPC; per-minute metering heartbeat (drain-to-zero semantics corrected in 022)                          |
| 022 | `022_chat_minute_drain.sql`                   | Supersedes 021: correct drain-to-zero on final minute; adds `last` flag to signal session end cleanly                        |
| 023 | `023_voice_peaks.sql`                         | `messages.voice_peaks real[]` column; constraint; immutability guard; `send_message` wired to persist sender amplitude peaks |
| 024 | `024_send_message_return.sql`                 | Restores `kind` and `new_balance` to `send_message` return contract (silently dropped by migration 014)                      |
| 025 | `025_voice_peaks_range.sql`                   | Adds element-value constraint to `voice_peaks` (each element must be in `[0,1]`); closes client-supplied input gate          |
| 026 | `026_admin_config_and_policy.sql`             | `admin` schema; versioned config with draft/active lifecycle; report taxonomy                                                |
| 027 | `027_policy_versions_and_acceptance.sql`      | User policy acceptance gate; `policy_versions`, `policy_acceptances`                                                         |
| 028 | `028_balance_buckets_and_ledger.sql`          | Splits wallet into `promo_balance` + `purchased_balance`; backward-compat trigger on `token_balance`                         |
| 029 | `029_billing_snapshot_and_accrual.sql`        | Rate snapshot at session activation; provider accrual tables                                                                 |
| 030 | `030_paid_sessions.sql`                       | `session_requests`, `paid_sessions`, `participant_leases`; bilateral handshake RPCs                                          |
| 031 | `031_purge_and_evidence.sql`                  | Session end + transcript purge; evidence copy path for reports; metadata-only conversation summaries                         |
| 032 | `032_telemetry_event_extensions.sql`          | Extended event allowlist for session lifecycle events                                                                        |
| 033 | `033_credit_purchased_recharge.sql`           | `complete_recharge` credit path to `purchased_balance`                                                                       |
| 034 | `034_admin_schema_api_access.sql`             | Service-role / PostgREST access grants for the `admin` schema                                                                |
| 035 | `035_public_config_rpc.sql`                   | `get_public_config` / `get_active_config` RPCs; app reads runtime config from DB, not build flags                            |
| 036 | `036_fix_provider_share_unit.sql`             | Corrects `provider_share_percent` from basis points (6000) to integer percent (60)                                           |
| 037 | `037_session_cutover.sql`                     | Removes per-message debit from `send_message`; routes billing to `claim_session_lease` / `meter_active_sessions`             |
| 038 | `038_provider_review_and_earnings.sql`        | Provider review / earnings surface adjustments                                                                               |
| 039 | `039_cashfree_telemetry_events.sql`           | Cashfree-related telemetry event allowlist                                                                                   |
| 040 | `040_profile_setup_and_first_interaction.sql` | Username / profile setup; first-interaction openers seed                                                                     |
| 041 | `041_enable_payments_first_interaction.sql`   | Payment gate for first interaction path                                                                                      |
| 042 | `042_about_directory_and_perf_events.sql`     | Directory about copy + performance telemetry events                                                                          |
| 043 | `043_member_age_bracket.sql`                  | Adult age-bracket field for members (under-18 not offered)                                                                   |
| 044 | `044_independent_call_controls.sql`           | Independent `voice_calls_enabled` / `video_calls_enabled` kill switches                                                      |
| 045 | `045_message_origin_and_hidden_retention.sql` | Message origin + hide-on-end / 30-day retain / daily purge; sequential opener templates                                      |
| 046 | `046_invoice_on_recharge.sql`                 | Generate GST invoices after successful production or mock recharges                                                          |
| 047 | `047_fix_public_policy_urls.sql`              | Correct Terms and Privacy records to Pappal's stable public site without forcing re-acceptance                               |

**RLS model**: all tables use `auth.uid()` for row ownership. `send_message`, `complete_recharge`, `approve_provider_application` enforce the caller inside the function. Service-role-only RPCs are revoked from `authenticated` and granted only to `service_role`. Session content after end is filtered by `hidden_at` (045) so participants cannot replay it while dispute retention remains server-side.

---

## Edge Functions (`supabase/functions/`)

| Function                  | Trigger                                          | Purpose                                                                                                                           |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `exchange-firebase-token` | HTTP POST from client                            | Verifies Firebase ID token (JWKS), maps phone → Supabase user, returns Supabase session JWT                                       |
| `generate-invoice`        | HTTP POST from service_role                      | Generates a GST invoice PDF for a `token_transactions` row; not yet deployed to production workflow                               |
| `send-call`               | DB trigger `call_push_on_insert` (migration 017) | Sends a FCM data-only `kind:'call'` push to the callee; fires immediately (calls cannot wait for cron)                            |
| `send-engagement`         | Cron (daily)                                     | Sends a `kind:'engagement'` BigPicture push to inactive members from a random online provider; reads `engagement_candidates` view |
| `send-push`               | DB trigger on `messages` insert                  | Sends a FCM `MessagingStyle` message notification to the recipient; uses a service-account key stored in function secrets         |
| `send-sms`                | Supabase Auth hook `[auth.hook.send_sms]`        | Delivers a phone OTP via Fast2SMS; called by Supabase Auth, not directly by the client                                            |
| `verify-phone`            | HTTP POST from client                            | Verifies the MSG91 JWT from the widget, sets `profiles.phone_verified = true` under the user's existing session                   |
| `cashfree-webhook`        | HTTP POST from Cashfree                          | Verifies the Cashfree payment webhook signature; calls `complete_recharge` on success                                             |
| `create-order`            | HTTP POST from client                            | Creates a Cashfree payment order; returns an order token for the SDK; service-role                                                |

**Important config.toml gotcha**: `[auth.hook.send_sms]` must be commented out in config.toml when `PHONE_AUTH_ENABLED = false`, because `supabase db push` applies config.toml verbatim — an enabled hook with no credentials makes Supabase reject every SMS send rather than skip it. `contract.test.ts` asserts this.

---

## Build & Ship

**Prerequisites**

- `JAVA_HOME=/opt/homebrew/opt/openjdk@17`
- `ANDROID_HOME` pointing to your Android SDK
- Android NDK 27.1.12297006 (`sdkmanager --install "ndk;27.1.12297006"`)
- `android/keystore.properties` populated (see `keystore.properties.example`)

**Common commands**

```
npm run verify             # Full local gate: tokens, icons, contrast, types, lint, jest, bundle
npm run start              # Metro bundler
npm run android            # Debug build on connected device/emulator
npm run android:internal   # Internal (tester) build; includes App Distribution SDK
npm run ship:testers       # version:bump + assembleInternal + distribute (Firebase App Distribution)
npm run test:db            # pgTAP DB tests — requires Docker
```

**Git remotes**

- `origin` → GitHub (`ARenigma/chat` or equivalent)
- `gitlab` → GitLab (`ARenigma/chat`) — this is where CI runs (ADR-0003)

**CI gates (`.gitlab-ci.yml`)**: static analysis → verify (tsc, lint, tokens, jest) → build (R8 release bundle) → deliver (App Distribution) → release (Play).

**Version bumping**: `npm run version:bump` increments `versionName` in `app.json` and Gradle derives `versionCode` as `major*10000 + minor*100 + patch`. Play rejects a duplicate versionCode — never hardcode it.

---

## Testing Gates

Run before every PR. All must pass:

| Command                    | What it checks                                                  |
| -------------------------- | --------------------------------------------------------------- |
| `npx tsc --noEmit`         | Full TypeScript type check                                      |
| `npm run lint`             | ESLint, zero warnings                                           |
| `npm run tokens:check`     | `tokens.generated.ts` matches `design/tokens.json`              |
| `npm run icons:font:check` | `icons.generated.ts` matches `design/icons.json`                |
| `npm run test`             | 607 Jest unit + contract tests                                  |
| `npm run test:db`          | pgTAP DB tests (**SKIPPED locally** — needs Docker; runs in CI) |

**Key invariant test files**:

- `__tests__/contract.test.ts` — enumerates every screen (must be mounted), every migration (must be in db-test runner), every edge function (allow-listed), every Maestro flow ID (must exist in source), Android manifest permissions (exact set), and many cross-cutting invariants.
- `__tests__/theme.test.ts` — asserts every motion token is used from `motion.ts`, not hard-coded in components.
- `__tests__/platform.test.ts` — Android platform compliance assertions.

If you delete a screen or edge function that `contract.test.ts` enumerates, you must update the test enumeration or the suite fails.

---

## Known Deferred / Blocked Items

From `docs/android-audit.md` and the codebase:

| Item                                                   | Blocker / Phase                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| FlashList swap (ChatScreen uses FlatList)              | Medium priority; profile first                                             |
| Foreground service types for calls (Android 14)        | Needed before Play launch; FGS type declaration required                   |
| `network_security_config.xml` scoped to localhost only | Current global flag covers all cleartext; needs scoping                    |
| Image content moderation before Play                   | No moderation pipeline; required before enabling UGC images in production  |
| Real payment gateway (UPI intent / Play Billing)       | `PAYMENTS_ENABLED=false`; gateway not wired                                |
| `generate-invoice` server deployment                   | Edge function exists; no cron/workflow wires it to `complete_recharge` yet |
| In-app privacy policy link                             | Play console blocker; needs deployed `web/privacy.html` URL + Settings row |
| Terms-acceptance gate in onboarding                    | Play UGC policy; needed before accepting user-generated content            |
| `android:dataExtractionRules` (D2D transfer block)     | `allowBackup=false` does not stop device-to-device transfer on Android 12+ |
| Window size classes (medium/expanded)                  | Orientation is unlocked; medium and expanded viewports unverified          |
| Old-API coverage below API 34                          | minSdk 24 claimed but never demonstrated                                   |
| Instrumented test tier                                 | Zero Espresso/UI Automator; only unit tests run in CI                      |
| `welcomeSeen` lost on process death                    | Component state; not in MMKV/store                                         |
