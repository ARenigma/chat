# ADR-0029, A token pack price is the base, and the charge is base + GST

Status: **decided and shipped**
Date: 2026-09-07
Guard: `__tests__/rechargeChips.test.ts` › "recharge chips present GST exclusive
— charged on top of the base (ADR-0029)" and its "adds the tax on top of the
base" / "create-order sends the total (base + tax) to Cashfree, not the bare
base" cases; `__tests__/contract.test.ts` › "GST is disclosed where money moves
and nowhere else" › "backs the tax out of the pack price in exact integer paise"
Reference: [ADR-0022](0022-india-user-choice-billing.md) (the Cashfree rail this
tax rides on), [ADR-0021](0021-principal-marketplace-economics.md) (the
economics config `gst_rate_bps` is published from), and
[ADR-0019](0019-pricing-is-per-minute.md) (the ₹ balance a pack tops up) ·
`docs/runbooks/create-order-deploy.md` (the "amount charged must equal amount
shown" invariant) · shipped in commit `523b1fe`

> **Backfill note.** This file was written after the fact.
> [ADR-0030](0030-icon-sizes-are-a-telegram-derived-scale.md) records that the
> `0029` number was cited by two commits (`5b0840a`, `523b1fe`) and eight code
> and test sites for months with no `docs/adr/0029-*.md` behind it. This closes
> that gap; the decision itself is unchanged from what `523b1fe` shipped.

---

## 1. The decision

**A recharge pack's price is the taxable base, and the amount captured is that
base plus GST on top.** Selecting the ₹300 pack puts **300 tokens** in the
wallet and captures **₹354** at Cashfree (₹300 base + ₹54 tax at 18%). The tax
is added _to_ the price, not carved _out_ of it.

- The number on the chip (`₹300`) is the base — what the member is buying and
  what lands in the wallet, 1 token = ₹1.
- GST is a separate `+ ₹54 GST` line, disclosed on every recharge surface where
  money moves (the wallet grid, the chat-sheet chips, the Pay bar, PaymentSheet)
  and nowhere in chat, per the `contract.test.ts` disclosure rule.
- The Pay bars and the UPI button show the **total captured**
  (`packTotalInr` = base + tax), so the figure the member confirms is the figure
  the gateway charges.

## 2. Context: the inclusive model, and the overcharge trap it hid

The first-gen model treated the pack price as the **GST-inclusive total**: ₹300
selected meant ₹300 captured, of which ₹254.24 was the base and ₹45.76 was tax
backed out of it. Two things were wrong with that, and both are the kind of bug
that only surfaces in a reconciliation, not on screen:

1. **A ₹300 pack credited less than ₹300 of value.** The member paid ₹300 and
   received ₹254.24 of tokens, because the tax came out of what they thought
   they were buying. The price and the wallet credit disagreed, silently.
2. **The inclusive split and the exclusive presentation were ambiguous.**
   `rates.ts` carried `gstExclusiveParts` / `gstExclusiveLabel` — an "exclusive"
   _label_ presenting an _inclusive_ arithmetic. A reader could not tell from the
   name whether ₹300 was the base or the total, and the two answers differ by
   ₹54 on every ₹300 order. Naming a thing "exclusive" while computing it
   inclusive is exactly how the wrong one ships.

The fix makes the two agree by construction: the pack price _is_ the base, so the
wallet credit always equals the price, and the tax is unambiguously an addition.
`gstExclusiveParts` / `gstExclusiveLabel` were deleted in favour of `gstOnTop`,
`packTotalInr`, `gstAddedLabel`, and `gstAddedSpoken`.

## 3. The round-trip guarantee: the total reverses to the exact base

The invariant the whole model rests on is that **the tax GST-invoicing backs out
of the captured total is byte-for-byte the base the total was built from.** If it
were not, an invoice would claim tax on a rupee amount nobody was charged.

`create-order` builds the total (`packTotalPaise`, exclusive):

```
total = base + round(base * rate_bps / 10000)
```

`generate-invoice` recovers the taxable value from `amount_paise` alone
(inclusive back-out), never seeing the base:

```
taxable = round(total * 10000 / (10000 + rate_bps))
tax     = total - taxable
```

At 18% (`rate_bps = 1800`), the back-out denominator is `11800`, so
`taxable = round(total * 10000 / 11800)`. The guarantee is that this recovers the
base exactly:

| Base   | Total built (base + 18%) | `round(total * 10000 / 11800)` | Recovers |
| ------ | ------------------------ | ------------------------------ | -------- |
| 30000  | 35400                    | 30000                          | ✓        |
| 10000  | 11800                    | 10000                          | ✓        |
| 500000 | 590000                   | 500000                         | ✓        |

Because both directions round to integer paise and 18% of a whole-rupee pack
lands on a whole paise, there is no rounding gap. The same reversibility holds
under the first-recharge half-price offer: the discount comes off the **taxable
value** before tax is added, so a total built as
`discountedBase + gst(discountedBase)` backs out to exactly `discountedBase`
(₹300 at 50% off → 15000 base → 2700 tax → 17700 total → reads back 15000 / 2700).
Discounting the gross instead would leave the invoice claiming tax on a sum
nobody paid.

`rate_bps = 0` (seller not GST-registered) is the honest degenerate case:
`taxable = total`, tax = 0. The rate zeroes the tax in the **arithmetic**, not
just the label.

## 4. The live rate, and one source of truth

The rate is not a constant. `create-order` reads `economics.gst_rate_bps` from
the admin control plane ([ADR-0021](0021-principal-marketplace-economics.md)) at
request time — the same source the client (`useEconomicsConfig`) and
`generate-invoice` read — falling back to the `GST_RATE_BPS` env var, then
`1800` bps, so a config read failure can never turn into a failed order. Pinning
`create-order` alone at 18% while the admin plane published a different rate would
charge a total that no longer matched the price on screen; reading the same value
everywhere is what keeps the charge, the disclosure, and the invoice in step.

## 5. Consequences

- **The amount charged must equal the amount shown.** With the base as the price,
  the client can and does recompute the total independently; `src/api/billing.ts`
  refuses to open the gateway when the server's total and the shown total diverge.
  `create-order` returns `baseInr`, `gstRateBps`, and `discountBps` alongside the
  total precisely so the client can check the arithmetic rather than trust it.
- **The wallet credit is now the price, always.** `tokens_delta` is the base
  token count; `amount_paise` is the total captured. The ledger row records
  `discount_bps` so a ₹177 charge against a ₹300 pack can be explained after the
  fact.
- **GST disclosure is a build-gated contract.** GST is named on every recharge
  surface and on no chat surface; `contract.test.ts` fails the build if that
  drifts, and `rechargeChips.test.ts` asserts the "+ tax on top" arithmetic.

## 6. The coupling: the build ships before create-order deploys

`create-order` and the client are **ordered dependencies**, and getting the order
wrong overcharges real testers. A build that still shows the bare base as the
total, talking to a `create-order` that charges base + GST, would surprise the
buyer with ₹354 at the gateway for a pack the screen called ₹300.

The rule, therefore: **the GST-inclusive build reaches testers before the
base+GST `create-order` is deployed — never the reverse.** The enforcement is a
version floor in `create-order`: it refuses any client below
`CREATE_ORDER_MIN_VERSION` (the versionCode of the first build that displays the
total) with `426 upgrade_required`, **before any Cashfree order exists**. An old
client is told to update; it can never be charged the surprise amount. The floor
fails **closed** — a missing or non-numeric floor refuses the order rather than
waving every old client through — because `x < NaN` is false for every `x`, which
would silently disable the guard.

`docs/runbooks/create-order-deploy.md` carries the deploy sequence; this ADR
carries the reason it is not negotiable.
