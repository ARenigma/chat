# Pappal — Feature Inventory

Status legend:

- **done** — shipped and reachable in the running app
- **gated** — code complete, off behind a `src/config.ts` flag
- **deferred** — partial implementation, blocked or intentionally left for a later phase

Flag column names the `src/config.ts` export; current value in parentheses.

---

## Auth & Onboarding

| Feature                             | Status | Flag                        | Key files                                                                                    | Notes                                                                                                                               |
| ----------------------------------- | ------ | --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Google Sign-In (Credential Manager) | done   | —                           | `src/api/auth.ts`, `src/lib/googleCredential.ts`, `src/screens/AuthScreen.tsx`               | Bottom sheet (API 28+) + explicit button fallback. Both `GetGoogleIdOption` and `GetSignInWithGoogleOption` shipped (ADR-0004).     |
| Firebase phone OTP                  | done   | `PHONE_AUTH_ENABLED` (true) | `src/api/auth.ts`, `src/lib/firebasePhone.ts`, `supabase/functions/exchange-firebase-token/` | Flip flag to `false` to revert to Google-only. Client OTP, then exchanges Firebase ID token for Supabase session via edge function. |
| Phone number in SMS (MSG91 widget)  | done   | `PHONE_AUTH_ENABLED` (true) | `src/lib/msg91Widget.ts`, `supabase/functions/send-sms/`, `supabase/functions/verify-phone/` | Alternative phone path: MSG91 widget on the client, JWT verification server-side.                                                   |
| WhatsApp-style onboarding flow      | done   | —                           | `src/screens/OnboardingScreen.tsx`, `src/components/WordColumn.tsx`, `src/lib/onboarding.ts` | Welcome word-column animation, then sign-in. Seen-once guard: skipped on error return.                                              |
| Auth screen (sign-in choice)        | done   | —                           | `src/screens/AuthScreen.tsx`, `src/screens/PhoneVerifySheet.tsx`                             | Shows Google button always. Phone button shown only when `PHONE_AUTH_ENABLED`. 6-digit code entry with shake-on-wrong animation.    |
| Splash / boot loading               | done   | —                           | `src/screens/SplashScreen.tsx`                                                               | Shown during session check and role query. Has retry on failure.                                                                    |
| Session persistence                 | done   | —                           | `src/lib/storage.ts` (MMKV), `src/api/auth.ts`                                               | `migrateLegacyStorage()` handles one-time migration from AsyncStorage on first boot.                                                |

---

## Chat

| Feature                     | Status | Flag | Key files                                                                                                | Notes                                                                                                                                  |
| --------------------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Text messaging              | done   | —    | `src/screens/ChatScreen.tsx`, `src/api/chat.ts`, `src/components/Turn.tsx`                               | `send_message` RPC (not INSERT). Max `MAX_MESSAGE_CHARS` enforced in composer and DB CHECK.                                            |
| Realtime message delivery   | done   | —    | `src/api/realtime.ts`                                                                                    | Supabase Realtime channel; `replica identity full` on `messages` so UPDATE delivers full row.                                          |
| Read receipts (double tick) | done   | —    | `src/api/chat.ts` (`mark_read`), `src/components/Turn.tsx`                                               | `read_at` set on conversation enter; Realtime UPDATE propagates tick to sender.                                                        |
| Typing indicator            | done   | —    | `src/api/realtime.ts`, `src/components/PeerTyping.tsx`                                                   | Realtime presence broadcast (`typing_start`/`typing_stop`).                                                                            |
| Presence / online status    | done   | —    | `src/lib/presence.ts`, `src/api/realtime.ts`                                                             | Declared presence (`here`/`away`/`hidden`); provider-controlled, not activity-derived.                                                 |
| Voice notes                 | done   | —    | `src/components/VoiceNote.tsx`, `src/components/Waveform.tsx`, `src/lib/recorder.ts`, `src/lib/voice.ts` | Record (M4A), upload to Storage `voice-notes` bucket, path in `messages.voice_path`. Duration bounds in both client and DB CHECK.      |
| Image attachments           | done   | —    | `src/api/attachments.ts`, `src/lib/attachments.ts`, `src/components/Composer.tsx`                        | System photo picker (no READ_MEDIA permission needed); `send_attachment` RPC; `attachments` Storage bucket. No content moderation yet. |
| Emoji reactions             | done   | —    | `src/api/reactions.ts`, `src/lib/reactions.ts`, `src/screens/MessageActionsSheet.tsx`                    | `add_reaction` / `remove_reaction` RPCs; Realtime UPDATE on messages delivers reaction updates.                                        |
| Per-minute token metering   | done   | —    | `src/lib/tokenLedger.ts`, `src/api/chat.ts`                                                              | 60-second heartbeat calls `start_chat_minute` / `end_chat_minute` RPCs while chat is open. Deducts from `token_balance`.               |
| Message long-press actions  | done   | —    | `src/screens/MessageActionsSheet.tsx`                                                                    | React, reply (UI only), copy. Bottom sheet.                                                                                            |
| Day dividers in transcript  | done   | —    | `src/components/DayDivider.tsx`, `src/lib/datetime.ts`                                                   | Inserted between messages from different calendar days.                                                                                |
| Call log rows in transcript | done   | —    | `src/components/CallLogRow.tsx`                                                                          | Inline call record (`calls` table rows) shown in the message stream.                                                                   |
| Chats list screen           | done   | —    | `src/screens/ChatsListScreen.tsx`                                                                        | Full list of conversations; "See all" from Home.                                                                                       |

---

## Calls

| Feature                             | Status   | Flag                        | Key files                                                                  | Notes                                                                                                |
| ----------------------------------- | -------- | --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Voice calls (WebRTC)                | done     | `CALLS_ENABLED` (true)      | `src/api/calls.ts`, `src/api/callSession.ts`, `src/screens/CallScreen.tsx` | Offer/answer/ICE over Realtime. `start_call` RPC → `calls` table.                                    |
| Video calls (WebRTC)                | done     | `CALLS_ENABLED` (true)      | `src/api/callSession.ts`, `src/screens/CallScreen.tsx`                     | Same flow; `medium: 'video'` flag selects camera track.                                              |
| Incoming call push (FCM)            | done     | —                           | `supabase/functions/send-call/`, `android/.../Conversations.kt`            | Data-only FCM; native `CallStyle` notification with Answer/Decline intents; rings even backgrounded. |
| In-app incoming call (foreground)   | done     | —                           | `src/api/calls.ts` (`useIncomingCalls`), `App.tsx`                         | Realtime subscription routes incoming call to `CallScreen` while app is open.                        |
| Call screen (poster, toggles)       | done     | —                           | `src/screens/CallScreen.tsx`, `src/api/callSession.ts`                     | Provider avatar as poster; mute, camera toggle, end.                                                 |
| Calls tab in bottom nav             | gated    | `CALLS_TAB_ENABLED` (false) | `src/components/FloatingToolbar.tsx`, `src/screens/CallsScreen.tsx`        | Tab hidden; `CallsScreen` is currently a stub. Flip flag when call-log screen is production-ready.   |
| Call FGS service types (Android 14) | deferred | —                           | `android/app/src/main/AndroidManifest.xml`                                 | Foreground service type declaration required for Android 14. Not yet declared.                       |

---

## Recharge / Payments / Ledger

| Feature                                | Status   | Flag                               | Key files                                                             | Notes                                                                                                                                           |
| -------------------------------------- | -------- | ---------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Token balance display                  | done     | —                                  | `src/components/TokenCounter.tsx`, `src/api/chat.ts`                  | Reads `profiles.token_balance`; shown in header.                                                                                                |
| Recharge screen (pack selection)       | done     | —                                  | `src/screens/RechargeScreen.tsx`, `src/lib/rates.ts`                  | Shows packs and Pay button. Real payment rail not wired.                                                                                        |
| Mock recharge flow                     | done     | `MOCK_PAYMENTS` (true in non-prod) | `src/screens/PaymentSheet.tsx`, `src/api/transactions.ts`             | `mock_recharge(pack_id, amount)` RPC; server-side gate: `app_flags.mock_payments`. Both flags must be true.                                     |
| Real payment rail (UPI / Play Billing) | deferred | `PAYMENTS_ENABLED` (false)         | —                                                                     | Gateway not wired. Flip `PAYMENTS_ENABLED` once the rail is built.                                                                              |
| Transaction history                    | done     | —                                  | `src/screens/TransactionHistoryScreen.tsx`, `src/api/transactions.ts` | Reads `token_transactions` for the current user.                                                                                                |
| GST invoice generation                 | deferred | —                                  | `supabase/functions/generate-invoice/`                                | Edge function exists; no cron/server workflow calls `complete_recharge` → `generate-invoice` yet.                                               |
| Daily token refill                     | done     | —                                  | `supabase/migrations/002_bootstrap_and_grants.sql`                    | Postgres cron job; grants `DAILY_REFILL_TOKENS` each day. Constant kept in sync with `src/lib/tokenLedger.ts` (asserted in `contract.test.ts`). |

---

## Provider Onboarding

| Feature                           | Status | Flag | Key files                                                                                                   | Notes                                                                                          |
| --------------------------------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Provider application form         | done   | —    | `src/screens/ProviderApplicationScreen.tsx`, `src/lib/applicationSteps.ts`, `src/lib/providerOnboarding.ts` | Multi-step form (BloomField steps). "Become a partner" in Settings routes here.                |
| Application status screen         | done   | —    | `src/screens/ProviderStatusScreen.tsx`                                                                      | Shows pending / approved / rejected state.                                                     |
| Provider home screen              | done   | —    | `src/screens/ProviderHomeScreen.tsx`                                                                        | Conversation list for providers; work threads separated from their own member threads.         |
| Provider detail (member-facing)   | done   | —    | `src/screens/ProviderDetailScreen.tsx`                                                                      | Profile, about, call/chat buttons. `provider_directory` view.                                  |
| Provider avatar                   | done   | —    | `supabase/migrations/013_provider_avatars.sql`, Storage bucket `avatars`                                    | Optional photo; shown in directory, rail, notifications. Image moderation not yet implemented. |
| Provider directory (Home explore) | done   | —    | `src/screens/HomeScreen.tsx`, `src/api/provider.ts`                                                         | "Here now" rail + full list. Blocked providers filtered client-side.                           |

---

## Safety

| Feature              | Status | Flag | Key files                                          | Notes                                                                                                              |
| -------------------- | ------ | ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Block user           | done   | —    | `src/api/safety.ts`, `src/screens/SafetySheet.tsx` | `blocks` table; `useBlockedPeerIds()` returns a `ReadonlySet`; blocked users hidden from directory and CHATS rail. |
| Report user          | done   | —    | `src/api/safety.ts`, `src/screens/SafetySheet.tsx` | `report_user` RPC; creates a `reports` row. No moderation workflow beyond storage yet.                             |
| Blocked users screen | done   | —    | `src/screens/BlockedUsersScreen.tsx`               | Lists and allows unblocking.                                                                                       |

---

## Notifications

| Feature                           | Status | Flag | Key files                                                                                     | Notes                                                                                                                                                             |
| --------------------------------- | ------ | ---- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message push (FCM MessagingStyle) | done   | —    | `supabase/functions/send-push/`, `android/.../Conversations.kt`                               | `MessagingStyle` + `Person` + conversation shortcut. Service-account key in function secrets (see ADR-0007).                                                      |
| Call push (FCM CallStyle)         | done   | —    | `supabase/functions/send-call/`, `android/.../Conversations.kt`                               | Data-only; native CallStyle notification rings even when backgrounded.                                                                                            |
| Engagement nudge push             | done   | —    | `supabase/functions/send-engagement/`, `supabase/migrations/016_engagement_nudges.sql`        | Daily cron; BigPicture of a random online provider to inactive members. Schedule: the cron trigger; client renders `kind:'engagement'` push.                      |
| Push token registration           | done   | —    | `src/lib/push.ts`, `supabase/migrations/008_push_tokens.sql`                                  | FCM token uploaded on sign-in, refreshed on rotation.                                                                                                             |
| In-app update banner              | done   | —    | `src/components/UpdateBanner.tsx`, `src/lib/appUpdate.ts`, `android/.../InAppUpdateModule.kt` | Play In-App Update; flexible update prompt. `UpdateBanner` mounted outside `Root` so it survives all navigation. Present from v1 (cannot be added retroactively). |

---

## Settings & Account

| Feature                  | Status | Flag | Key files                                                       | Notes                                                                                                                    |
| ------------------------ | ------ | ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Settings sheet           | done   | —    | `src/screens/SettingsSheet.tsx`                                 | Theme toggle, sign out, delete account, provider apply / status links, phone verify, transaction history, blocked users. |
| Delete account           | done   | —    | `src/screens/SettingsSheet.tsx`, `src/api/auth.ts`              | Calls `delete_account` RPC; signs out after deletion.                                                                    |
| Dark / light mode toggle | done   | —    | `src/theme/ThemeProvider.tsx`                                   | Stored in MMKV; follows system by default.                                                                               |
| Review / rating prompt   | done   | —    | `src/screens/ReviewSheet.tsx`, `src/screens/ChatScreen.tsx`     | Shown in-chat after both parties have spoken and before conversation is reviewed. `submit_review` RPC.                   |
| Favourites               | done   | —    | `src/screens/FavouritesScreen.tsx`, `src/store/useFavorites.ts` | Heart-toggle stored locally (MMKV via Zustand). Tab in bottom nav.                                                       |

---

## Design System Components (notable)

| Component         | What it does                                                              | Key file                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Spinner`         | 8-spoke iOS-style activity indicator (no SVG, no Material circular)       | `src/components/Spinner.tsx` + `src/lib/spinner.ts`                                                                                                                                     |
| `WordCarousel`    | Looping word cross-fade for the onboarding welcome animation              | `src/components/WordCarousel.tsx` — NOT currently mounted (replaced by `WordColumn`); retained because `contract.test.ts` and `theme.test.ts` assert its internal invariants            |
| `WordColumn`      | Static column of words used on `OnboardingScreen`                         | `src/components/WordColumn.tsx`                                                                                                                                                         |
| `Sheet`           | Draggable bottom sheet with gesture handler                               | `src/components/Sheet.tsx` — the only component that declares a gesture; GestureHandlerRootView required inside Modal                                                                   |
| `BloomField`      | Animated form-step field with bloom light effect                          | `src/components/BloomField.tsx`                                                                                                                                                         |
| `Stepper`         | Step progress indicator with colour interpolation                         | `src/components/Stepper.tsx` — not mounted in OnboardingScreen (replaced by `OnboardingStep` checklist); retained because `contract.test.ts` and `theme.test.ts` assert its token usage |
| `LargeTitleBar`   | Collapsing large-title iOS-style header                                   | `src/components/LargeTitleBar.tsx` — not currently mounted (Home v13 uses a plain nav row); retained for future use                                                                     |
| `SearchField`     | Input field designed to slot inside `LargeTitleBar`                       | `src/components/SearchField.tsx` — not currently mounted; referenced by `LargeTitleBar` docs                                                                                            |
| `ThreadBubble`    | Unread-count badge pill on conversation threads                           | `src/components/ThreadBubble.tsx` — asserted in `contract.test.ts` and `theme.test.ts`; used by provider home and chat list                                                             |
| `EmptyMark`       | Warm-coral empty-state illustration                                       | `src/components/EmptyMark.tsx` — asserted in `theme.test.ts`; used in screens with empty states                                                                                         |
| `FloatingToolbar` | Docked bottom tab bar (Home / Favourites / Calls / Settings)              | `src/components/FloatingToolbar.tsx`                                                                                                                                                    |
| `Icon`            | All icons via Lucide font glyph; filled heart via PappalGlyphs            | `src/components/Icon.tsx`                                                                                                                                                               |
| `Frost`           | Translucent frosted-glass surface (80% opaque approximation, no blur dep) | `src/components/Frost.tsx`                                                                                                                                                              |
| `Pressable`       | M3 state-layer Pressable with spring press scale                          | `src/components/Pressable.tsx`                                                                                                                                                          |
| `NoticeBar`       | Inline info/warning banner                                                | `src/components/NoticeBar.tsx`                                                                                                                                                          |
