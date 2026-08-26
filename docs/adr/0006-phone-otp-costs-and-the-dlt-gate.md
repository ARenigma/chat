# ADR-0006, Phone OTP: what it costs, and the gate that is not money

Status: **accepted, Google now, phone after DLT clears**
Date: 2026-08-21
Supersedes the "no phone auth" half of [ADR-0004](0004-identity-is-social-login.md)

## The option in the Supabase dashboard is real, and it does not send SMS

Supabase Auth has phone login, and it is genuinely wired: OTP issue, verify,
rate limits, session. What it does **not** have is a carrier. Supabase's own docs
list the supported providers as **MessageBird, Twilio, Vonage and TextLocal**,
and state plainly that a third-party account is required.

That matters because it moves the question from "is the feature there" to "what
does an SMS cost, and can we send one at all".

## Cost, measured rather than assumed

Per verification, India, August 2026:

| Route                                    | Per OTP              | 1,300 OTPs/month |
| ---------------------------------------- | -------------------- | ---------------- |
| **Indian DLT aggregator** (MSG91 et al.) | ₹0.18–0.25 + 18% GST | **≈ ₹385**       |
| WhatsApp authentication template         | ~$0.0014 (₹0.12)     | ≈ ₹185           |
| Twilio Verify                            | $0.05 + channel      | ≈ ₹5,600         |
| Firebase Phone Auth                      | ~$0.07               | ≈ ₹7,900         |

Two things follow.

**Firebase Phone Auth is the expensive option, not the convenient one.** It is
roughly **20× an Indian aggregator**, it requires the Blaze plan (a billing
account, the same one that is currently closed, see ADR-0005), and its "free
tier" is 10 SMS/day for test numbers only. Every send is billed including the
OTPs nobody types.

**The cheap route is not in Supabase's provider list, and that is fine.**
Supabase has a **Send SMS auth hook**: it hands an Edge Function the user and the
OTP and lets us deliver it however we like, the docs name Msg91 explicitly. So
the architecture is Supabase Auth for identity, an Edge Function for delivery, an
Indian aggregator for the carrier. Nothing is given up.

## The gate is DLT, not cost

Every domestic Indian SMS route requires **DLT registration** under the TRAI
mandate: entity registration, then header (sender ID), then template. It is
typically **one to three weeks**, and no vendor can shortcut it, Firebase
included, since it uses the same domestic routes. The ₹385/month is not the
obstacle; the calendar is.

That is why "ship immediately with phone OTP" is a contradiction: phone is the
_slowest_ auth to launch in India, not the fastest.

## Decision

1. **Ship on Play with Google sign-in only.** It works today, costs nothing, and
   is already verified on a device end to end.
2. **Start DLT registration in parallel.** It is a calendar dependency, so it
   should be running while other work happens rather than after it.
3. **Add phone OTP through the Send SMS hook** when the header and template are
   approved. It becomes an addition, not a launch blocker.
4. **Facebook is removed, not deferred.** It had a button and no credentials,
   `enable_facebook = false`, so every tap failed. A sign-in screen offering
   something it cannot deliver is worse than one option, and Meta's App Review
   would have had to be passed for an identity nobody asked for. The Maestro flow
   now asserts the button is _absent_, so it cannot quietly return.

## What phone auth buys that is not convenience

Worth stating, because it is the real argument for doing it at all: a phone
number **costs money to replace**, and a Google account does not. ADR-0004 named
that as the accountability regression it accepted when it moved to social login,
a banned user can return with a fresh Google account in a minute. Phone auth is
how that gets fixed. It is a safety feature that happens to also be a login.

Anonymous sign-in stays off regardless: "even no Google will do" would put us
back where a banned user was back in ten seconds with a fresh wallet, which made
every control in migration 005 decorative.
