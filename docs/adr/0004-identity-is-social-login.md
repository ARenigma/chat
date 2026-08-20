# ADR-0004 — Identity is Google/Facebook sign-in

- **Status:** Accepted (2026-08-20)
- **Decision by:** Amit Ranjan
- **Supersedes:** the phone-only decision in migration 006 / ADR-0001's identity note

## Context

This is the app's **third** identity model in one day, which is itself worth
recording — the churn is real and the reasons were all valid at the time.

| Model             | Onboarding                          | Accountability                                              | Cost                                                | Verdict                                 |
| ----------------- | ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| Anonymous         | Perfect — usable on the first frame | **None.** Banned user back in 10s with a fresh wallet       | Free                                                | Rejected: made migration 005 decorative |
| Phone + OTP       | One form, two steps                 | **Strongest** short of ID — a number costs money to replace | Per-SMS, plus **DLT registration** (weeks) in India | Rejected on cost                        |
| Google / Facebook | One tap                             | **Middling** — free accounts, so a determined user returns  | Free                                                | **Accepted**                            |

## Decision

Google and Facebook OAuth, in the system browser, PKCE, returning through the
`companionchat://auth-callback` deep link. Phone auth is disabled. Anonymous
stays disabled. Email remains enabled for **admin-created operational accounts
only** (`enable_signup = false`) so `npm run provider` can test the two-sided
conversation a single device cannot.

## What this costs, stated plainly

**1. Weaker accountability than phone.** Google accounts are free and unlimited.
Suspension and bans become _friction_ rather than a wall. The compensating
controls are the ones that do not depend on identity being scarce:

- rate limiting (20 msg/min) — unaffected by account churn
- report history attached to the **conversation** and the evidence snapshot,
  which survives the account
- blocking, which is per-pair and immediate
- eventually classification, which is the only control that scales against a
  motivated repeat offender

This is a genuine regression against the phone model. It should be revisited the
moment SMS is affordable, and the phone implementation is in git history rather
than deleted.

**2. A privacy disclosure a phone number did not require.** Signing in tells
Google or Facebook that this user uses _this_ app. For an app about loneliness
that is a meaningful disclosure, and some people will decline it. The auth screen
says so rather than letting them find out later. It is the main argument for
adding Apple sign-in when iOS ships, since Apple supports private relay.

**3. Facebook App Review is a launch dependency.** Test users work immediately;
real users do not until review passes. Days, not hours.

## Consequences

- No SMS bill, no DLT registration on the critical path.
- The deep link handler is now load-bearing rather than an optional nicety: if it
  breaks, nobody can sign in.
- `profiles.display_name` matters more, because the social account carries a real
  name we must not show to a peer. The provider application already asks for a
  display name; members will need one before any name is ever rendered.
- The age gate for providers is unaffected — it is a CHECK constraint on a
  declared date of birth and does not depend on the auth method.

## Revisit when

Revenue covers SMS, or abuse from recycled social accounts shows up in the
metrics — `npm run moderate metrics` is where it would appear first, as reports
or blocks per active user climbing.
