# ADR-0007, The push key lives in an Edge Function

Status: **accepted, and working end to end**
Date: 2026-08-21
Resolves [ADR-0005](0005-push-sender-needs-billing-or-a-token-chain.md), which was left open

## What was decided

Neither of ADR-0005's two options. Instead: relax the org policy long enough to
mint one service-account key, re-enforce it immediately, and put the key in the
Edge Function's secrets.

One hop. No VM, no container, no billing account, no four-stage token exchange.

```
pg_cron (1/min) → dispatch_pending_pushes() → pg_net → send-push Edge Function
                                                          ↓ RS256 JWT
                                                       Google OAuth
                                                          ↓ bearer
                                                        FCM v1
```

## Why this beats both options in ADR-0005

ADR-0005 recommended Cloud Run because it holds no credential at all, and that
argument still stands on its own terms. What changed is the price: both billing
accounts on this org are `"open": false`, so Option A was not "a card on file",
it was "resolve a billing problem first". Option B's four hops and load-bearing
attribute condition were the thing that ADR actively warned about.

This option has one credential and one hop. The credential is the cost; the
single hop is what you get for it.

## What the relaxation actually was

`constraints/iam.disableServiceAccountKeyCreation` was enforced on `chat-d8c87`.
The account held `roles/resourcemanager.organizationAdmin` at the org but not
`orgpolicy.policyAdmin`, so the sequence was: grant the policy role, disable the
constraint **scoped to this one project** (not the org), enable
`orgpolicy.googleapis.com`, wait for propagation, the first key attempt failed
because the policy had not propagated yet, not because it was still set, create
the key, then re-enforce.

The window was minutes and the scope was one project. The constraint is enforced
again now:

```
gcloud resource-manager org-policies describe \
  constraints/iam.disableServiceAccountKeyCreation --project=chat-d8c87 --effective
# booleanPolicy: enforced: true
```

## What the key can do, and what it cannot

`fcm-sender@chat-d8c87.iam.gserviceaccount.com` holds exactly
`roles/firebasecloudmessaging.admin`. If it leaked, the holder could send
notifications to devices registered to this Firebase project. They could not read
messages, reach the database, or touch anything in GCP, it is not an owner key,
and this is why the sender got its own service account rather than reusing
anything broader.

It is stored as the `FCM_SERVICE_ACCOUNT` Edge secret, and locally in
`.secrets/fcm-sender.json`, which is gitignored (`git check-ignore` verified, not
assumed).

## Rotation, since a key that cannot be rotated is worse than no key

Rotation needs the constraint lifted again, so it is deliberately a documented
sequence rather than a script anyone can run by accident:

```
gcloud resource-manager org-policies disable-enforce \
  constraints/iam.disableServiceAccountKeyCreation --project=chat-d8c87
gcloud iam service-accounts keys create .secrets/fcm-sender.json \
  --iam-account=fcm-sender@chat-d8c87.iam.gserviceaccount.com
# set the secret from a mode-600 env file, never as a shell argument
supabase secrets set --env-file .secrets/edge.env
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account=fcm-sender@chat-d8c87.iam.gserviceaccount.com
gcloud resource-manager org-policies enable-enforce \
  constraints/iam.disableServiceAccountKeyCreation --project=chat-d8c87
```

**Migrate to Cloud Run when billing is open.** This is not a permanent
architecture; it is the right one while a card on file is the blocker. The Edge
Function's logic does not change, only where the bearer token comes from.

## Latency, stated rather than discovered

`pg_cron`'s floor is one minute, so a backgrounded reply waits **up to 60
seconds**. While the app is foregrounded, Realtime already delivers instantly, so
this only governs the notification case.

A database webhook on insert would make it immediate, at the cost of putting the
service-role key in Vault for `pg_net` (already done for the cron) and a cold
start per message. Worth doing; not worth blocking the first release on.

## Three things this cost that the design did not predict

1. **`pending_pushes` had no sender id.** The notification could be delivered but
   not _opened_, `src/lib/push.ts` routes on `data.peerId`. Migration 009 adds
   `peer_id`. It had to `drop view` rather than `create or replace`, because a
   replace can only append columns and the id belongs next to
   `conversation_id`.
2. **The secret was double-encoded.** `JSON.stringify(fileContents)` is the
   natural way to get multi-line JSON onto one env line, and it makes
   `JSON.parse` return a string rather than an object. The failure surfaced four
   calls later inside `pemToDer` as an opaque 500. The function now unwraps one
   layer and validates the three fields it needs.
3. **The notification icon was a white ring.**
   `react-native-firebase_messaging` ships
   `default_notification_color = @color/white` in its own manifest and no icon,
   so the library was tinting our launcher icon's alpha mask pure white. Both
   halves were defaults, neither was ours. Fixed with a 24dp monochrome
   `ic_notification` and `tools:replace` on the colour.

All three were found on a device. None of them would have failed a build.

## What the notification says

"Ada / replied". Never the message. `pending_pushes` does not select a body, so
there is no code path that could leak one even by mistake, the privacy decision
is enforced by the shape of the view rather than by remembering not to.
