# Provider payouts

How a provider gets paid: link a bank account or UPI VPA + a PAN, get verified,
and receive weekly payouts via **Cashfree Payouts**. This doc is the single source
of truth for the moving parts and, importantly, **how to turn verification on once
the Cashfree Payouts product is enabled on the account** (it is not yet).

Scope decisions (Amit, 2026-09-03):

- **No KYC** via Aadhaar / document upload / liveness. The only PII collected for
  payout is **name / phone / email** (already on the profile) + **bank account or
  UPI** + **PAN**.
- **PAN is mandatory** (migration 049). Without a verified PAN, TDS-194O
  withholding is 5% instead of 0.1%, so a provider is not payout-ready until both
  the payout account AND the PAN are verified.

Economics live in [ADR-0021](adr/0021-principal-marketplace-economics.md) (60/40
split, weekly cadence, 7-day hold, ₹500 minimum) and the vendor choice in
[ADR-0022](adr/0022-india-user-choice-billing.md) (Cashfree for collection AND
disbursement; "no provider listed until the payout account is verified").

---

## Data model

Pre-existing (do not rebuild): `provider_earnings_ledger` + `provider_payout_batches`
(migration 029), admin `payouts` config (026: cadence/hold_days/minimum_paise/
provider_share_percent), session accrual (037).

Settlement clear job (migration 058): `clear_pending_earnings()` runs hourly via
pg_cron (`clear-pending-earnings`) and flips `pending → cleared` once
`hold_until <= now()`. Without it, `create_provider_payout_batch` never sees
real accruals.

Media COGS (migration 059): `media_vendor_usage_daily` + `media_channel_usage`

- `admin.call_margin` / `admin.daily_media_margin` / `admin.session_margin`.
  Edge function `agora-usage-ingest` pulls Console project-day usage (reference;
  invoice CSV is money truth). Channel name = `call_id`.

Added for payout linking:

| Object                              | Migration | Purpose                                                               |
| ----------------------------------- | --------- | --------------------------------------------------------------------- |
| `provider_payout_accounts`          | 048       | bank/UPI destination + `cashfree_beneficiary_id` + verification state |
| `provider_tax_profile`              | 048       | PAN + Cashfree-returned name + status (tax only)                      |
| `upsert_my_payout_account(...)` RPC | 048       | client saves raw details; always resets to `unverified`               |
| `set_my_pan(pan)` RPC               | 048       | client saves a format-checked PAN; sets status `pending`              |
| `my_payout_readiness` view          | 048 / 049 | `payout_account_verified`, `pan_verified`, `can_go_live` (both)       |

**Security model.** The client NEVER writes verification state. RLS grants
`SELECT` on own rows only; details go in through the two SECURITY DEFINER RPCs,
which force the unverified/pending state. The verification columns
(`verification_status`, `cashfree_beneficiary_id`, `name_at_bank`, PAN `status` /
`pan_name`) are written ONLY by the service-role Edge functions below.

---

## Edge functions (service role)

| Function                 | Cashfree API                                                                                                                                            | Reads                                                              | Writes                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `verify-payout-account`  | [Payouts V2 Create Beneficiary](https://www.cashfree.com/docs/api-reference/payouts/v2/beneficiary-v2/create-beneficiary-v2) `POST /payout/beneficiary` | the provider's default account + name/phone/email from the profile | `provider_payout_accounts.verification_status` / `cashfree_beneficiary_id` / `name_at_bank` |
| `verify-pan`             | [Verify PAN Sync](https://www.cashfree.com/docs/api-reference/vrs/v2/pan/verify-pan-sync) `POST /verification/pan`                                      | the provider's pending PAN + name                                  | `provider_tax_profile.status` / `pan_name`                                                  |
| `cashfree-payout` (TODO) | [Standard Transfer V2](https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/standard-transfer-v2) `POST /payout/transfers`               | a `provider_payout_batches` row                                    | `cashfree_batch_id` / status                                                                |

Both existing functions are **best-effort from the client's side**: the hooks save
the details first and only then attempt verification, so while Cashfree Payouts is
disabled the details still persist and the account/PAN sit `pending`.

### Environment (Supabase function secrets)

Cashfree **Payments (PG)** — already set, used by `create-order` / `verify-order`
/ `cashfree-webhook`:

```
CASHFREE_ENV                 sandbox | production
CASHFREE_CLIENT_ID           <PG client id>
CASHFREE_CLIENT_SECRET       <PG client secret>
CASHFREE_WEBHOOK_SECRET      <PG webhook secret>
```

Cashfree **Payouts** + **Verification Suite** are SEPARATE products and may carry
their own credentials. The new functions read these, falling back to the PG creds
if unset:

```
CASHFREE_PAYOUT_CLIENT_ID          (fallback: CASHFREE_CLIENT_ID)
CASHFREE_PAYOUT_CLIENT_SECRET      (fallback: CASHFREE_CLIENT_SECRET)
CASHFREE_PAYOUT_API_VERSION        default 2024-01-01
CASHFREE_VERIFICATION_CLIENT_ID    (fallback: CASHFREE_PAYOUT_CLIENT_ID → CASHFREE_CLIENT_ID)
CASHFREE_VERIFICATION_CLIENT_SECRET(fallback: … secret chain)
```

Base URLs are derived from `CASHFREE_ENV`: Payouts `…/payout`, Verification
`…/verification`; sandbox `https://sandbox.cashfree.com`, prod `https://api.cashfree.com`.

---

## Enabling verification (when the Cashfree Payouts keys arrive)

1. In the Cashfree dashboard, **enable Payouts and the Verification Suite** on the
   merchant account and complete merchant KYC (ADR-0022 kill-switch).
2. Set the function secrets above (`supabase secrets set …` or the dashboard). If
   Payouts shares the PG credentials, the fallbacks already cover it — but confirm,
   because Payouts commonly has its own client id/secret.
3. Deploy the functions: `supabase functions deploy verify-payout-account` and
   `supabase functions deploy verify-pan`.
4. Flip `payouts.cashfree_payouts_enabled` to `true` in the admin config (append a
   new config version per ADR-0023).
5. **Test the whole path in sandbox with a real test account before any real
   provider** — save a bank/UPI + PAN, watch the row go `verified`, confirm
   `my_payout_readiness.can_go_live`.

Until then the UI shows every account/PAN as **Pending verification** and nothing
is lost.

---

## 1-Click Onboarding (native SDK) — verified PAN via consent

Chosen 2026-09-03 (Amit): use Cashfree's **native** Verification Suite SDK for
1-Click Onboarding rather than a hand-rolled WebView (RULE 1 — prefer the
platform's own solution). The provider consents once (mobile OTP in a Cashfree
sheet) and we receive verified PAN + identity, so the provider never types a PAN.

**Scope, discovered from the docs — read this first.** 1-Click / Mobile 360
returns **PAN + identity only, NOT a bank account** (its data coverage is PAN,
Aadhaar-masked, contact, employment — no account number). So 1-Click replaces
_only_ manual PAN entry + `verify-pan`. The bank/UPI destination and its Payouts
beneficiary **stay** on `verify-payout-account`. This is not a full replacement of
the hand-rolled form.

### Pieces built

| Layer      | File                                                                     | What it does                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native     | `android/app/.../CashfreeOnboardingModule.kt`                            | Bridges `com.cashfree.vrs:kyc-verification:1.0.1`. `open1ClickOnboarding(sessionId, env, promise)` → resolves `{ verificationId, authCode, status }`. API taken from the compiled AAR (the README's coordinate + API are stale). Registered in `InAppUpdatePackage.kt`. |
| Native dep | `android/build.gradle`, `android/app/build.gradle`                       | Adds `maven.cashfree.com/release` (the VRS SDK 404s on Central) + the VRS dep. `CFException` arrives transitively via the existing PG SDK.                                                                                                                              |
| Client     | `src/lib/cashfreeOnboarding.ts`                                          | Thin typed wrapper, mirrors `googleCredential.ts`. `startCashfreeOnboarding(sessionId, env)`; `cashfreeOnboardingAvailable()` for the fallback path.                                                                                                                    |
| Client     | `src/api/provider.ts` (`useCashfreeVerification`) + `ProviderBankScreen` | "Verify with Cashfree" is the top CTA (start → native sheet → authCode → complete, best-effort at the edges); the manual bank/PAN form is the fallback below "or enter manually".                                                                                       |
| Server     | `supabase/functions/cashfree-onboarding-start`                           | Provider-JWT-gated. Data Availability (best-effort) → Initiate OAuth → returns `{ sessionId, verificationId, environment }`. **Verified live** (below).                                                                                                                 |

### Sandbox verification (2026-09-03)

Tested the creds directly against `sandbox.cashfree.com/verification`:

- **Working creds live in `CASHFREE_VERIFICATION_*`** (the `one-click-API
Credentials.txt` pair = the **pappal-one-click** template, which requests Name /
  DOB / Email / **PAN / Bank Account**). `POST /oauth2/session` → **HTTP 200 with a
  real `session_id`**. The newer template's keys returned "Verification Suite is
  not enabled"; they were removed (`CASHFREE_ONECLICK_*` unset) so `start` falls
  back to the working pair.
- **`verification_id` must be ALPHANUMERIC** — a hyphenated UUID is rejected. The
  function uses `oc<32 hex>`.
- **Data Availability 401s with the 1-Click app keys** (it wants the account-level
  Verification keys, a separate pair), so it is **best-effort/non-blocking** — the
  SDK only needs the `session_id`.

### The three-step client flow (target)

1. Provider taps **Verify with Cashfree** → `cashfree-onboarding-start` → `sessionId`.
2. `startCashfreeOnboarding(sessionId, env)` opens the native sheet → `authCode`.
3. `cashfree-onboarding-complete` (TODO) exchanges `authCode` → access token →
   fetches verified PAN → writes `provider_tax_profile` (service-role). Bank stays
   on the existing flow.

### BLOCKED on the product owner (Cashfree Secure ID dashboard)

The server flow cannot be tested end-to-end until these exist — none are code:

1. **Create a 1-Click Onboarding template** in the Secure ID dashboard (logo,
   brand, colour, and the data scopes = PAN).
   https://www.cashfree.com/docs/secure-id/1-click-onboarding/creating-template
2. **Register a redirect URL** on the 1-Click app (this is the "redirect URL"
   Cashfree asked for — a dashboard field, not something our code sends; the
   native SDK still returns the auth_code via its callback). A placeholder such as
   `https://pappal.app/payout-callback` is fine.
3. **The 1-Click app's own `x-client-id` / `x-client-secret`.** Cashfree issues
   these per app in the 1-Click section; they may differ from the general
   `CASHFREE_VERIFICATION_*` creds. Set as `CASHFREE_ONECLICK_CLIENT_ID` /
   `CASHFREE_ONECLICK_CLIENT_SECRET` (the start function falls back to the
   verification creds if unset).
4. **The "Fetch User Details" endpoint** — the step after `generate-token` that
   returns the verified PAN. It is referenced by the OAuth token doc but is not in
   the public API reference; it is visible in the authenticated dashboard docs.
   `cashfree-onboarding-complete` needs its exact path + response shape.

New env (Supabase function secrets), all optional with fallbacks:

```
CASHFREE_ONECLICK_CLIENT_ID        (fallback: CASHFREE_VERIFICATION_CLIENT_ID → …)
CASHFREE_ONECLICK_CLIENT_SECRET    (fallback: … secret chain)
CASHFREE_VERIFICATION_API_VERSION  default 2024-12-01 (1-Click APIs require it)
```

## Client

- Hooks (`src/api/provider.ts`): `usePayoutAccount`, `useTaxProfile`,
  `usePayoutReadiness`, `useSavePayoutAccount` (RPC → invoke verify-payout-account),
  `useSavePan` (RPC → invoke verify-pan). Verification is best-effort: a save
  never fails just because Cashfree is off — it returns `pending`.
- Screen (`src/screens/ProviderBankScreen.tsx`): UPI / bank tabs, mandatory PAN,
  live verification chips. Reached from `ProviderHomeScreen` → "Get paid"
  (`ProviderRoute` `{ name: 'payout' }`).
- Types: `database.types.ts` mirrors the two tables, the view, and the two RPCs
  (hand-maintained, per its header).

---

## Disbursement (manual, admin-triggered — migration 050)

No cron (by request). A founder disburses from the admin **Payouts** page
(`admin/app/(authenticated)/payouts`):

- `admin.payable_providers` view lists providers with cleared, past-hold, unpaid
  earnings + their account/PAN status. `payable` = both verified.
- The "Pay" button → `POST /api/payouts` → invokes the `cashfree-payout` Edge
  function with the founder's session (re-checked against `founder_allowlist`).
- Money-critical steps are atomic SQL: `create_provider_payout_batch` locks the
  eligible earnings, creates a `processing` batch, and stamps the rows `paid` (so a
  second click cannot double-pay). `cashfree-payout` then calls Cashfree
  [Standard Transfer V2](https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/standard-transfer-v2)
  `POST /payout/transfers`, and `settle_provider_payout_batch` records the terminal
  state (or reverts the earnings on failure).
- Minimum is ₹500 (ADR-0021); a founder can override with `ignoreMinimum`.

## Still TODO

- **Weekly payout cron** — deferred by request; when wanted, schedule the same
  `create_provider_payout_batch` → transfer → settle for every eligible provider.
  TDS-194O 0.1% with a verified PAN (else 5%) — tax-counsel sign-off still required.
- **Invoice CSV as money truth** — Console ingest (`source=console_api`) is live for
  reference COGS; prefer invoice CSV upserts (`source=invoice_csv`) when invoices
  arrive. Until then per-call COGS is a `product_estimate` from `media_cogs` rates.
- **Dashboard** — replace the "Held for payout" note with an earnings card
  (Available vs Held + per-session hold countdown) and a `ProviderPayoutHistoryScreen`.
- **Listing gate** — once payouts are enforced, route an `approved` provider
  through the payout setup before `is_available` can be turned on
  (`ProviderStatusScreen` copy at `:58` / `:73`).

### Transfer webhook (done — migration 060)

`cashfree-webhook` handles Payouts V2 `TRANSFER_*` events. Sync
`cashfree-payout` leaves batches `processing` after RECEIVED/PENDING and stamps
`cf_transfer_id` via `mark_provider_payout_submitted`. Terminal success is
`TRANSFER_ACKNOWLEDGED` (SUCCESS+COMPLETED per Cashfree). Failures /
`TRANSFER_REVERSED` call `settle_provider_payout_batch(..., false)` and revert
earnings to `cleared`. Payouts V2 webhook URL (registered 2026-09-05):
`https://uvghvhcrovmuwivgijvl.supabase.co/functions/v1/cashfree-webhook`
(`verify_jwt = false`; unsigned Test & Add probes ack 200 without mutating money).

### Agora usage ingest (done — migration 059)

Edge secrets `AGORA_CUSTOMER_ID` / `AGORA_CUSTOMER_SECRET` / `AGORA_PROJECT_ID`
are set. Vault `agora_usage_ingest_url` / `agora_usage_ingest_key` feed the daily
`agora-usage-ingest` cron (`dispatch_agora_usage_ingest` at 06:20 UTC).

## External dependencies (product owner)

- Cashfree merchant KYC + Payouts/Verification enabled + keys.
- Tax-counsel sign-off on TDS-194O treatment (ADR-0021 defers it).
- Updated provider agreement (60/40 + TDS + payout schedule).
