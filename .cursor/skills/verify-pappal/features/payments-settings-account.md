# Payments, settings, and account

Recharge/ledger/invoices plus profile settings, safety, sign-out, and deletion.

## Sub-features

- Token balance, pack selection, checkout, transaction history, and usage ledger
- Theme, avatar, presence, blocked users, legal links, and sign-out
- Account deletion and database cascade
- Provider payout/KYC entry points

## How to get to it (user POV)

Open the token balance or Recharge action for payments. Open You/settings from
Home for profile/account actions. Provider payout setup is reached from the
provider account surface.

## Driving it with control-pappal

```bash
npm run control -- tap --id token-badge
npm run control -- tap --id recharge-pay
npm run control -- tap --id settings
npm run control -- tap --id settings-transactions
```

Use `.maestro/03-token-economy.yaml` for recharge/ledger,
`06-account-deletion.yaml` for deletion, `07-font-scale.yaml` for 200% text, and
`08-large-screen.yaml` for 1280×800. Stable IDs include `payment-confirm`,
`payment-success`, `usage-ledger`, `settings-theme`, `delete-account`, and
`delete-confirm`.

Proof pairs the visible state with ledger/database assertions. Account deletion
must prove no protected rows survived.

## Gotchas

- Production payments remain kill-switched; use the environment’s sanctioned
  sandbox/mock path and state what it skips.
- GST invoices are recharge-only.
- Cashfree verification is native/system-owned; use ARTEMIS and logcat.
- Never capture PAN, bank details, OTPs, or service credentials in evidence.
