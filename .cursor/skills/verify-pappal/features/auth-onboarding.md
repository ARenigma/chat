# Auth and onboarding

Boot, mandatory permissions, Google/phone sign-in, and first-profile setup.

## Sub-features

- Permission education and Android runtime dialogs
- Credential Manager Google sign-in
- Firebase phone OTP
- Member profile, age/language, and policy completion

## How to get to it (user POV)

Cold-launch a signed-out install. Grant mandatory permissions, continue from the
welcome screen, choose Google or phone, then complete the first-user steps.

## Driving it with control-pappal

```bash
npm run control -- launch
npm run control -- tap --id permissions-allow
npm run control -- tap --id welcome-continue
npm run control -- tap --id onboard-use-phone
npm run control -- tap --id onboard-phone
npm run control -- type 9876543210
npm run control -- tap --id onboard-send-code
```

Use ARTEMIS for permission dialogs, Credential Manager, and IME. Proof includes
the system-owned interaction and the resulting authenticated/profile screen.

Stable IDs include `permissions-gate`, `onboard-google`, `onboard-code`,
`profile-setup-continue`, and `policy-accept`.

## Gotchas

- Never put production credentials or OTPs in evidence.
- Credential Manager success must be proven in logcat; browser fallback alone
  can hide a failed primary path.
- Release builds reject harness-only session injection.
