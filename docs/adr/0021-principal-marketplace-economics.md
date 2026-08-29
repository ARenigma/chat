# ADR-0021, Principal marketplace economics

- **Status:** Accepted (2026-08-29)
- **Decision by:** Amit Ranjan
- **Resolves:** the merchant/payment question deferred in ADR-0001, and the
  provider split and billing model introduced implicitly in ADR-0019.

---

## Context

ADR-0001 deferred "whether Play Billing applies, or whether this is a
real-world service." ADR-0019 introduced per-minute pricing but left the
provider split, GST treatment, and the precise billing model as follow-ups. No
formal record exists for:

- Who is the seller (Pappal/Axionix, or each provider as a separate merchant)?
- How do tokens relate to rupees?
- What are the default rates and how are they configured?
- How does the provider receive their share?
- How are GST invoices issued?

These questions have direct implications for tax, payment-gateway selection,
and Play Store policy classification.

---

## Decision

### Pappal is the principal, not a marketplace aggregator

**Axionix Technologies** (operating as Pappal) is the seller of record for all
member purchases. Members buy from Pappal; providers receive a revenue share.
Pappal is not an aggregator or pass-through marketplace. This classification:

- Simplifies GST: Pappal is the single taxable supplier.
- Avoids provider-by-provider payment-gateway onboarding at launch.
- Means the Play Store sees one seller (Pappal/Axionix), not N individual
  providers.

### Token economics

- **1 token = ₹1** (display layer). The balance pill shows tokens as a plain
  integer read as money.
- The **ledger stores paise** (integer, 100 paise = ₹1) for sub-rupee accuracy.
  Display converts: `Math.round(paise / 100)` for the pill.
- Token arithmetic that produces sub-rupee remainders rounds in the member's
  favour at display; the ledger never rounds until settlement.

### Rates (admin-configurable, global defaults at launch)

| Channel    | Default rate |
| ---------- | ------------ |
| Chat       | ₹22 / minute |
| Audio call | ₹22 / minute |
| Video call | ₹35 / minute |

Rates are admin-configurable (ADR-0023). Providers do not set their own rates
at launch; the global rate applies uniformly.

### Provider revenue share

Providers receive **60% of pre-GST usage revenue** after refunds. Pappal
retains 40%. Pappal absorbs payment-gateway fees; the 60/40 split is on gross
usage revenue before fees.

### Starting balance and promos

- Default starting balance: **0 tokens** (admin-configurable to a non-zero
  grant for launch promos).
- Daily free-token refill: implemented, **disabled by default** (admin can
  enable with an amount).
- Promo tokens are spent before purchased tokens. Purchased tokens never
  expire. Promo tokens may carry an expiry configured per-grant.
- Account closure: unused purchased token value is queued for refund review;
  promo tokens lapse.

### Recharge pack pricing (GST-inclusive)

Pack prices are GST-inclusive. The taxable amount is reverse-calculated
internally:

```
taxable_amount = pack_price / (1 + gst_rate)
```

Example at 18% GST: ₹100 pack → ₹84.75 taxable + ₹15.25 GST.

Token grant equals the nominal pack price (e.g. ₹100 pack = 100 tokens = ₹100
balance), not the pre-tax amount. The GST component is Pappal's liability.

### Invoice issuer

**Axionix Technologies** issues the GST invoice for Cashfree-path purchases.
Required fields (GSTIN, SAC code, place of supply) are configurable in admin
and are left blank until legal details are finalized.

**Play-managed purchases**: Google issues the receipt; Axionix does **not**
issue a duplicate invoice. The `generate-invoice` edge function is wired only
to the Cashfree path.

### Provider payouts

- **Payment provider:** Cashfree Payouts
- **Cadence:** weekly (admin-configurable)
- **Earnings hold:** 7 days from session end (admin-configurable; covers
  refund window)
- **Minimum payout:** ₹500 (admin-configurable)
- **TDS treatment:** to be confirmed with tax counsel before first payout run.
  Provider agreement must specify whether Pappal deducts TDS at source.

---

## What this retires

| Retiring                              | Replacement                                    |
| ------------------------------------- | ---------------------------------------------- |
| Per-message token debit               | Per-minute session meter (ADR-0020)            |
| `provider_earnings` built on messages | `provider_earnings` rebuilt on session minutes |
| Dual-meter billing bug                | Single per-minute meter                        |
| Informal split assumption             | Formal 60/40 pre-GST split, documented here    |

Payout tables are new schema; no existing table migrates.

---

## Consequences

- The `provider_earnings` view (or table, whichever replaces it) must join on
  session records, not on `messages`. The per-message view is incorrect after
  ADR-0020's meter change and must be rebuilt before any payout run.
- A `payouts` table is required to track Cashfree Payouts disbursements, hold
  periods, and minimum-threshold enforcement. This is new schema.
- Admin-configurable rates (ADR-0023) must version-snapshot the rate at session
  activation so that mid-week rate changes do not retroactively alter open
  sessions or historical earnings.
- Provider agreements must be updated to reference the 60/40 definition and
  the TDS/GST treatment before the first payout run. Shipping payouts without
  this exposes Axionix to withholding liability.
