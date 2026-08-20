# ADR-0002 — One app, server-gated role switch

- **Status:** Accepted (2026-08-20)
- **Decision by:** Amit Ranjan
- **Date:** 2026-08-20

## Context

Providers need onboarding, availability control, concurrent conversations,
earnings visibility and identity verification. Members need discovery and a
conversation. The question was whether providers live in the same app behind a
role switch, in a second native app, or on the web.

## Options considered

**A. One app, role switch** (Airbnb, Fiverr pattern). One pipeline, one design
system instance, one release, one listing. For a pre-liquidity product this is
materially less to build and operate.

**B. Two native apps, shared architecture** (Uber, Etsy pattern). Uber's own
retrospective is the useful part: separate _apps_, shared _architecture_, or
platform investment stops compounding. Doubles the release surface and puts both
sides under Play review.

**C. Native member app plus a provider web console.** Recommended in the first
draft of this ADR: providers work at a desk with high typing volume across several
conversations, and a web console keeps the supply side out of Play review so a
member-app rejection cannot also destroy supply.

## Decision

**Option A.** One React Native app. The provider surface is reached by a role
switch, gated server-side.

Rationale accepted: with a single founder and no liquidity yet, one pipeline and
one release beat architectural purity, and provider mobility may turn out to
matter more than the desk-shaped assumption behind option C.

## The concern this carries, and how it is mitigated

The objection to option A was that a role switch puts the provider surface one tap
from every member. That is only true if the switch is a client-side flag. It is
not going to be one.

1. **Role lives in the database, not the client.** `profiles.role` is set only by
   an approved `provider_applications` row. The client cannot write it, and RLS
   enforces what each role may read regardless of which screen renders.
2. **No entry point until admitted.** The switch is not rendered for a member
   account. Discovering the screen by other means yields nothing, because every
   query behind it is RLS-scoped to `provider_id = auth.uid()`.
3. **Separate navigation roots.** Member and provider stacks are distinct trees
   selected by the server-supplied role, so no member navigation path can reach a
   provider screen even with a client bug.
4. **Verified identity precedes the role.** Age and identity verification gate
   admission, so `role = 'provider'` implies a completed KYC record.
5. **Coupled Play risk is now explicit.** One listing means one rejection takes
   both sides down. This is the accepted cost of the decision, and it raises the
   value of resolving the ADR-0001 policy question _before_ launch rather than
   after.

## Consequences

- One repo, one app, one pipeline. No monorepo split for now.
- The provider surface must be built to the same design system — it is the same
  app, so there is no second visual language to maintain. That is a real saving.
- Web push is not a concern; native notifications work for both roles.
- If Play rejects on the ADR-0001 policy question, supply and demand fail
  together. Mitigation is to resolve policy early, not to re-architect later.

## Revisit when

Play policy forces the surfaces apart, or provider tooling grows enough that it
degrades the member app's size or startup time.
