# ADR-0005 — The push sender needs either a billing account or a four-hop token chain

Status: **open — needs a decision from the product owner**
Date: 2026-08-21

## Context

The push _client_ is built and verified on a device: permission, FCM token,
registration RPC, and a row in `push_tokens` against the right user (migration
008). What does not exist is the half that sends anything.

FCM's HTTP v1 API authenticates with an OAuth2 bearer token minted for a service
account. There is no API-key form of it — the legacy server key was shut off in 2024. So the only question is where that bearer token comes from, and every
answer runs into one of two constraints that were verified rather than assumed:

1. **`constraints/iam.disableServiceAccountKeyCreation` is enforced** on
   `chat-d8c87`. Checked with `gcloud resource-manager org-policies describe
--effective`: `booleanPolicy: enforced: true`. There is no key to download
   and there cannot be one.
2. **`chat-d8c87` has no billing account.** Enabling `run.googleapis.com`,
   `cloudbuild.googleapis.com` or `artifactregistry.googleapis.com` fails with
   `UREQ_PROJECT_BILLING_NOT_FOUND`. Cloud Run and Cloud Functions both require
   a billing account on file even to use the free tier.

What _is_ in place either way: `fcm-sender@chat-d8c87.iam.gserviceaccount.com`
holding `roles/firebasecloudmessaging.admin`. Both options below impersonate it.

## Option A — link a billing account, run the sender on Cloud Run

A container with no credentials in it at all: Cloud Run gives the service its
attached identity through the metadata server, so the Firebase Admin SDK finds
it via Application Default Credentials and nothing is ever stored or rotated.
One hop, and the org policy is satisfied because no key is created.

- Free at our volume — Cloud Run's free tier is 2M requests/month, and this
  fires once per unread message.
- Requires a card on file. That is the entire cost of this option.

## Option B — federate from Supabase, no billing

Workload Identity Federation accepts any OIDC issuer that publishes discovery,
and Supabase does:
`https://<ref>.supabase.co/auth/v1/.well-known/openid-configuration` returns 200
and advertises a JWKS whose key is **ES256**. Federation is part of IAM and
needs no billing. So an Edge Function could exchange a Supabase JWT for a
federated Google token, impersonate `fcm-sender@`, and call FCM.

The complication, and the reason this is written down: **the service_role key
cannot be used.** Decoding it shows `{"alg":"HS256"}` with `iss: "supabase"` —
a legacy symmetric key with a non-URL issuer, which federation cannot verify.
Only _user_ tokens are ES256 with the URL issuer.

So Option B is really:

1. Create a dedicated Supabase auth user that exists only to be the notifier.
2. Store its credentials in Edge Function secrets.
3. Pin the WIF provider's attribute condition to that user's exact `sub` —
   without this, **any signed-in user of the app could impersonate the FCM
   sender**, which is the same class of mistake as a WIF provider that trusts
   every project on gitlab.com.
4. Edge Function: sign in → ES256 access token → Google STS → impersonate
   `fcm-sender@` → access token → FCM v1.

Four hops, one long-lived password, and a security control that is load-bearing
rather than defensive.

## Recommendation

**Option A.** Not because Option B does not work, but because of what each one
costs to be _sure_ about. Option A has no credential in it: the identity is
attached to the runtime, and if the deploy succeeds it is correct. Option B has
a password, a token exchange, and an attribute condition where a typo silently
widens who can send push notifications to our users — and it is exactly the kind
of chain that appears to work while being subtly wrong.

The price of A is a card on file for a service that will bill ₹0 at this scale.
That is a smaller risk than four hops of auth in a notification path.

## Consequences

Until this is decided, a reply reaching a backgrounded app produces nothing. The
client-side work is not wasted either way — both options send to the same tokens
in the same table, and `pending_pushes` already publishes exactly what a
notification is allowed to contain (who it is from, never what was said).
