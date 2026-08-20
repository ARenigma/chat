# ADR-0001 — The chat is human-to-human, not AI

- **Status:** Accepted (2026-08-20)
- **Decision by:** Amit Ranjan
- **Date:** 2026-08-20
- **Supersedes:** the implicit assumption behind every commit to date

## Context

Everything built so far assumes an AI companion: `stream-chat` calls a language
model, `prompts.ts` shapes its persona, and the SSE pipeline exists to stream
generated tokens. The product is in fact a marketplace — paying members (men)
chat with real service providers (women). AI may serve auxiliary functions but
does not write messages.

This is not a feature change. It changes the transport, the data model, the
identity model, the money flow, the legal surface and the distribution risk.

## Decision

Rebuild the message path as real-time human-to-human messaging. Retain the
design system, the wallet, the compliance harness and the CI/CD pipeline.

## What survives

| Asset                                                                | Verdict                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Figma design system + `design/tokens.json` -> generated theme        | Unchanged. A chat UI is a chat UI.                                                |
| Components (`Turn`, `Composer`, `Avatar`, `Chip`, `Sheet`, `Button`) | Unchanged.                                                                        |
| Token ledger (`src/lib/tokenLedger.ts`, `deduct_user_token`)         | Survives, but a token now maps to revenue that must be **split with a provider**. |
| RLS pattern and pgTAP suite                                          | Pattern survives; policies change from one-owner to two-party.                    |
| CI/CD, manifest/Hermes gates, secret scanning                        | Unchanged, and worth more now.                                                    |
| Anonymous-first auth                                                 | Correct for the **demand** side only. Providers need the opposite.                |

## What is deleted

- `supabase/functions/stream-chat/` — the entire SSE-from-model path
- `_shared/prompts.ts` and the persona system prompts
- `src/api/stream.ts` client SSE reader
- `scripts/openai-stub.mjs`, `__tests__/streamIntegration.test.ts`, `__tests__/sse.test.ts`
- `.maestro/02-chat-stream.yaml`
- Personas as characters become provider profiles: real people, real availability

**Done, 2026-08-20.** The whole `supabase/functions/` tree is gone, not merely
unreferenced — with no model to stream from, `send_message` is a single RPC and
Deno left the toolchain entirely (no `check:edge`, no `lint:edge`, no
`edge-function` CI job, no `react-native-sse` dependency). A dormant Edge
Function still holding a provider key would have kept the AI-disclosure question
alive on the Play listing for no benefit, so "delete" was taken literally. The
`the AI path is gone, not dormant` suite in `__tests__/contract.test.ts` fails if
any of it returns.

## What is new, in order of difficulty

1. **Trust and safety.** The largest change by far. Human-to-human paid intimate
   chat carries CSAM risk in both directions, harassment, sextortion,
   off-platform solicitation, impersonation and payment fraud. This needs
   reporting, blocking, message classification, audit trails and a human ops
   queue _before_ launch, not after. **This is where AI now legitimately
   belongs — classification, not generation.**
2. **Provider identity and age verification.** Legally mandatory. A KYC vendor
   (Persona, Veriff, Stripe Identity), not a checkbox.
3. **Payouts.** Stripe Connect Express: onboarding, tax forms, payout schedules,
   reversal handling. The wallet stops being a counter and starts being money.
4. **Realtime messaging.** Supabase Realtime replaces SSE. Presence, typing and
   read receipts become real signals rather than decoration. **Done,
   2026-08-20** — see `src/api/realtime.ts` and `src/lib/transcript.ts`. Two
   findings worth recording, both in migration 004: 003's read-receipt UPDATE
   policy let a _recipient rewrite the message they had received_, which would
   have destroyed every transcript as evidence for the moderation queue item 1
   depends on; and the "providers are discoverable" SELECT policy widened
   `profiles` itself rather than only feeding the directory view, exposing every
   provider's wallet to any member.
5. **Matching and discovery**, provider availability, response-time SLAs,
   earnings dashboards.

## Risks that must be resolved before building

- **Play Store policy.** An app facilitating paid intimate conversation with real
  people sits in a far harsher category than an AI companion. Play prohibits apps
  facilitating sexual services. Positioning determines whether this is
  distributable at all — this is the single largest existential risk to the
  channel and it should be answered before three months of engineering.

  **Positioning decided, 2026-08-20: peer support, explicitly not clinical.** The
  product is "someone who listens" — company for loneliness. The user-facing
  language is now, verbatim, _"Real people, ready to talk. Not therapy — just
  company."_

  The words matter in both directions, which is why this is written down rather
  than left to whoever edits the copy next:

  - **Avoid "therapy", "counselling", "treatment", "clinical".** Claiming those
    invites a _second_ regulator on top of Play. Play's Health category and the
    app stores' medical-claims rules attach to apps that present as care;
    providers here are not licensed clinicians, so the claim would be false as
    well as costly. This is why the subtitle disclaims it out loud instead of
    merely not asserting it.
  - **Avoid intimacy and companionship-as-romance framing** — the previous
    "She's been waiting", "Who's on your mind tonight?", "I missed you" register
    is exactly what reads as a paid-intimacy service to a reviewer. Removed.
  - **Say: "someone who listens", "peer support", "company when you need it".**

  Residual risk: positioning is necessary but not sufficient. Play judges the
  app as operated, so item 1 (trust and safety) is what makes the positioning
  survive contact with real users. Copy alone will not save a listing whose
  transcripts say something else.

- **Payments.** If members purchase tokens for a service delivered by a person,
  whether Play Billing (and its cut) applies, or whether this is a real-world
  service exempt from it, determines the unit economics. Get this answered by
  policy, not by assumption.

## Consequences

Roughly 60% of existing work carries over. The remaining 40% is replaced, and the
new surface — safety, KYC, payouts — is larger than everything built so far.
