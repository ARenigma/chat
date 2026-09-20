# Auth and onboarding

Boot, mandatory permissions, Truecaller/WhatsApp/Google sign-in, account
continuity, and first-profile setup.

## Sub-features

- Permission education and Android runtime dialogs
- Truecaller OAuth one-tap sign-in (primary)
- WhatsApp OTP fallback
- Credential Manager/browser Google fallback and Truecaller account linking
- Member profile, age/language, and policy completion

## How to get to it (user POV)

Cold-launch a signed-out install. Grant mandatory permissions, continue from the
welcome screen, choose Truecaller, WhatsApp, or Google, then complete the
first-user steps. An unmatched Truecaller phone asks whether the member is new
or already owns a Google account before creating anything.

## Driving it with control-pappal

```bash
npm run control -- launch
npm run control -- tap --id permissions-allow
npm run control -- tap --id welcome-continue
npm run control -- tap --id onboard-truecaller
npm run control -- screenshot artifacts/verification/truecaller-consent.png
```

For the fallback path:

```bash
npm run control -- tap --id onboard-use-phone
npm run control -- tap --id onboard-phone
npm run control -- type 9876543210
npm run control -- tap --id onboard-send-code
```

Use ARTEMIS for the Truecaller consent sheet, permission dialogs, Credential
Manager, and IME. Proof includes the system-owned interaction, logcat showing
the intended SDK callback, the resulting Supabase UUID, and server-side identity
mapping—not only the final screen.

Stable IDs include `permissions-gate`, `onboard-truecaller`,
`onboard-truecaller-new`, `onboard-truecaller-link-google`, `onboard-google`,
`onboard-code`, `profile-setup-continue`, and `policy-accept`.

## Gotchas

- Never put production credentials or OTPs in evidence.
- Truecaller must be installed and signed in for the one-tap path. Remove or
  sign out of Truecaller to prove automatic routing to WhatsApp.
- A new Truecaller number must not create a Supabase user until
  `onboard-truecaller-new` is pressed.
- Existing Google-account linking must return the same Supabase UUID after
  sign-out and subsequent Truecaller sign-in.
- Credential Manager success must be proven in logcat; browser fallback alone
  can hide a failed primary path.
- Release builds reject harness-only session injection.
