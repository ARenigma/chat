# ADR-0019, Pricing is per-minute, not per-message

> **Follow-up ADRs:** [0020](0020-ephemeral-bilateral-paid-sessions.md) (session
> mechanics and purge model), [0021](0021-principal-marketplace-economics.md)
> (economics, provider split, payouts), [0022](0022-india-user-choice-billing.md)
> (Play UCB + Cashfree billing rail), [0023](0023-versioned-admin-control-plane.md)
> (admin control plane for rates and kill switches). Backend metering is defined
> in ADR-0020.

- **Status:** Accepted (2026-08-26)
- **Decision by:** Amit Ranjan
- **Resolves:** the payments question [ADR-0001](0001-human-to-human-not-ai-chat.md)
  left open ("whether Play Billing applies, or whether this is a real-world
  service") and the implicit "1 message = 1 token" model the first-gen UI shipped.

## Context

Every first-gen surface metered chat by the message: `deduct_user_token`, a
`token_balance` counter, `RefillSheet` copy "one message costs one token… Add 25
Free Tokens", `TokenCounter` reading "58 left". The v13 frames replace that
model. Provider detail prices three actions **per minute** (Call ₹22/min, Chat
₹22/min, Video ₹35/min), the chat header shows **"4:32 of talk time left"** with a
Recharge affordance, and the balance pill reads a plain number ("460") that the
frames treat as money, not a message count.

## Decision

**The unit is a minute of a provider's time, and the balance is money (₹).**

- A member holds a **₹ balance**. The pill in the Home and Chat headers shows it.
- Each provider sets a **per-minute rate per channel**: chat, voice call, video.
  Rates are per-provider (the frames show Sara at ₹22 / ₹22 / ₹35); they are not
  global constants.
- Opening a channel with a provider starts a **metered session** that debits the
  balance at that channel's rate. "Talk time left" = `balance ÷ rate`, rendered
  as `m:ss` and refreshed as the session runs.
- **Recharge** tops the ₹ balance up. The rail is India-first UPI, with Play
  Billing evaluated separately (see Consequences); the first-gen "Add 25 Free
  Tokens" grant becomes a **starter ₹ credit** for a new account.
- Revenue from a session **splits with the provider**, unchanged from ADR-0001;
  only the meter changed from messages to minutes.

## What this replaces

| First-gen                                 | v13                                        |
| ----------------------------------------- | ------------------------------------------ |
| `token_balance` (integer count)           | `balance_paise` (₹ balance, integer paise) |
| `deduct_user_token` per message           | per-minute session meter per channel       |
| "58 left" / "One message costs one token" | "₹460" / "4:32 of talk time left"          |
| "Add 25 Free Tokens"                      | starter ₹ credit on first run              |
| flat, provider-agnostic                   | per-provider, per-channel rates            |

## Scope of this change

**UI/UX ships now** on the v13 frames: ₹ balance pill, per-minute rate buttons on
provider detail, talk-time banner + Recharge in chat, the Recharge / Low-balance /
Payment-success / UPI screens as ₹ flows. The screens are the deliverable.

**Backend metering and the real payment rail are follow-ups**, and are gated the
same way calls are (`CALLS_ENABLED`) so no half-feature ships:

1. Schema: `token_balance` → `balance_paise`; `deduct_user_token` retires in
   favour of a session-meter RPC (`open_session` / `tick_session` / `close_session`)
   that debits paise per elapsed minute and writes the provider split.
2. Payment rail: UPI intent (India) and/or Play Billing's User-Choice-Billing
   (the 11% India rail noted in the wave-2 plan). Which one, and whether Play
   treats this as a real-world service exempt from its cut, is the ADR-0001
   payments question and is answered with policy, not code.

Until (1) and (2) land, the UI reads the balance and renders rates/meters, and
Recharge/UPI/Payment-success run against a dev stub — never shipped to Play.

## Consequences

- The ledger stops being a counter and becomes money in paise, so rounding,
  currency formatting (`₹` with Indian digit grouping), and the provider split
  all become correctness concerns, not display ones.
- "Talk time left" is derived, never stored: one balance, N providers, N rates.
  Storing minutes would desync the moment a rate or the balance changes.
- Chat being per-minute (not per-message) means an idle open thread should not
  bleed the balance — the meter runs on an **active session**, not on having a
  thread open. This is a backend rule, recorded here so it is not lost.
