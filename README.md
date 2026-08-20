# CompanionChat

An anonymous-first companion chat app. React Native (bare, New Architecture) +
Supabase Postgres + one Deno Edge Function that streams OpenAI over SSE.

The whole product is two screens: pick a companion, talk to it. Everything else
in this repo exists to make those two screens fast, private and cheap to run.

---

## Run it

```bash
cp .env.example .env       # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm run android
```

Backend, once per project:

```bash
supabase db push                                   # applies both migrations
supabase secrets set OPENAI_API_KEY=sk-...          # server-only, never in .env
supabase functions deploy stream-chat
```

Enable **Anonymous sign-ins** in Supabase → Authentication → Sign In / Up, and
**Manual linking** if you want the optional Google/phone link to work.

---

## Verify it

| Command                   | What it proves                                                           |
| ------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`       | `tsc --noEmit`, strict, `noUncheckedIndexedAccess`                       |
| `npm run lint`            | ESLint, `--max-warnings=0`, no `any`, no unused                          |
| `npm test`                | Jest: SSE parser, token ledger, Sentry scrubber, store, contracts        |
| `npm run test:db`         | Migrations + RLS + grants + ledger parity against real Postgres (Docker) |
| `npm run verify:manifest` | Play Store permission gate, source and merged manifests                  |
| `npm run bundle:android`  | Metro production bundle — resolves every import for real                 |
| `npm run check:edge`      | `deno check` on the Edge Function (needs Deno)                           |
| `npm run verify`          | typecheck + lint + tests + manifest + bundle                             |
| `npm run verify:full`     | adds pgTAP and the Deno checks                                           |
| `npm run verify:hermes`   | the shipped APK really contains Hermes bytecode                          |
| `npm run e2e:install`     | Stage 3 journeys on a booted device (needs the CLIs below)               |
| `npm run android:release` | Release APK: R8 + resource shrinking (needs JDK 17 + SDK 36 + NDK 27)    |
| `npm run android:bundle`  | Release AAB for Play upload                                              |

`npm run test:db` is the interesting one: it builds a pgTAP-enabled Postgres
image, applies the real migration files against a minimal `auth` schema shim, then
runs 68 pgTAP assertions covering RLS isolation, the least-privilege grants,
cascade deletion, and that `deduct_user_token` agrees with its TypeScript mirror on
every row of `supabase/tests/ledger_cases.json`.

---

## Shape

```
src/
  theme/tokens.ts        immutable design tokens; contrast budget documented inline
  lib/                   env, supabase client, Sentry scrubber, ledger, haptics
  api/                   auth, react-query hooks, the SSE read path
  store/useStore.ts      ephemeral UI state only (zustand)
  components/            SpringButton, TokenBadge, bubbles, composer, sheets
  screens/               PersonaScreen, ChatScreen, SettingsSheet
supabase/
  migrations/            001 schema + wallet, 002 bootstrap + grants + RPCs
  functions/_shared/     code both runtimes import: sse, ledger, personas, protocol
  functions/_shared/prompts.ts   server-only; never reaches the bundle
  functions/stream-chat/ the one Edge Function
  tests/                 pgTAP suite + auth shim, run by npm run test:db
.maestro/                Stage 3 device journeys
.github/workflows/       ci (stages 1-2), e2e (stage 3), release (stage 4)
fastlane/                Play upload, staged rollout, halt
scripts/                 verify-manifest, verify-hermes, db-test, e2e, openai-stub,
                         ci-release-health
```

### One implementation, two runtimes

`supabase/functions/_shared/` is imported by both Metro and Deno. The SSE
parser, the token ledger and the persona registry therefore cannot drift between
client and server — there is only one of each. `src/lib/tokenLedger.ts` and
`src/lib/personas.ts` are thin re-exports that give the app a tidy import path.

### Why no navigation library

Two destinations, one auth deep link, no stack worth persisting. React
Navigation would add a native-screens dependency and ~15 packages to express
`persona ?? selector`. `App.tsx` holds one piece of state instead.

---

## Streaming without jitter

Three decisions, in order of impact:

1. **Deltas are frame-batched.** `src/api/stream.ts` accumulates text and
   publishes to the store at most once per `requestAnimationFrame`. A fast model
   emits 30–60 deltas a second; unbatched that is 60 React commits a second.
2. **The live reply is not in the list.** It renders in
   `ListHeaderComponent`, so the `FlatList`'s `data` prop is byte-identical for
   the whole stream and the transcript does no layout work at all.
3. **The list is `inverted`.** The transcript is anchored to the bottom, so a
   keyboard opening or a bubble growing changes nobody's scroll offset.

`StreamingBubble` is the only component subscribed to the streaming text, and
`MessageBubble` is memoised on `content` + `sender`, so a reconciliation after
the stream ends re-renders exactly one row.

---

## The token economy

1 message = 1 token. Not per character, not per reply length.

- `deduct_user_token` is a single `SELECT … FOR UPDATE` + `UPDATE`, so two
  concurrent sends cannot both spend the last token.
- The debit happens **before** generation and is **refunded** if the model never
  produced text, so a provider outage is never billed.
- The balance shown in the top bar comes from the RPC's own return value, not
  from a client-side guess.
- Below 3 tokens the badge gains a `REFILL` affordance. Nothing is ever thrown
  in front of a conversation in progress: the sheet opens only when the user taps
  the badge, or when a send is attempted with an empty wallet.
- `claim_daily_tokens` grants 25 tokens at most once per 24 hours.

### Security note on the wallet

`deduct_user_token(p_user_id, p_cost)` is `SECURITY DEFINER`, and Postgres
grants `EXECUTE` to `PUBLIC` by default. Left that way, any signed-in client
could call it with someone else's id, or with a negative cost — `50 - (-100) =
150` — and mint tokens. Migration `002` revokes it from `PUBLIC` and grants it to
`service_role` only; `supabase/tests/010_schema_and_rls.sql` asserts that with
`function_privs_are`, which reads the catalog rather than trusting the migration.

The Edge Function holds the service role key and so bypasses RLS. It therefore
re-checks chat ownership by hand before writing a message, because `chatId` from
a client is untrusted input.

---

## Privacy and Play Store compliance

**Permissions.** `INTERNET` and `VIBRATE`. Nothing else. The manifest also
carries `tools:node="remove"` entries for `AD_ID`, media, location and contacts
so no future transitive dependency can reintroduce them through manifest
merging. `npm run verify:manifest` fails the build if anything else appears, and
checks the _merged_ manifest too when a release build exists.

Checking the merged manifest is not theatre — the first release build caught two
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
permission — see the note in the manifest.

**`allowBackup="false"`** so auth tokens and cached messages cannot be pulled out
of an adb backup.

**Data deletion.** Settings → _Delete account & all data_ calls
`public.delete_user_account()`, which deletes the `auth.users` row. That cascades
to `profiles`, then `chats`, then `messages`, in one transaction. No soft delete,
no retention window. The app then starts a fresh anonymous session.

**Sentry.** `src/lib/sentry.ts` scrubs in two layers before anything leaves the
device: whole fields that exist to carry payloads are deleted (`request.data`,
breadcrumb `data`, stack-frame locals, any key named like content), and the
free-text that remains is stripped of emails, IPs, phone numbers and
bearer/JWT credentials. `event.message` is redacted wholesale — the app never
calls `captureMessage`, so anything appearing there came from an integration we
did not write. 30 unit tests cover the scrubber.

---

## Accessibility

- Body text is 16sp and every `Text` allows font scaling.
- Contrast against the obsidian background: white 19.1:1, secondary 8.5:1 — both
  past WCAG AAA's 7:1.
- **`accent` never carries text.** Indigo on obsidian is 4.3:1, which is fine for
  a border or a dot and not fine for a label. Primary buttons are therefore an
  accent-bordered surface with a white label, not an indigo fill.
- Touch targets are at least 44×44 with 8pt of hit slop.
- The streaming bubble is an `accessibilityLiveRegion`, the typing indicator is a
  `progressbar`, and failures land in an `alert` role rather than a modal.

---

## Pipeline

Four stages. Each one is a gate: nothing reaches a device unless stages 1-2 are
green, and nothing reaches Play unless stage 3 is.

```
pre-commit   .husky/pre-commit -> lint-staged + tsc      (~8s, local)
             .husky/commit-msg -> commitlint             conventional commits
    |
stage 1      .github/workflows/ci.yml
             gitleaks + trufflehog + a grep for service-role / OpenAI keys
             tsc --noEmit, eslint --max-warnings=0, jest
             deno check + deno lint on the Edge Function
             pgTAP: schema, RLS, grants, cascade, ledger parity
    |
stage 2      same workflow, `build` job
             manifest gate (source), assembleRelease + bundleRelease,
             manifest gate (merged), Hermes bytecode validation,
             Sentry release + source maps
    |
stage 3      .github/workflows/e2e.yml
             API 30/33/34/36 x low/high DPI, Maestro flows in .maestro/
             fault injection and SQL cascade proof via scripts/e2e.mjs
    |
stage 4      .github/workflows/release.yml
             re-runs stages 1-2 against the tag, deploys the Edge Function,
             fastlane supply -> internal then 10% beta,
             crash-free watch -> widen to 50% or halt the rollout at 0%
```

### Stage 1 — static and security

The secret scan runs three ways because they miss different things: gitleaks with
[.gitleaks.toml](.gitleaks.toml) (patterns for Supabase service-role JWTs,
`sbp_` tokens, OpenAI keys and Play service accounts), trufflehog with
`--results=verified` (only credentials it can prove are live), and a plain
`git grep` for the two that would be catastrophic here. The Supabase anon key
and the Sentry DSN are deliberately _not_ flagged — both are public by design.

The database job is real pgTAP against a real Postgres, not a mock. It uses
`policies_are` and `function_privs_are`, which compare against the catalog, so a
policy or a revoke silently dropped by a future migration fails the build rather
than passing on a technicality.

### Stage 2 — build and headless compliance

Three checks that only mean anything against a built artefact:

- **Merged manifest.** The source manifest is a statement of intent; the merged
  manifest is what ships. See the permissions section above for the two entries
  this caught.
- **Hermes bytecode.** If `hermesEnabled` gets flipped, the APK still installs
  and still runs — just slower, with no bytecode precompilation and nothing in
  the logs. [verify-hermes.mjs](scripts/verify-hermes.mjs) reads the 8-byte HBC
  magic out of `assets/index.android.bundle` inside the APK.
- **Signing.** The release build refuses the debug keystore and comes out
  unsigned when `keystore.properties` is absent, so a missing key is a visible
  gap rather than a debug-signed upload.

### Stage 3 — real-device journeys

[Maestro](https://maestro.mobile.dev), not Detox: Detox needs an `androidTest`
source set, a second APK and a native runner wired into Gradle, and the flows
here only ever need the accessibility tree. The build under test stays
byte-identical to the one that ships and the app carries no test-only native
dependency.

Maestro cannot cut the network, seed a wallet, or read a database, and three of
the five journeys need exactly that — so [e2e.mjs](scripts/e2e.mjs) owns
everything around the flows:

| Journey               | What it actually proves                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `01-instant-launch`   | anonymous session and 50 tokens exist by the first frame; no permission dialog, no sign-in wall              |
| `02-chat-stream`      | composer to persisted transcript, exact reply text, balance down by exactly one, survives a relaunch         |
| `03-token-economy`    | badge flips to `REFILL` under 3 tokens without a modal; the sheet only opens on request                      |
| `04-network-faults`   | radios off mid-journey: failure surfaced, token refunded, optimistic bubble rolled back rather than orphaned |
| `05-offline-resume`   | sending works again with no restart, no pull-to-refresh, no manual retry                                     |
| `06-account-deletion` | the UI path, then a SQL assertion that zero chats and zero messages survived                                 |

Replies come from [openai-stub.mjs](scripts/openai-stub.mjs), a deterministic
OpenAI-compatible SSE endpoint, for two reasons: a live model changes its wording
every run so no assertion can be exact, and four emulators billing real tokens on
every push adds up. The stub deliberately splits each `data:` line across two
socket writes, and `fail-upstream` / `fail-midstream` / `slow` models let the
suite drive the failure paths on demand. The Edge Function reaches it through
`OPENAI_BASE_URL`, which is also the seam for Azure OpenAI or a gateway.

`__tests__/streamIntegration.test.ts` runs the same stub against the same parser
over a real socket in Jest — the cheapest possible check that the client can read
what the server writes, with no emulator and no Supabase.

### Stage 4 — deploy and rollout

The Edge Function ships **before** the app. A new client against an old function
is broken; an old client against the new function is fine, because the wire
contract is additive and the client ignores unknown SSE events.

Release health is watched by [ci-release-health.mjs](scripts/ci-release-health.mjs),
which exits non-zero below 99.8% crash-free so the workflow can run
`fastlane halt_rollout` before the build reaches more users. It reports "pending"
rather than "healthy" when there are too few sessions to judge — treating silence
as success is how a bad build gets promoted. Note that halting sets the rollout to
0%: Play cannot un-publish a version code, so the recovery path is halt, then ship
a fix forward.

### What runs where

`npm run verify:full` covers stages 1 and 2 locally. Stage 3 needs a booted
emulator plus the `supabase`, `maestro`, `adb` and `psql` CLIs; stage 4 needs the
Play and Sentry credentials. Required secrets: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
`SUPABASE_DB_PASSWORD`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.

---

## Release

```bash
cp android/keystore.properties.example android/keystore.properties   # fill in
npm run android:bundle                                              # -> AAB
```

R8 with resource shrinking is on, the release build refuses to use the debug
keystore, and native symbols ship at `SYMBOL_TABLE` level for Play Console crash
reports. Without `keystore.properties` the release build still assembles —
unsigned — so CI can verify the build without holding the upload key.

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
