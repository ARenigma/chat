# Pappal — Product

Pappal is a two-sided, human-to-human paid conversation marketplace for India,
Android-first. Paying members reach real providers for company and someone to
talk to. It is **peer support, explicitly not therapy, not clinical, not dating**
(ADR-0001). The user-facing line is verbatim: _"Real people, ready to talk. Not
therapy, just company."_

## Who it is for

- **Members** (demand): anonymous-first identity, Google sign-in primary, phone
  as an optional accountability upgrade (ADR-0004, ADR-0009). They browse
  providers, start conversations, and pay per minute.
- **Providers** (supply): real people who set availability and rates. A separate
  provider surface (home, application, status) selected server-side by role
  (ADR-0002). Providers need the opposite of anonymity — identity and (later) KYC.

## What is locked

### Pricing — per-minute, ₹ balance (ADR-0019)

The unit is a **minute of a provider's time**; the balance is **money (₹)**, not a
message count. Each provider sets per-channel per-minute rates (v13 reference:
chat ₹22, call ₹22, video ₹35). A metered session debits the balance while it
runs; **"talk time left" = balance ÷ rate**, derived, never stored. Recharge tops
up ₹ (India-first UPI; Play Billing evaluated separately). New accounts get a
starter ₹ credit. This replaces the first-gen "1 message = 1 token / 58 left / Add
25 Free Tokens" model. Backend metering + real payment rail are gated follow-ups.

### Chats

Real-time human-to-human messaging over Supabase Realtime (ADR-0001), not AI — the
entire AI/SSE generation path was deleted, and a contract test keeps it gone.
Messages support replies/quotes, image attachments with reactions, read receipts,
and voice notes (ADR-0014). Presence is **declared, not derived** (ADR-0013): Here
Now / Away / Hidden, chosen by the user.

### Calls (built, gated behind `CALLS_ENABLED`)

Voice and video, per-minute. Android requirements are non-negotiable: foreground-
service types (microphone/camera), self-managed Telecom `ConnectionService`,
POST full-screen-intent for incoming, audio focus. Shipped dark until the meter
and rail land.

### Notifications

Conversation notifications use MessagingStyle + Person + a long-lived shortcut, on
a **data-only FCM payload** with a background handler (native `Conversations.kt`).
The push sender is a Supabase Edge Function (pg_cron → dispatch → pg_net →
send-push), chosen to avoid a GCP billing account (ADR-0005, ADR-0007).

### Identity & auth

Google sign-in is primary and live, via Credential Manager in-app sheet with a
browser fallback (see [[reference-chatapp-google-signin]]). Phone OTP is built with
a rich UX (single segmented input, SMS autofill, wrong-code-keeps-digits,
countdown resend, +91 default) and Fast2SMS as carrier, but **`PHONE_AUTH_ENABLED`
stays false** until DLT/website verification (ADR-0006, ADR-0009). Phone
_verification_ (proving a number on an existing session) is a separate, later path.

### Trust & safety (pre-launch, ADR-0001)

Reporting, blocking, message classification (AI belongs here — classification, not
generation), audit trails, a human ops queue. Block/report must stay reachable
(UGC policy). Transcripts are evidence: a recipient must never be able to rewrite a
received message.

### Distribution (ADR-0008)

Play, Google sign-in ready. No OTA in 1.0; in-app updates ship. `internal` build
variant for testers (App Distribution SDK never reaches the Play `release`).
`versionName` in `android/gradle.properties`, held until first full dev is done.

## Open / deferred

- Payments policy: Play Billing vs real-world-service exemption (ADR-0001 item,
  ADR-0019). Determines unit economics.
- Provider KYC + payouts (Stripe Connect), age verification.
- Whether phone becomes mandatory for providers (ADR-0009 §4).
