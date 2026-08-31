# Pappal — Product

Pappal is a two-sided, human-to-human paid conversation marketplace for India,
Android-first. Paying members reach real providers for company and someone to
talk to. It is **peer support, explicitly not therapy, not clinical, not dating**
(ADR-0001). The user-facing line is verbatim: _"Real people, ready to talk. Not
therapy, just company."_

## Who it is for

- **Members** (demand): Google sign-in primary, Firebase phone OTP as an
  accountability upgrade (ADR-0004, ADR-0006). Anonymous sign-ins are disabled.
  They browse providers, start conversations, and pay per minute.
- **Providers** (supply): real people who set availability and rates. A separate
  provider surface (home, application, status) selected server-side by role
  (ADR-0002). Providers need the opposite of anonymity — identity and (later) KYC.

## What is locked

### Pricing — per-minute, ₹ balance (ADR-0019)

The unit is a **minute of a provider's time**; the balance is **money (₹)**, not a
message count. Global per-channel per-minute rates are admin-configurable
(defaults: chat ₹22, call ₹22, video ₹35). A metered session debits the balance
while both parties hold live leases; **"talk time left" = balance ÷ rate**,
derived, never stored. Recharge tops up ₹ (India-first UPI; Play Billing
evaluated separately). New accounts do **not** get a starter credit by default;
daily refill is an admin knob and is off until published. This replaces the
first-gen "1 message = 1 token / 58 left / Add 25 Free Tokens" model. Session
metering is live (migrations 030/037); the real payment rail remains gated.

### Chats

Real-time human-to-human messaging over Supabase Realtime (ADR-0001), not AI — the
entire AI/SSE generation path was deleted, and a contract test keeps it gone.
Messages support replies/quotes, image attachments with reactions, read receipts,
and voice notes (ADR-0014). Presence is **declared, not derived** (ADR-0013): Here
Now / Away / Hidden, chosen by the user.

### Calls (`CALLS_ENABLED=true`)

Voice and video, per-minute. Android requirements are non-negotiable: foreground-
service types (microphone/camera), self-managed Telecom `ConnectionService`,
audio focus. Incoming calls use a **heads-up `CallStyle` notification** (no
full-screen intent — see `platform.test.ts`). Session billing is live
(ADR-0020); the real payment rail remains gated (ADR-0022).

### Notifications

Conversation notifications use MessagingStyle + Person + a long-lived shortcut, on
a **data-only FCM payload** with a background handler (native `Conversations.kt`).
The push sender is a Supabase Edge Function (pg_cron → dispatch → pg_net →
send-push), chosen to avoid a GCP billing account (ADR-0005, ADR-0007).

### Identity & auth

Google sign-in is primary and live, via Credential Manager in-app sheet with a
browser fallback (see [[reference-chatapp-google-signin]]). Phone OTP is live
(`PHONE_AUTH_ENABLED=true`) with a segmented input, SMS autofill,
wrong-code-keeps-digits, countdown resend, and +91 default. DLT was the gate;
it cleared (ADR-0006). Facebook was removed, not deferred. Anonymous remains
disabled.

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
- Provider KYC + payouts (Cashfree Payouts, ADR-0021/0022), age verification.
- Whether phone becomes mandatory for providers (ADR-0009 §4).
