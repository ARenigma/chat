# Runbook — deploying `create-order` (the GST + price-alignment landmine)

**Status:** the repo `create-order` (commit `09d8cdd`) reads the live GST rate from
admin config; the **deployed** function is older and hardcodes 18%. The two must
be reconciled carefully because **the amount `create-order` charges must always
equal the amount the client showed on the recharge chip.** A mismatch is a real
money defect — a tester once saw ₹354 charged for a ₹300 pack because a deployed
create-order added GST the client build did not display.

## Why this is coupled to a client build

`create-order` computes the Cashfree order amount as `base + GST`. The client
recharge screen shows a price. **These two numbers must be identical.** They are
identical only when the client build and the deployed function agree on:

1. **The GST rate** — now both read `economics.gst_rate_bps` (client via
   `useEconomicsConfig`, server via `get_active_config('economics')`). Aligned in
   code; verify the live `economics` config actually publishes the intended rate.
2. **The pack prices** — `RECHARGE_PACKS` in `create-order/index.ts` must match
   `src/lib/rates.ts` `RECHARGE_PACKS` in the shipped bundle. Both are ₹1 = 1
   token today; confirm no drift before deploying.

## Preconditions (do not deploy until all true)

- [ ] The client build being shipped to testers is built from the **same commit**
      as the `create-order` being deployed (so `rates.ts` and `create-order`
      pack/GST logic match).
- [ ] `economics.gst_rate_bps` in live admin config is the intended rate (18% =
      1800 unless deliberately changed). Check:
      `select public.get_active_config('economics');`
- [ ] The recharge screen in that build shows a **GST-inclusive total** that
      equals `base + base*rate` for each pack (spot-check ₹300 → ₹354 at 18%).

## Deploy steps

```bash
# 1. Confirm which function is live vs repo (marker grep, per the edge-function
#    staleness note — timestamps lie).
supabase functions list

# 2. Deploy the reconciled function.
supabase functions deploy create-order --project-ref uvghvhcrovmuwivgijvl

# 3. Immediately smoke-test order creation end to end on a device build from the
#    SAME commit: open recharge, pick ₹300, reach the Cashfree sheet, and confirm
#    the amount is ₹354 (at 18%) and equals the price the chip showed.
```

## Post-deploy verification

- [ ] A real (sandbox) order for the ₹300 pack creates a Cashfree order for the
      exact rupee amount the recharge chip displayed.
- [ ] `generate-invoice` for that order produces `taxable + gst == total` with no
      rounding gap (it reads the same live rate; they must agree now).
- [ ] Change `economics.gst_rate_bps` in a staging/admin test to a different value
      and confirm the create-order amount, the chip, and the invoice all move
      together. Revert.

## Rollback

`supabase functions deploy` is versioned server-side. If the charged amount does
not match the displayed price, redeploy the previous known-good function
immediately; no member should be mid-checkout during the swap.

## Related

- GST wiring commit: `09d8cdd`.
- Edge-function staleness method (marker grep) — memory `reference-edge-function-staleness`.
- Also reconcile any other stale functions in the same pass (e.g. `send-call`).
