# ADR-0009 — Phone OTP: the UX, and where MSG91 attaches

Status: **UX decided. Integration point needs one decision (§2).**
Date: 2026-08-21
Builds on [ADR-0006](0006-phone-otp-costs-and-the-dlt-gate.md), which priced the
options and named DLT as the gate

---

## 1. Read this before submitting the DLT template

DLT template approval takes one to three weeks and **the template text cannot be
changed afterwards without re-registering**. Two things have to be inside it from
the start, and both are easy to discover too late.

**The SMS Retriever app hash.** Android can fill the code in automatically with
no permission at all — but only if the message body ends with an 11-character
hash derived from the package name and the signing certificate. Without it, every
user types six digits by hand forever.

Computed from this repo's keys:

| Key    | Cert SHA-256 (base64)                          | App hash      |
| ------ | ---------------------------------------------- | ------------- |
| upload | `dU7YdbjP/UmqDlOvDvblu3Qh0W7hGWY4/CssgMM0fw8=` | `QQHddXSADO/` |
| debug  | `+sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w=` | `XGCCaPYbGS0` |

**Neither of those is the production hash**, and this is the trap. With Play App
Signing, Google re-signs the app with _its_ key, so the certificate users
actually run is not the upload key. The production hash must be computed from the
app signing certificate shown in Play Console → Setup → App signing, which does
not exist until after the first upload.

So the ordering is: upload the AAB, read Google's cert from the console, compute
the hash, _then_ submit the DLT template. Reproduce with:

```bash
PKG=com.companionchat
CERT_SHA256_BASE64='<from Play Console, base64 of the DER cert SHA-256>'
printf '%s %s' "$PKG" "$CERT_SHA256_BASE64" \
  | openssl dgst -sha256 -binary | openssl base64 -A | cut -c1-11
```

The template body then has to look like this — the hash on its own line at the
end, and no trailing characters after it:

```
<#> 123456 is your CompanionChat code. It expires in 15 minutes.
QQHddXSADO/
```

**The second thing:** the template must not say "verify", "OTP for login" and
also carry marketing language. Mixing transactional and promotional text is a
common rejection reason on Indian DLT, and a rejection costs another cycle.

---

## 2. The one open decision: widget or hook

MSG91 can attach in two places, and they are not interchangeable.

### Route A — the OTP widget (`@msg91comm/sendotp-react-native`)

MSG91 sends _and verifies_ the code, then hands the client an access token which
our backend validates against MSG91.

The problem is what happens next. Supabase Auth never sees this login, so we have
to mint the session ourselves — and Supabase has no admin endpoint that creates a
session for a phone user. `auth.admin.generateLink` is email-only. That leaves
two workarounds, and both are worse than they look:

- **Synthesise an email per number** (`919876543210@phone.invalid`) so
  `generateLink` works. Now every user has a fake email in `auth.users`, and the
  privacy policy's "we hold your name and email, from Google" stops being true.
- **Self-sign a Supabase JWT** with the project's JWT secret. Then that secret
  lives in an Edge Function, and every RLS policy in the database — the entire
  security model — depends on our own token minting being correct rather than on
  Supabase Auth's.

Either way `auth.uid()` has to resolve to a real `auth.users` row or migrations
001–009 stop protecting anything.

### Route B — the Send SMS hook (recommended)

Supabase Auth owns the flow; MSG91 is only the carrier.

```
app: signInWithOtp({ phone })
  → Supabase generates and stores the code, calls our send-sms Edge Function
  → the function sends it through MSG91's send API
app: verifyOtp({ phone, token })
  → Supabase validates and issues a normal session
```

Nothing about identity changes. RLS, refresh tokens, rate limiting, session
expiry and account deletion all keep working exactly as they do for Google, and
there is no fake email and no hand-rolled JWT.

**What the widget was for, and why we do not need it.** Its value is a prebuilt
UI with retry, resend and captcha built in. We would not ship that UI: it does
not know this design system, and §3 below is a set of decisions the widget does
not let us make. So the widget is paying for the part we are throwing away and
charging us the identity architecture in return.

**Nothing is wasted by choosing B.** Same vendor, same account, same sender ID,
same DLT registration and the same template. Only the SDK goes unused.

---

## 3. The UX, which is the same either way

Eleven decisions. The two that matter most are the two that are usually got
wrong: a wrong code must not clear the field, and the code field must be one
input rather than six boxes.

**One screen, two states.** Phone entry and code entry are the same screen, not a
push. The number stays visible above the code field, because "which number did I
just type" is the question people actually have. The transition is `SPRING.snap`
with the code field entering on `SPRING.bounce`.

**One input, drawn as segments.** Six separate boxes is the conventional
pattern and it is worse in three specific ways: a screen reader announces six
unlabelled fields, paste usually fails or fills only the first box, and backspace
across a boundary is unpredictable. So: a single `TextInput`, `maxLength={6}`,
with six segment rectangles rendered underneath it and the caret positioned by
index. One accessible node, paste works, autofill works.

**Autofill is a first-class requirement, not a nice-to-have.**
`autoComplete="sms-otp"` plus the app hash in the template (§1) means the code
arrives without the keyboard ever opening. This is why §1 is time-critical rather
than a detail.

**A wrong code keeps the digits.** The field shakes — a decaying spring on
translateX, honouring `ReduceMotion.System` — and the six characters stay put so
one wrong digit can be fixed. Clearing the field on error is the single most
disliked behaviour in OTP flows and it is always a decision someone made.

**Auto-submit on the sixth character, exactly once per value.** Guarded by the
last submitted string, so a rejected code does not resubmit on every keystroke
and burn the rate limit.

**Resend is a countdown, never a dead button.** 30 seconds, then "Resend code".
A button that is tappable and does nothing teaches people the app is broken.
After the second resend, offer the other channel if one is configured — MSG91
supports WhatsApp and voice, and voice is what rescues a user in a bad signal
area.

**The number is confirmed before an SMS is spent.** "We'll text a code to
+91 98765 43210" with a **Change** affordance, because a mistyped digit costs a
message, a minute, and some trust.

**+91 is the default and is still editable.** A hard-locked country code is a bug
for anyone who travels or holds a foreign number.

**Phone is offered second, and it is an upgrade rather than an alternative.**
Google stays the primary button; "Use a phone number instead" sits under it.
ADR-0006 is the reason: a phone number costs money to replace and a Google
account does not, so phone is the accountability improvement — but it is also the
slower path, so it should not be the default while Google works.

**No phone-number hint.** Android's Phone Number Hint API would prefill the
number with no permission, and we are still not using it: it pulls in Play
Services as a dependency, and the app's privacy claim is "three Android
permissions in total, no advertising ID". Saving one field of typing is not worth
weakening the sentence the privacy page leads with.

**Errors say what to do.** "That code has expired — send a new one" rather than
"Invalid OTP". The failure surface already distinguishes assertive alerts from
confirmations (`noticeTone`), and an expired code is a confirmation-with-an-action,
not an alarm.

---

## 4. What is not decided here

Whether phone becomes _mandatory_ for providers. There is a real argument for it
— a provider is being paid and moderated, and a number that costs money to
replace is the cheapest accountability available short of KYC — but it is a
policy decision with a conversion cost, and it belongs with the KYC work in
ADR-0001 item 2 rather than with the transport choice.
