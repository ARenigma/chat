# ADR-0002 — Providers get a web console first, not a second app

- **Status:** Proposed
- **Date:** 2026-08-20

## Context

Providers need onboarding, availability control, concurrent conversations,
earnings visibility and identity verification. Members need discovery and a
single conversation. The question is whether providers live in the same app
behind a role switch, in a second native app, or somewhere else.

## Options considered

**A. One app, role switch** (Airbnb, Fiverr pattern). Fits when the same human
plausibly plays both roles, provider work is asynchronous, and forcing a second
download would tax the supply you are trying to grow.

**B. Two native apps, shared architecture** (Uber, Etsy pattern). Fits when roles
are mutually exclusive in-session, provider work is high-frequency, and provider
onboarding is heavy. Uber's own conclusion is worth copying precisely: separate
_apps_, shared _architecture_ — otherwise platform investment stops compounding.

**C. Native member app + provider web console.**

## Decision

**Option C for v1**, with a native provider app deferred until providers ask for
mobility.

## Why

1. **Roles are mutually exclusive.** No member is ever a provider. The Airbnb
   argument for role switching does not apply, and a role switch would put the
   provider surface one tap from every member — an obvious abuse vector.
2. **Providers work at a desk.** Long sessions, high typing volume, several
   conversations at once. That is a keyboard-and-wide-screen job. A phone is the
   wrong form factor for the work, not just an alternative one.
3. **It removes an app store from the critical path.** The provider surface never
   faces Play review, so provider iteration is not gated on it — and, given
   ADR-0001's policy risk, a Play rejection on the member app does not also
   destroy the supply side. Risk isolation is the strongest argument here.
4. **Heavy onboarding suits the web.** ID upload, Stripe Connect onboarding and
   tax forms are all web flows already; wrapping them in a native shell adds
   nothing.
5. **It is cheaper before liquidity exists.** Supply is the constraint in every
   marketplace. Reach it with the smallest buildable surface.

## Consequences

- One repo, three deliverables: `apps/member` (React Native), `apps/provider`
  (web), `packages/*` (shared design tokens, ledger, protocol, types). Design
  tokens already generate from Figma and feed both.
- Provider push notifications need web push, which is weaker than native. If
  response-time SLAs suffer, that is the trigger to build the native app —
  the decision to revisit, with a measurable threshold rather than a feeling.
- Two release pipelines rather than one. The existing four-stage pipeline extends;
  the web console adds a simpler static deploy.

## Revisit when

Provider median response time exceeds the SLA and web push is the identified
cause, or providers request mobility in numbers.
