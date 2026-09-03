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

- **Transfer webhook** — extend `cashfree-webhook` for `TRANSFER_*` events so an
  accepted (RECEIVED) transfer that later fails at the bank auto-reverts, instead
  of the current settle-on-synchronous-response.
- **Weekly cron** — deferred by request; when wanted, schedule the same
  `create_provider_payout_batch` → transfer → settle for every eligible provider.
  TDS-194O 0.1% with a verified PAN (else 5%).
- **Dashboard** — replace the "Held for payout" note with an earnings card
  (Available vs Held + per-session hold countdown) and a `ProviderPayoutHistoryScreen`.
- **Listing gate** — once payouts are enforced, route an `approved` provider
  through the payout setup before `is_available` can be turned on
  (`ProviderStatusScreen` copy at `:58` / `:73`).

## External dependencies (product owner)

- Cashfree merchant KYC + Payouts/Verification enabled + keys.
- Tax-counsel sign-off on TDS-194O treatment (ADR-0021 defers it).
- Updated provider agreement (60/40 + TDS + payout schedule).
