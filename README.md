# Pappal

A paid chat marketplace between real people. React Native (bare, New
Architecture) + Supabase Postgres, with Supabase Realtime carrying the messages.
The product name is **Pappal**; the Android/React Native package id remains
`com.companionchat` / `CompanionChat` (ADR-0015).

Members find someone to talk to and talk to them. Providers are real, admitted
people, **there is no model in the message path**. Positioning is peer support
and deliberately not clinical: _"Real people, ready to talk. Not therapy, just
company."_ See [ADR-0001](docs/adr/0001-human-to-human-not-ai-chat.md) for why
that sentence is load-bearing rather than marketing.

Two roles live in one app behind a server-gated role switch
([ADR-0002](docs/adr/0002-provider-surface.md)); CI runs on GitLab
([ADR-0003](docs/adr/0003-ci-on-gitlab.md)).

---

## Run it

```bash
cp .env.example .env       # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm run android
```

`npm run android` uses React Native's `--active-arch-only` path: it selects the
connected device/emulator, reports when none or several are available, and
builds only that device's native ABI instead of four architectures.

Backend, once per project:

```bash
supabase db push           # applies migrations 001–047
supabase config push       # applies auth config; anonymous sign-ins stay DISABLED
```

**Google and Firebase phone OTP are the only sign-in options.** See
[ADR-0004](docs/adr/0004-identity-is-social-login.md) and
[ADR-0006](docs/adr/0006-phone-otp-costs-and-the-dlt-gate.md). Facebook was
removed, not deferred.

Redirect URI for Google:
`https://uvghvhcrovmuwivgijvl.supabase.co/auth/v1/callback`

**Google client type is `Web application`, not `Android`**, despite this being an
Android app. Supabase exchanges the authorisation code server-side and needs the
**client secret** to do it. An Android OAuth client is a public client with no
secret, bound to a package name and SHA-1, and exists for the native Google
Sign-In SDK; Supabase cannot use one. Picking Android is the default mistake here
and the form even demands a SHA-1 fingerprint, which makes it look correct.

Then set the consent screen's **Audience** to Published, or add each tester
explicitly, a new screen starts in Testing and refuses everyone else. No Google
verification review is needed: Supabase requests only `openid`, `email` and
`profile`, which are non-sensitive scopes.

**Create the OAuth client in `chat-d8c87`**, the project that already hosts App
Distribution, not in an unrelated project. Google renders the consent screen's
app name from the _Cloud project_ that owns the client, so borrowing a client
from another product makes the sign-in dialog say that other product's name.
Reusing one is fine to unblock local testing and must not ship: an unfamiliar
brand on a Google permission dialog reads as phishing, and OAuth verification is
per-brand.

**The consent screen will show `<project>.supabase.co`, not the app name**, until
**brand verification** passes. That is a different track from scope verification:
non-sensitive scopes (`openid`, `email`, `profile`) skip the "app isn't verified"
warning, and the app _name and logo_ still stay hidden until the brand is
verified and published. Google shows the domain instead, deliberately, an
unverified app must not be able to claim an arbitrary name.

Brand verification cannot be completed from the console alone. It requires a
homepage and a privacy policy on a domain **you own**, that domain verified in
Google Search Console, and it added as the authorised domain. The current
authorised domain is the Supabase project host, which is not ownable. So this is
blocked on owning a domain, not on a setting.

**Three things that block launch and are not in this repo:**

- a hosted **privacy policy URL**, required by the Google consent screen _and_
  by Play. It has to match what the app actually does, including the report
  retention exception in migration 005: abuse reports outlive deleted accounts.
- a **data deletion URL** for Play's data-safety form. The in-app path exists
  (`delete_user_account()`); Play also wants a web-reachable description of it.
- a **domain you own**, which is the shared prerequisite for all of the above
  _and_ for Google brand verification. One purchase unblocks three things.

Chat send is a single Postgres RPC. Nine Edge Functions sit beside it for
auth exchange, push, SMS, invoices, and Cashfree (`exchange-firebase-token`,
`send-push`, `send-call`, `send-sms`, `send-engagement`, `verify-phone`,
`generate-invoice`, `cashfree-webhook`, `create-order`). Several hold
server-side secrets.

---

## Verify it

| Command                         | What it proves                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`             | `tsc --noEmit`, strict, `noUncheckedIndexedAccess`                        |
| `npm run lint`                  | ESLint, `--max-warnings=0`, no `any`, no unused                           |
| `npm test`                      | Jest: transcript reconciliation, token ledger, Sentry scrubber, contracts |
| `npm run control -- doctor`     | Agent/device lab readiness with machine-readable output                   |
| `npm run security:push`         | Changed-code secrets/SAST + critical production dependency advisories     |
| `npm run review:greptile`       | Greptile review of committed branch changes                               |
| `npm run test:db`               | Migrations + RLS + grants + ledger parity against real Postgres (Docker)  |
| `npm run verify:manifest`       | Play Store permission gate, source and merged manifests                   |
| `npm run bundle:android`        | Metro production bundle, resolves every import for real                   |
| `npm run verify`                | tokens + typecheck + lint + tests + manifest + bundle                     |
| `npm run verify:ci`             | same source/artifact gates, with Jest coverage + Cobertura                |
| `npm run verify:full`           | adds pgTAP                                                                |
| `npm run verify:hermes`         | the shipped APK really contains Hermes bytecode                           |
| `npm run e2e:install`           | device journeys on a booted emulator (needs the CLIs below)               |
| `npm run moderate`              | the moderation queue (needs the service role key)                         |
| `npm run provider`              | reply as a provider, to test the two-sided path from a laptop             |
| `npm run android`               | Debug build/install for the connected ABI only                            |
| `npm run android:release`       | Release APK: R8 + resource shrinking (needs JDK 17 + SDK 36 + NDK 27)     |
| `npm run android:bundle`        | Release AAB for Play upload (`FLAG_SECURE` on)                            |
| `npm run android:bundle:closed` | Closed-test AAB (capture enabled for named testers; never promote)        |

The Jest suite covers client behavior and repository contracts. `npm run
test:db` is the deeper server gate: it builds a
pgTAP-enabled Postgres image, applies the real migration files against a minimal
`auth` schema shim, then runs pgTAP assertions covering two-party RLS
isolation, least-privilege grants, cascade deletion, message immutability, the
directory boundary, blocking, reporting, suspension, rate limits, the
append-only audit trail, PII-free telemetry, and that `deduct_user_token` agrees
with its TypeScript mirror on every row of `supabase/tests/ledger_cases.json`.

`npm run verify` and `npm run verify:ci` share `verify:source` and
`verify:artifact`; CI adds only its coverage reporters. Reproduce the static
GitLab job with `npm run verify:ci`.

Local commits and pushes are gated by Husky. Pre-commit runs staged secret
scanning, lint-staged, and TypeScript. Post-commit runs Greptile because its CLI
reviews committed changes only. Pre-push runs `verify`, changed-code security,
and requires a completed finding-free Greptile review for the exact HEAD. See
[ADR-0031](docs/adr/0031-verification-before-remote.md) and the project
`verify-pappal` skill.

---

## Shape

```
src/
  theme/                 generated from design/tokens.json; contrast budget inline
  lib/                   env, supabase client, Sentry scrubber, ledger, transcript
  api/                   auth, react-query hooks, the Realtime channel
  store/useStore.ts      ephemeral UI state only (zustand)
  components/            bubbles, composer, avatar, sheets, typing indicator
  screens/               OnboardingScreen, AuthScreen, PhoneVerifySheet,
                         HomeScreen, ChatsListScreen, ChatScreen,
                         ProviderDetailScreen, SafetySheet, SettingsSheet,
                         PolicyGateScreen, PaymentSheet, RechargeScreen,
                         TransactionHistoryScreen, BlockedUsersScreen,
                         CallScreen, CallsScreen (stub),
                         MessageActionsSheet, FavouritesScreen,
                         ProviderApplicationScreen, ProviderStatusScreen,
                         ProviderHomeScreen
supabase/
  migrations/            001–047 (schema, wallet, sessions, admin config,
                         Cashfree, retention, invoices, public policy URLs);
                         see docs/ARCHITECTURE.md#database-migrations
  tests/                 pgTAP suite + auth shim, run by npm run test:db
.maestro/                device journeys
.gitlab-ci.yml           5 stages; see Pipeline below
fastlane/                Play upload, staged rollout, halt
scripts/                 verify-manifest, verify-hermes, db-test, e2e,
                         distribute, ci-release-health, gen-tokens,
                         moderate (ops queue), provider-console (test the
                         other side of a conversation)
```

### Why no navigation library

Two destinations, one auth deep link, no stack worth persisting. React
Navigation would add a native-screens dependency and ~15 packages to express
`provider ?? directory`. `App.tsx` holds one piece of state instead, and that
same seam is where the provider role switch attaches, since the server-supplied
role selects the navigation root.

---

## Identity and onboarding

### Members: Google or phone OTP

Google is one tap via Credential Manager. Firebase phone OTP is also live
(`PHONE_AUTH_ENABLED=true`). Facebook was removed, not deferred
([ADR-0006](docs/adr/0006-phone-otp-costs-and-the-dlt-gate.md) §4).

This is the app's **third** identity model, and [ADR-0004](docs/adr/0004-identity-is-social-login.md)
records the trade-offs, because the churn is real:

| Model       | Onboarding | Accountability                    | Cost                       |
| ----------- | ---------- | --------------------------------- | -------------------------- |
| Anonymous   | Perfect    | **None**, banned user back in 10s | Free (disabled)            |
| Phone + OTP | One form   | **Strongest** short of ID         | Per-SMS + DLT registration |
| Google      | One tap    | **Middling**, free accounts       | Free                       |

Two costs worth knowing rather than discovering:

- **Weaker accountability than phone.** Google accounts are free and unlimited,
  so suspension and bans are friction rather than a wall. The controls that still
  bite are the ones not depending on scarce identity: rate limits, the evidence
  snapshot on a report (which survives the account), and per-pair blocking.
- **A disclosure a phone number did not require.** Signing in tells Google that
  you use _this_ app. For an app about loneliness that is real, and the auth
  screen says so rather than letting people find out later.

Instagram is not on the list because it cannot be: Meta shut the Instagram Basic
Display API in December 2024 and Instagram sign-in now runs through Facebook
Login for Business. There is no Supabase provider for it.

### Providers: everything, and an age gate that is a constraint

`ProviderApplicationScreen` → `ProviderStatusScreen` → `ProviderHomeScreen`.
Name, gender, date of birth, headline, languages, about. Reviewed by hand.

**The age gate is a CHECK constraint**, not a form field. `provider_is_adult`
makes an underage provider unrepresentable, there is no route to one through the
app, through the approval function, or through a manual `UPDATE` by an operator
in a hurry. pgTAP asserts that even `service_role` cannot promote a minor.
`date_of_birth` is write-once, so an applicant cannot pass review and then edit
it. The client checks too, but only so a 17-year-old is told at the date field
rather than after filling in six others.

**No status is a dead end.** The application status is a real enum
(`draft / submitted / under_review / needs_info / approved / rejected`) and
`missing_fields` is a structured array, computed server-side at submission and
returned to the form so it can mark the inputs. `needs_info` is resolvable by the
applicant alone, without contacting support.

That design is a direct response to the most instructive thing in the
competitor research, see [docs/clarity-learnings.md](docs/clarity-learnings.md).

Ops side:

```bash
npm run moderate applications              # the queue, oldest first
npm run moderate admit <user-id>
npm run moderate needinfo <user-id> --fields=about,headline --note="..."
npm run moderate decline <user-id> --note="..."
npm run moderate maintenance               # cron this: refunds + reply latencies
```

### Nobody pays for silence

An unaccepted session request expires after 24 hours (ADR-0020). No charge
accumulates until both participants have confirmed live leases. The directory
still publishes a **median reply time**, so "does she actually reply" is
answerable before spending anything, and the provider home screen tells
providers plainly that replying is what earns.

This is the one place the research changed the product rather than the UI: the
most-upvoted negative review of the closest live competitor is about being billed
while the other person said nothing.

---

## Realtime without duplicates

One channel per conversation carries three signals with three different
durabilities, which is why they are not handled the same way:

- **`postgres_changes` on `messages`, durable.** The message exists whether or
  not anyone is listening, so the socket is a delivery optimisation, not the
  source of truth. On `SUBSCRIBED` the query is invalidated, which is what makes
  a dropped connection self-healing.
- **`presence`, connection-scoped.** If the socket drops, "is the other person
  here" is genuinely no. Nothing to persist.
- **`broadcast` typing, disposable.** Throttled at the source, never written
  down.

Realtime enforces RLS on `postgres_changes`, so a client is only ever sent rows
it could have selected. The `conversation_id` filter on the subscription is
bandwidth, not security.

The subtle part is receiving **your own** messages. A send comes back by two
independent paths, the `send_message` response and a Realtime INSERT for the row
it wrote, and either can arrive first. So
[`src/lib/transcript.ts`](src/lib/transcript.ts) is pure and order-independent:
a row whose id is already present replaces it, a row from this session settles
the oldest pending row with the same body, anything else is inserted at its
sorted position. Unit tests in `__tests__/transcript.test.ts` cover the
orderings, including two identical messages sent back to back.

The transcript is `inverted` and the typing indicator renders in
`ListHeaderComponent`, so the `FlatList`'s `data` prop does not change when the
other person starts typing and the list does no layout work.

Note what is deliberately absent: the composer is **not** disabled while a send
is in flight. Blocking input was right against a model that produced one reply
per turn; against a person, sending two messages in a row is normal conversation.

---

## The token economy

Billing is per-minute on active, bilateral sessions. 1 token ≈ ₹1 (stored as
paise). A provider's time is what is sold; sending a message does not debit
the wallet. See ADR-0019 and ADR-0020.

- `send_message` no longer debits tokens (migration 037). The session meter
  runs server-side via `claim_session_lease`. The old Edge Function that
  called a model is deleted (ADR-0001).
- Promo balance spends first; purchased tokens never expire (migration 028).
- The low-balance badge threshold is an admin-configurable knob
  (`low_balance_threshold`, ADR-0023). Nothing is thrown in front of a
  conversation in progress: Recharge opens when the user taps the badge, or
  when a send is attempted with an empty wallet.
- Daily refill is admin-configurable and **disabled by default** (ADR-0021).
  When enabled, the amount is a runtime config knob, not a hardcoded 25.
- Provider share is an admin-configurable integer percent (default 60).
  Payouts are **Cashfree Payouts**, not Stripe Connect (ADR-0021).

### Security notes on the schema

Four things here were bugs first and are now assertions:

**`deduct_user_token` was PUBLIC-executable.** It is `SECURITY DEFINER`, and
Postgres grants `EXECUTE` to `PUBLIC` by default. Left that way, any signed-in
client could call it with someone else's id, or with a negative cost,
`50 - (-100) = 150`, and mint tokens. Migration 002 revokes it and grants it to
`service_role` only; the pgTAP suite asserts that with `function_privs_are`,
which reads the catalog rather than trusting the migration.

**Self-referential RLS silently rejected everything.** Comparing `NEW` against a
subquery on `profiles` inside a policy on `profiles` does not work: the subquery
is itself RLS-filtered, resolves to NULL, and the check is never true, so every
update fails, including harmless ones. Column immutability is a `BEFORE UPDATE`
trigger instead, which sees `OLD` directly.

**That guard was `SECURITY DEFINER`, which disabled it.** Under `SECURITY
DEFINER` `current_user` is the function owner, so the client-role branch is never
taken and a member could set its own `role`, `token_balance` and
`identity_verified_at`, invalidating the entire basis of ADR-0002. Both guards
are `SECURITY INVOKER`, and a contract test fails if either regains `DEFINER`.

**A recipient could rewrite the message sent to them.** Migration 003 gave the
recipient an UPDATE policy so read receipts could be written; what it actually
said was "may update this row", and `body` is a column on that row. With
`replica identity full` on, the edit would then ship to the other participant as
an authentic-looking row. In a product whose safety story rests on proving who
said what, that destroys every transcript as evidence. Migration 004 adds a
column guard: only `read_at` is client-writable, and only as a one-way latch.

**The directory leaked every provider's wallet.** RLS policies for the same
command are OR'd, so 003's "providers are discoverable" SELECT policy did not
merely feed the directory view, it widened `profiles` itself, and any member
could read every provider's balance and verification timestamp. Migration 004
inverts it: `provider_directory` becomes the privileged boundary and the policy
is dropped, so the view's explicit column list is load-bearing rather than
decorative.

---

## Privacy and Play Store compliance

**Permissions.** `INTERNET` and `VIBRATE`. Nothing else. The manifest also
carries `tools:node="remove"` entries for `AD_ID`, media, location and contacts
so no future transitive dependency can reintroduce them through manifest
merging. `npm run verify:manifest` fails the build if anything else appears, and
checks the _merged_ manifest too when a release build exists.

Checking the merged manifest is not theatre, the first release build caught two
permissions the source manifest never asked for:

- `ACCESS_NETWORK_STATE`, contributed by `@sentry/react-native` to tag events
  with a connection type. Now removed via `tools:node="remove"`; Sentry
  permission-checks before reading it and degrades to `UNKNOWN`.
- `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, contributed by
  `androidx.core`. This one is _kept_ and allowlisted by pattern in the verifier:
  it is scoped to our own package, its protection level is `signature`, Play
  never shows it to users, and it exists so `ContextCompat.registerReceiver` can
  protect non-exported dynamic receivers. Removing it would delete a security
  mechanism, not a capability.

**No advertising ID, no analytics SDK, no media access.** The app has no image
input at all, so it needs no storage or photo permission. If avatar upload is
ever added, the route is the system photo picker
(`MediaStore.ACTION_PICK_IMAGES` / `PickVisualMedia`), which needs no runtime
permission, see the note in the manifest.

**`allowBackup="false"`** so auth tokens and cached messages cannot be pulled out
of an adb backup.

**Data deletion, and the one exception.** Settings → _Delete account & all data_
calls `public.delete_user_account()`, which deletes the `auth.users` row. That
cascades to `profiles`, then `conversations`, then `messages`, in one
transaction. No soft delete. The client then calls `signOut()` and returns
to the auth screen. Anonymous sessions are not created.

Migration 005 introduced a deliberate exception, and it is stated here rather
than buried because it makes the previous paragraph less absolute than it was.
**Abuse reports outlive the accounts involved.** A report has to survive the
reported message, or the remedy for "he sent me something illegal" is to destroy
the only evidence of it, and the accused can erase the case against them by
deleting their account. So `reports` keeps a snapshot of the reported text, and
`reporter_id` / `subject_user_id` are `on delete set null`: the report survives,
de-identified.

Retention is bounded in code rather than promised in a policy:
`purge_expired_reports()` drops resolved reports 90 days after resolution, and
`npm run moderate purge` runs it.

**Voice note audio needs its own sweep, and this is why.** The recordings live in
a private Supabase Storage bucket, and storage has no foreign key to `messages`.
So deleting an account cascades the rows away and leaves the audio behind:
orphaned, unreachable through the app, and still stored. `purge_orphaned_voice_notes()`
deletes any object with no live message and no live report pointing at it, after a
24 hour grace period so a recording that is uploaded but not yet sent is not
deleted out from under the composer. It runs nightly on pg_cron and
`npm run moderate maintenance` runs it too. Reported audio is exempt, for the same
reason the reported text is: it is the evidence.

Nothing else survives deletion.

**Sentry.** `src/lib/sentry.ts` scrubs in two layers before anything leaves the
device: whole fields that exist to carry payloads are deleted (`request.data`,
breadcrumb `data`, stack-frame locals, any key named like content), and the
free-text that remains is stripped of emails, IPs, phone numbers and
bearer/JWT credentials. `event.message` is redacted wholesale, the app never
calls `captureMessage`, so anything appearing there came from an integration we
did not write. `__tests__/sentry.test.ts` covers the scrubber.

---

## Trust and safety

Five primitives, in the order an incident actually moves through them.

**Blocking** is the remedy that needs no operator and no waiting, so it is a
direct table write under RLS. It is **symmetric**, blocking someone also stops
them reaching you, because a one-way block would hand the blocker a megaphone
aimed at someone who wanted them gone. And the blocked party is **never told**:
there is no policy that lets anyone read who blocked them, and `is_blocked_pair`
is not callable by a client, because "you have been blocked" is the disclosure
that turns a block into a reason to make a second account.

**Reporting** goes through `submit_report`, which verifies the reporter is a
participant, infers the subject from the thread rather than trusting the client,
and snapshots the reported message. It refuses to snapshot the reporter's own
message, so a report cannot be used to pin your words on the other party, and it
only reads messages from the reported conversation, so it cannot exfiltrate text
from a thread you are not in. Reporting is itself rate limited at 10/hour,
mass false reports are a harassment vector and they bury the real queue.

**The audit trail** (`moderation_actions`) is append-only, enforced by a trigger
rather than by intent, because `service_role` bypasses RLS and would otherwise be
free to rewrite history. No client role can read it at all.

**Enforcement** is `profiles.suspended_until`, checked in `send_message` and
`open_conversation` so a suspended user cannot open a fresh thread to route
around it. A ban is a suspension with no end, so there is one code path instead
of two that can disagree. A suspended provider also drops out of the directory.

**Rate limiting** is 20 messages/minute, high enough that a fast human typing
short lines never sees it, low enough that scripted flooding stops being viable.

None of these debit a token. Every rejection happens before the wallet is
touched, which the pgTAP suite asserts directly rather than assuming.

### The queue

```bash
npm run moderate list                       # open reports, minor_safety first
npm run moderate show <report-id>           # detail plus the evidence snapshot
npm run moderate act <id> --action=suspended --days=7 --note="..."
npm run moderate dismiss <id> --note="..."
npm run moderate metrics --days=14
```

A CLI rather than a web console, and that is the honest sequencing: what a queue
needs first is that reports are _seen_ and that acting on one is recorded. Every
action goes through the same tables a console would, so building the UI later is
a UI change and not a rewrite. `minor_safety` and `self_harm` sort first
regardless of age, and the triage list carries a **priors** column, because a
repeat subject should not look like a first-time report.

Suspending or banning asks for confirmation, and the audit row is written
_before_ the enforcement, so an action can never exist without a record of who
ordered it.

### Still missing

**Classification.** Everything above is reactive: it needs a human to be harmed
and then to report. Proactive detection, CSAM hashing, grooming and
solicitation classifiers, off-platform contact detection, is not built. This is
where AI legitimately belongs in this product: classification, not generation.

**A staffed queue.** A queue nobody reads is theatre. The tooling exists; the
rota does not.

**KYC.** The age gate is enforced, but on a self-declared date of birth.
`identity_verified_at` is set by the approval function, not by a vendor. A
document check (Persona, Veriff, Stripe Identity) is a launch requirement, not a
nice-to-have, a constraint on a number someone typed is a floor, not proof.

**Payouts.** Cashfree Payouts is the chosen rail (ADR-0021). Provider payouts
are not yet running pending TDS/legal sign-off, but the settlement model is
Cashfree, not Stripe.

---

## Telemetry and observability

Two layers, deliberately separate.

**Sentry** for crashes and errors, scrubbed in two passes before anything leaves
the device (see the privacy section). That covers "did it break".

**A first-party `events` table** for behaviour. That covers "is it being used,
and is it being abused". There is no third-party analytics SDK, and that is a
constraint rather than a preference: the manifest gate permits exactly INTERNET
and VIBRATE, and the Play data-safety declaration says no advertising id and no
analytics SDK. Adding Firebase Analytics or PostHog would make both statements
false and would likely add a permission through manifest merging.

The table is structurally unable to carry a message:

- `name` must be on an allowlist, an unknown event is rejected at insert rather
  than quietly stored, so the column cannot be used to smuggle free text
- `props` keys matching `body|message|content|text|detail|email|phone|name|token`
  are **rejected by a trigger**, not filtered client-side, because the client is
  the least trustworthy place to enforce that
- `props` is capped at 2 KB
- the client has `INSERT` and nothing else: there is no SELECT policy _and_ the
  grant is revoked, so a client cannot read events back, not even its own

`__tests__/telemetry.test.ts` asserts the TypeScript union and the SQL allowlist
are identical, so adding an event in one place and not the other is a failing
test rather than a silent runtime rejection.

### Dashboards

`public.safety_metrics` aggregates the signals worth watching daily: messages
sent, sends rejected, reports filed, blocks created, active users.

```bash
npm run moderate metrics --days=14
```

For Grafana, add a **PostgreSQL** datasource pointing at the Supabase connection
string with a read-only role, and query `safety_metrics` and `moderation_queue`
directly, no exporter and no extra service. Create the role rather than reusing
`postgres`:

```sql
create role grafana_ro login password '...';
grant usage on schema public to grafana_ro;
grant select on public.safety_metrics, public.moderation_queue to grafana_ro;
```

Watch **ratios, not counts**: reports or blocks per active user climbing is the
abuse signal. Raw counts just track growth.

---

## Accessibility

- Body text is 16sp and every `Text` allows font scaling.
- The theme is light-first with a full dark mode, generated from
  `design/tokens.json`. Primary **and** secondary text clear WCAG AAA (7:1) in
  **both** modes, asserted in `__tests__/theme.test.ts`, which computes the
  ratios rather than trusting a comment. Secondary text was `#8A8A8E` at 3.13:1
  and failed AA outright until that test was written.
- **The accent never carries small text.** It is used for the send button, the
  low-balance pill and the typing dots. `text/onAccent` is only required to clear
  3:1 because it is never body copy.
- Touch targets are at least 44×44 with 8pt of hit slop.
- The typing indicator is a `progressbar` and failures land in an `alert` role
  rather than a modal.
- No SVG. `react-native-svg` inside a Reanimated view caused
  `synchronouslyUpdateUIProps failed` and killed touch handling on the whole
  subtree, so `Icon` draws glyphs from borders and views instead.

---

## Pipeline

Five stages on GitLab. Each is a gate: nothing reaches a device unless the
earlier stages are green.

```
pre-commit   .husky/pre-commit -> lint-staged + tsc      (~8s, local)
             .husky/commit-msg -> commitlint             conventional commits
    |
static       gitleaks, a grep for service-role keys, commitlint on the MR range,
             design-token drift, tsc --noEmit, eslint --max-warnings=0,
             jest --coverage
    |
verify       pgTAP against a real Postgres service: schema, two-party RLS,
             grants, cascade, message immutability, ledger parity
    |
build        manifest gate (source), assembleRelease + bundleRelease,
             manifest gate (merged), Hermes bytecode validation
    |
deliver      Firebase App Distribution to the founders group, on main
    |
release      tag-only and manual: supabase db push, then fastlane supply
             -> internal, crash-free watch -> widen or halt at 0%
```

Runner selection is a CI variable rather than a hardcoded tag: `RUNNER_TAG` and
`ANDROID_RUNNER_TAG` default to `saas-linux-medium-amd64`, and pointing either at
`linux-docker` moves that class of job onto the self-hosted runner when the
shared minutes run out.

`publish-pgtap-image` is a **manual** job that must run once before `database`
can pass, it builds `supabase/tests/Dockerfile` into the project registry.

### static

The secret scan is gitleaks with [.gitleaks.toml](.gitleaks.toml) (patterns for
Supabase service-role JWTs, `sbp_` tokens and Play service accounts) plus a plain
`git grep` for the ones that would be catastrophic. The Supabase anon key and the
Sentry DSN are deliberately _not_ flagged, both are public by design. The Figma
file key in `design/tokens.json` is allowlisted by field name with
`condition = "AND"`, so the file is still scanned and a real key pasted into it
still fails the build.

The database job is real pgTAP against a real Postgres, not a mock. It uses
`policies_are` and `function_privs_are`, which compare against the catalog, so a
policy or a revoke silently dropped by a future migration fails the build rather
than passing on a technicality.

### build, headless compliance

Three checks that only mean anything against a built artefact:

- **Merged manifest.** The source manifest is a statement of intent; the merged
  manifest is what ships. See the permissions section for the two entries this
  caught.
- **Hermes bytecode.** If `hermesEnabled` gets flipped, the APK still installs
  and still runs, just slower, with no bytecode precompilation and nothing in
  the logs. [verify-hermes.mjs](scripts/verify-hermes.mjs) reads the 8-byte HBC
  magic out of `assets/index.android.bundle` inside the APK.
- **Signing.** The release build refuses the debug keystore and comes out
  unsigned when `keystore.properties` is absent, so a missing key is a visible
  gap rather than a debug-signed upload.

### Device journeys

[Maestro](https://maestro.mobile.dev), not Detox: Detox needs an `androidTest`
source set, a second APK and a native runner wired into Gradle, and these flows
only need the accessibility tree. The signed-in flows install a short-lived local
Supabase session through a deep-link filter in `src/debug`; release manifests
and non-debug JavaScript categorically exclude that test entry point.

Maestro cannot cut the network, seed a wallet, admit a provider or read a
database, and most of the journeys need exactly that, so
[e2e.mjs](scripts/e2e.mjs) owns everything around the flows: an admitted provider,
a real member auth session, current policy acceptance, capability permissions,
wallet state, connectivity, and SQL assertions.

| Journey               | What it actually proves                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `01-instant-launch`   | cold welcome reaches supported auth options; unsupported paths and early permissions stay absent |
| `02-send-and-persist` | first message creates a pending bilateral chat request and survives a relaunch                   |
| `03-token-economy`    | pending messages create no per-send debit; Recharge opens only on request                        |
| `04-network-faults`   | radios off: failure surfaced, optimistic bubble withdrawn, and **no wallet movement** (SQL)      |
| `05-offline-resume`   | sending works again with no restart, no pull-to-refresh, no manual retry                         |
| `06-account-deletion` | the UI path, then a SQL assertion that no conversation and no message survived                   |

**Known gap.** These prove the sender's half and pending-session behavior.
Acceptance, bilateral leases, delivery, typing, presence, receipts, and live
per-minute metering need two authenticated devices. That gate is explicitly
deferred; the database suite covers its server invariants in the meantime.

### release

Migrations ship **before** the app: a new client against an old schema is broken,
the reverse is fine. Release health is watched by
[ci-release-health.mjs](scripts/ci-release-health.mjs), which exits non-zero
below 99.8% crash-free so the pipeline can run `fastlane halt_rollout` before the
build reaches more users. It reports "pending" rather than "healthy" when there
are too few sessions to judge, treating silence as success is how a bad build
gets promoted. Halting sets the rollout to 0%: Play cannot un-publish a version
code, so the recovery path is halt, then ship a fix forward.

### What runs where

`npm run verify:full` covers the static and verify stages locally. Device
journeys need a booted emulator plus the `supabase`, `maestro`, `adb` and `psql`
CLIs. CI variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`,
`SENTRY_DSN`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `FIREBASE_APP_ID`,
`FIREBASE_PROJECT_ID`, and for the release stage `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.

### Distribution is keyless

There is **no** `FIREBASE_SERVICE_ACCOUNT_JSON`, and there cannot be: the GCP
project sits under an organisation enforcing
`constraints/iam.disableServiceAccountKeyCreation`. Rather than ask for the
policy to be weakened, `distribute` uses Workload Identity Federation, which is
the better answer anyway, nothing long-lived exists to leak, rotate or forget.

GitLab signs a short-lived OIDC token for the job; Google STS verifies it against
the `gitlab` provider in the `gitlab-pool` pool and returns a federated token
that impersonates `app-distribution-ci@`. Two conditions on the Google side are
what make that safe rather than "any GitLab.com project may impersonate our
release identity":

- the provider's attribute condition pins `assertion.project_path` to
  `ARenigma/chat` **and** requires `assertion.ref_protected == 'true'`
- the `roles/iam.workloadIdentityUser` binding is to a `principalSet` scoped to
  that same `project_path`

`main` is a protected branch, so the second condition holds for real releases
while refusing a token minted from a fork or an unprotected feature branch. The
service account holds only `roles/firebaseappdistro.admin`, which already
includes `firebase.projects.get`, no broader grant was needed.

Setup, for the record (one-off, already applied):

```bash
gcloud iam workload-identity-pools create gitlab-pool --location=global
gcloud iam workload-identity-pools providers create-oidc gitlab \
  --workload-identity-pool=gitlab-pool --location=global \
  --issuer-uri="https://gitlab.com" --allowed-audiences="gitlab-chat-ci" \
  --attribute-mapping="google.subject=assertion.sub,attribute.project_path=assertion.project_path,..." \
  --attribute-condition="assertion.project_path == 'ARenigma/chat' && assertion.ref_protected == 'true'"
gcloud iam service-accounts add-iam-policy-binding app-distribution-ci@... \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<NUM>/locations/global/workloadIdentityPools/gitlab-pool/attribute.project_path/ARenigma/chat"
```

`npm run ship` still distributes from a laptop when that is quicker.

---

## Release

```bash
cp android/keystore.properties.example android/keystore.properties   # fill in
npm run android:bundle                                              # -> AAB
```

R8 with resource shrinking is on, the release build refuses to use the debug
keystore, and native symbols ship at `SYMBOL_TABLE` level for Play Console crash
reports. Without `keystore.properties` the release build still assembles,
unsigned, so CI can verify the build without holding the upload key.

Verified on this toolchain (JDK 17.0.20, AGP via RN 0.86.2, Gradle 9.3.1, SDK 36,
NDK 27.1.12297006):

- `assembleRelease` and `bundleRelease` both succeed with R8 minification and
  resource shrinking enabled.
- With `keystore.properties` present the APK verifies under APK Signature
  Scheme v2 against the configured upload key, and the AAB carries
  `META-INF/UPLOAD.RSA`. Without it, both artefacts come out unsigned rather
  than debug-signed.
- The built APK declares exactly `INTERNET`, `VIBRATE` and the androidx
  signature permission, with `allowBackup=false` and
  `usesCleartextTraffic=false`.
- The universal APK is ~68 MB because it carries all four ABIs; the AAB is
  ~50 MB and Play splits it per device, so actual download is a fraction of
  that.
