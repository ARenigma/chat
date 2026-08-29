# ADR-0022, India user-choice billing — Play + Cashfree

- **Status:** Accepted (2026-08-29)
- **Decision by:** Amit Ranjan
- **Resolves:** the payment rail question from ADR-0001 and ADR-0019; determines
  how token packs are sold on Android without violating Play Billing policy.

---

## Context

Token packs are virtual currency sold inside an Android app. Per Google Play
policy
([support.google.com/googleplay/android-developer/answer/10281818](https://support.google.com/googleplay/android-developer/answer/10281818)),
virtual currency **requires Play Billing** unless the app is enrolled in an
approved alternative-billing programme.

The 1:1 paid human-conversation sessions (ADR-0020) qualify for the Play
Billing **service exemption** (not recorded, not replayable). However, the
token packs themselves — purchased in advance and held in a balance wallet — do
not qualify for the exemption, because they are general-purpose virtual
currency rather than access to a specific real-world session.

Two options resolve this:

1. **Play Billing only** — simple compliance, but 15–30% cut, no UPI option.
2. **Play UCB (User-Choice Billing) India programme** — users can choose Play
   or an in-app alternative; alternative carries a reduced ~5% fee. This is the
   India-specific programme that allows a second payment option alongside Play.

Cashfree Payments is the alternative provider selected (KYC activation
pending). Cashfree Payouts is also used for provider settlements (ADR-0021),
consolidating to a single payment vendor.

---

## Decision

### Enroll in Google Play India User-Choice Billing

Pappal enrolls in the UCB India programme. This requires:

- Play products (token packs) pre-created in the Play Console with
  `ProductType.INAPP`. The admin dashboard (ADR-0023) activates and orders
  them but does not invent prices — prices are set in the Play Console and
  synced via the Play Developer API.
- A native Android Play Billing module (Kotlin) that presents the UCB choice
  sheet and handles purchase acknowledgement.
- Server-side purchase verification via the Play Developer API before crediting
  tokens (no client-trust).

### Cashfree Payments as the alternative billing choice

When the member chooses the alternative payment option:

1. The client requests an order from the server.
2. The server creates a Cashfree order (server-side, with idempotency key) and
   returns a `payment_session_id`.
3. Cashfree's Android SDK presents the payment sheet (UPI, cards, netbanking).
4. On payment, Cashfree sends a signed webhook to a Supabase Edge Function.
5. The Edge Function verifies the signature, confirms the order status via
   Cashfree's server-to-server API, and credits tokens only on confirmed
   settlement. Webhooks are idempotent; duplicate events are safe.

Tokens are never credited on client assertion alone.

### Exemption scope

The **session service** (1:1 paid human conversations, not recorded, not
replayable per ADR-0020) qualifies for the Play Billing service exemption and
does not need to go through Play Billing's purchase flow. The **token packs**
(virtual currency sold in advance) do not qualify; UCB resolves this for packs.

Both methods credit the same `balance_paise` ledger. The billing path is an
implementation detail the session meter does not need to know.

### Kill switch

`PAYMENTS_ENABLED` stays `false` until **all** of the following are confirmed:

- [ ] Play UCB India programme enrollment approved by Google.
- [ ] Cashfree merchant account active (KYC complete).
- [ ] Axionix GSTIN and legal fields configured in admin (ADR-0023).
- [ ] Provider TDS/GST treatment reviewed and reflected in provider agreements
      (ADR-0021).
- [ ] Play policy review passed (no policy violations in the first submission).

The kill switch is controlled via the admin config (ADR-0023), not a code
deploy.

### Provider verification before listing

Cashfree Payments requires merchant-level KYC. Provider payouts (Cashfree
Payouts) additionally require per-provider bank account verification before
the first disbursement. No provider may be listed on the platform until their
payout account is verified.

---

## Consequences

- **New Android native module**: a Kotlin `PlayBillingModule` that wraps
  Google Play Billing Library 7.x, presents the UCB choice UI, handles
  purchase acknowledgement, and calls the server to verify before crediting.
  `react-native-svg` remains banned; this module is a pure native bridge.
- **New Cashfree webhook Edge Function**: receives Cashfree payment events,
  verifies signature (HMAC-SHA256 with `CASHFREE_WEBHOOK_SECRET`), calls
  Cashfree's order-status API, and calls `complete_recharge` (service_role).
  It must be idempotent: a duplicate `payment_session_id` must not double-credit.
- **`generate-invoice` wired to Cashfree path only**: Play purchases are
  receipted by Google; Axionix does not issue a parallel invoice. The edge
  function is only called for Cashfree-path `token_transactions` rows.
- **Play product sync**: pack prices in-app are the canonical Play Console
  prices (fetched via `queryProductDetailsAsync`). The admin dashboard orders
  and activates packs but does not set Play prices independently — prices must
  match what the Play Console publishes.
- **No Stripe, no Razorpay**: both were evaluated and not selected. Cashfree
  provides both collection (Payments) and disbursement (Payouts) under a single
  KYC, reducing vendor count. Stripe Connect was the original assumption in
  ADR-0001; that path is now closed.

---

## Implementation notes (added 2026-08-29)

### Android

- PBL 9.1.0 (`billing-ktx`) declared in `android/app/build.gradle`.
- Kotlin plugin bumped from 2.1.20 → 2.2.10 in `android/build.gradle`
  (PBL 9.1 silently requires ≥ 2.2.10; billing-ktx's own release notes are
  the only place this is documented).
- `BILLING` permission auto-embedded by the library AAR manifest merge; not
  declared in the app manifest.
- `BillingModule.kt` wraps PBL and exposes `openRechargeSheet(sku)` to JS.
- UCB path uses `GOOGLE_RENDERED` (Scenario 1A): Play renders the sheet,
  `alternativeChosen` event fires when the user picks Cashfree.
- `launchBillingFlow()` gated on `UiThreadUtil.runOnUiThread`.

### Server

- `create-order` Edge Function creates the Cashfree order and a pending
  `token_transactions` row (kind=`recharge`, status=`created`).
- `cashfree-webhook` Edge Function verifies `HMAC-SHA256(timestamp+rawBody)`,
  then calls `credit_purchased_recharge` (migration 033) on success.
- Migration 033 adds `credit_purchased_recharge(user_id, amount, tx_id)` RPC:
  idempotent, updates `purchased_balance`, status guard prevents double-credit.

### Client

- `src/api/billing.ts` wraps the native module and `create-order` invocation.
- Token balance update is eventual: webhook → Supabase Realtime → profile query
  invalidation.
