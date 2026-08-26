# ADR-0009, Phone OTP: the UX, and where MSG91 attaches

Status: **decided, Supabase phone auth, Fast2SMS as carrier (§5)**
Date: 2026-08-21
Builds on [ADR-0006](0006-phone-otp-costs-and-the-dlt-gate.md), which priced the
options and named DLT as the gate

---

## 1. Read this before submitting the DLT template

DLT template approval takes one to three weeks and **the template text cannot be
changed afterwards without re-registering**. Two things have to be inside it from
the start, and both are easy to discover too late.

**The SMS Retriever app hash.** Android can fill the code in automatically with
no permission at all, but only if the message body ends with an 11-character
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

The template body then has to look like this, the hash on its own line at the
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

### Route A, the OTP widget (`@msg91comm/sendotp-react-native`)

MSG91 sends _and verifies_ the code, then hands the client an access token which
our backend validates against MSG91.

The problem is what happens next. Supabase Auth never sees this login, so we have
to mint the session ourselves, and Supabase has no admin endpoint that creates a
session for a phone user. `auth.admin.generateLink` is email-only. That leaves
two workarounds, and both are worse than they look:

- **Synthesise an email per number** (`919876543210@phone.invalid`) so
  `generateLink` works. Now every user has a fake email in `auth.users`, and the
  privacy policy's "we hold your name and email, from Google" stops being true.
- **Self-sign a Supabase JWT** with the project's JWT secret. Then that secret
  lives in an Edge Function, and every RLS policy in the database, the entire
  security model, depends on our own token minting being correct rather than on
  Supabase Auth's.

Either way `auth.uid()` has to resolve to a real `auth.users` row or migrations
001–009 stop protecting anything.

### Route B, the Send SMS hook (recommended)

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

**A wrong code keeps the digits.** The field shakes, a decaying spring on
translateX, honouring `ReduceMotion.System`, and the six characters stay put so
one wrong digit can be fixed. Clearing the field on error is the single most
disliked behaviour in OTP flows and it is always a decision someone made.

**Auto-submit on the sixth character, exactly once per value.** Guarded by the
last submitted string, so a rejected code does not resubmit on every keystroke
and burn the rate limit.

**Resend is a countdown, never a dead button.** 30 seconds, then "Resend code".
A button that is tappable and does nothing teaches people the app is broken.
After the second resend, offer the other channel if one is configured, MSG91
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
account does not, so phone is the accountability improvement, but it is also the
slower path, so it should not be the default while Google works.

**No phone-number hint.** Android's Phone Number Hint API would prefill the
number with no permission, and we are still not using it: it pulls in Play
Services as a dependency, and the app's privacy claim is "three Android
permissions in total, no advertising ID". Saving one field of typing is not worth
weakening the sentence the privacy page leads with.

**Errors say what to do.** "That code has expired, send a new one" rather than
"Invalid OTP". The failure surface already distinguishes assertive alerts from
confirmations (`noticeTone`), and an expired code is a confirmation-with-an-action,
not an alarm.

---

## 4. What is not decided here

Whether phone becomes _mandatory_ for providers. There is a real argument for it
, a provider is being paid and moderated, and a number that costs money to
replace is the cheapest accountability available short of KYC, but it is a
policy decision with a conversion cost, and it belongs with the KYC work in
ADR-0001 item 2 rather than with the transport choice.

---

## 5. Carrier decided: Fast2SMS, and why not Firebase

Two later rounds settled this. Recording both so neither is re-argued from zero.

### The widget cannot be a login

MSG91's no-DLT default template is only reachable through the OTP widget, and the
widget generates and verifies its own code. So it can never deliver a code
Supabase issued, "widget with the free template" and "Supabase owns the OTP" are
incompatible, not a preference. Section 2's claim that nothing is lost by
choosing the hook was wrong in one respect: choosing the hook does cost the
ability to send on MSG91 without a DLT template of our own.

### Firebase Phone Auth: read, priced, declined

It looks like the easy answer because the Firebase project already exists for
FCM. Three findings say otherwise.

**It cannot be switched on.** Phone auth requires the Blaze plan, and both
billing accounts on this org report `OPEN: False` with `billingEnabled: false` on
`chat-d8c87`. The same wall as [ADR-0005](0005-push-sender-needs-billing-or-a-token-chain.md).

**India is one of the expensive tiers.** From Google's own Identity Platform
table, read directly because published summaries disagreed by 7x:

| Country       | Per SMS   |
| ------------- | --------- |
| United States | $0.01     |
| Australia     | $0.02     |
| India         | **$0.07** |
| Germany       | $0.10     |
| Indonesia     | $0.35     |

First ten per day unbilled. At 1,300 OTPs/month that is roughly **$70/month
(about Rs 6,150)** against **Rs 325** through an Indian aggregator, about 25x per
message.

**It moves identity off Supabase Auth.** Firebase issues a Firebase ID token, not
a Supabase session. Supabase does support Firebase as a third-party auth
provider, so this is possible rather than a hack, but `auth.uid()` then resolves
to a Firebase UID _string_, not a UUID from `auth.users`. This schema has **64
`auth.uid()` calls across 23 RLS policies**, eight `p_user_id uuid` parameters and
230 pgTAP assertions built on UUID literals.

The bounded version of that migration is a `profiles.firebase_uid text unique`
column plus a `current_profile_id()` helper, keeping every UUID key and rewriting
the policy predicates, perhaps a day. The unbounded part is the second-order
effect: Google sign-in currently runs through Supabase Auth and is verified
working, and mixing a Firebase token for phone with a Supabase session for Google
means two token types and two RLS predicates. Realistically Google moves to
Firebase too, which puts a working sign-in back in play.

**Decision: Fast2SMS as the carrier, through the hook that already exists.**
About Rs 0.25/SMS, Supabase Auth keeps issuing sessions, no schema change, no
billing account. Its `otp` route injects our code into their pre-approved DLT
template, so there is nothing to register.

Two things about it that are not obvious:

- **The route is India-only.** Fast2SMS wants a bare ten-digit number, so
  `indianTenDigits()` in the hook rejects anything else with a 400 _before_
  spending. The sign-in screen deliberately leaves the country code editable, so
  a foreign number can reach this point and must be told, not left waiting for an
  SMS that never left.
- **Fast2SMS reports failure inside a 200**, exactly as MSG91 does, so success is
  proven by an explicit `return: true` and nothing else.

### What each route actually requires

Corrected after probing every route rather than generalising from one. These are
the API's own responses, not documentation, no route was ever charged, because
none of them got as far as sending.

| Route             | Response                                                     |
| ----------------- | ------------------------------------------------------------ |
| `route=otp`       | 996, "complete website verification. Visit OTP Message menu" |
| `route=q`         | 999, "complete one transaction of 100 INR or more"           |
| `route=v3`        | 999, same                                                    |
| `route=dlt`       | **406, "Invalid Sender ID"**                                 |
| `route=notaroute` | 999, same as q/v3                                            |
| `/dev/otp/send`   | 400, "The otp id field is required."                         |

Two corrections to an earlier reading of this, both worth keeping:

**The Rs 100 gate does not apply to the routes we want.** It was first seen on a
deliberately invalid route and generalised to the whole API, which was wrong. It
gates `q`, `v3` and unrecognised routes.

**`route=dlt` is already available on this account.** It passed the account gate
and failed only on a fake sender id, which means the account itself is not the
obstacle, a DLT-approved sender and template are. That makes DLT registration
the single unlock that serves both vendors: with an entity id, header and
template, Fast2SMS `route=dlt` and MSG91's Flow API both work, both cost less per
message than a shared template, and both can carry the SMS-autofill hash.

So there are two ways forward and they are not the same size:

1. **`route=otp` after website verification.** No top-up. Unbranded sender, no
   autofill. This is the fast path and it is what `FAST2SMS_ROUTE` defaults to.
2. **DLT registration, then `route=dlt` or MSG91.** One to three weeks, and it is
   the destination either way, cheaper, branded, autofillable.

Whether `route=otp` has a second gate behind website verification is not known:
996 is returned first, so nothing past it can be observed yet.

**MSG91 remains the better destination later.** With an approved DLT template it
is cheaper per message, carries a branded sender id, and can include the
SMS-autofill hash that the shared template cannot. `FAST2SMS_ROUTE=dlt` and a
sender id are already handled in the hook, so that move is configuration.

---

## 6. WhatsApp OTP: attempted, blocked, and the pattern underneath

Tried on 2026-08-22 in the WhatsApp Manager, because a WhatsApp Business account,
a number and a Meta account already existed. Recording what was actually found,
since "we already have it" turned out to mean something different from what was
needed.

**Cost would have been good.** India authentication messages are ~Rs 0.115 (Meta
base) to Rs 0.145 (BSP-inclusive) plus 18% GST, cheaper than SMS at Rs 0.25 and
far below Firebase's Rs 6.15.

**One trap worth knowing before registering anything.** Since 1 April 2026 Meta
charges a separate _authentication-international_ rate when the WABA is registered
in a different country from the recipient: $0.0304 against $0.0014, about 22x. The
WABA has to be registered in India or WhatsApp costs more than SMS.

**What the account actually is.** A WABA exists (`1314123584024366`, business
portfolio `1342961154389274`, "Nanoclaw") but it is Meta's **test** tier, and its
only number is Meta's test number `+1 555-640-9610`. Creating the authentication
template failed outright:

> Cannot create message template, This WhatsApp Business account does not have
> permission to create message template

Test WABAs are locked to the seeded samples (`hello_world`, `jaspers_market_*`).
None is an authentication template with a code variable, and using a _utility_
template to carry an OTP would be both absurd in the message body and a category
violation. So WhatsApp OTP cannot be built or even developed against here.

**The underlying blocker.** Business portfolio → Business info reports:

| Field                        | Value           |
| ---------------------------- | --------------- |
| Business verification status | **Unverified**  |
| Legal business name          | No name         |
| Address                      | No address      |
| Business phone number        | No phone number |
| Website                      | No website      |

Verification has not been started, and none of the details it needs are entered.

**Also learned in passing:** zero-tap and one-tap auto-fill both require the
Android package name plus an 11-character app signature hash, the same value the
SMS Retriever hash needs, and therefore the same trap: under Play App Signing it
depends on Google's certificate and cannot be computed before the first upload.
Copy-code needs none of that, so it is the right first choice; the template
settings that work are Authentication → One-time passcode → Copy code, with
"expires in 2 minutes" to match `otp_expiry`.

## 7. The pattern, stated once

Three vendors have now been tried and each ended in the same place: **every
production SMS or WhatsApp channel for Indian recipients requires a verified legal
entity.** DLT needs entity registration; WhatsApp needs Meta business
verification; MSG91 and Fast2SMS both need DLT for their cheap branded routes.
The obstacle is not the vendor and switching vendors does not move it.

So there is exactly one action that unblocks all of them at once, register and
verify the business entity, and one that does not need it at all: Fast2SMS's
`route=otp`, whose gate is _website verification_ rather than entity
documentation, and there is already a live site to verify against.

Ordering that follows, and it is the recommendation:

1. **Ship to Play with Google sign-in**, which is ready and verified. Phone is
   behind `PHONE_AUTH_ENABLED` and the app does not offer it, so there is no
   half-feature for a reviewer to find.
2. **Fast2SMS website verification**, the only unlock that needs no entity
   documents, and it makes phone OTP live.
3. **Business entity verification** once, which then opens DLT, MSG91's branded
   sender, WhatsApp, and the autofill hash together.

---

## 8. Amended: phone _verification_ ships now, on the widget

Date: 2026-08-22

Section 2 left "widget or hook" open and section 5 concluded that every SMS route
into India needs DLT. Both still hold for phone **sign-in**. This section records
that verification is a different feature, and that it is not blocked.

### The distinction that unblocks it

Sign-in needs Supabase Auth to send the SMS, so it needs a DLT template.
Verification does not: the session already exists from Google, MSG91's widget
sends and checks the code itself, and all we do is record which number the
account holds. So the widget's weakness in section 2, that it returns a token and
not a session, is irrelevant here. It is being asked to prove a number, not to
authenticate anyone.

What this buys is the accountability the anonymous session lost in ADR-0004: a
banned account is cheap to replace with a fresh Google account, and a verified
number makes it cost a SIM.

`PHONE_AUTH_ENABLED` stays `false`. Phone is still not a way in.

### Not using `@msg91comm/sendotp-react-native`

The package was read before this was decided. Its OTP path is three `fetch`
calls to `control.msg91.com/api/v5/widget/{sendOtpMobile,verifyOtp,retryOtp}`,
each posting `{widgetId, tokenAuth, ...body}`. Nothing in it is native.

What it adds:

- A `BiometricAuth` native module, unrelated to OTP, autolinked via its
  `react-native.config.js`. Its `android/build.gradle` declares its own AGP 8.1.0
  classpath, pins `compileSdkVersion 34`, and requests
  `com.facebook.react:react-native` with no version, which does not resolve on
  React Native 0.86.
- Untranspiled TypeScript as `main`.
- A `DefaultWidget` that is a second design system: its own modal, theme and
  country picker, none of it built from our tokens.

So the trade was a probably-broken Android build and a foreign UI against writing
three fetches. We wrote the fetches: `src/lib/msg91Widget.ts`, with our existing
`CodeField` on top. A contract test asserts the package stays out of
`package.json`.

### Where the trust sits

`tokenAuth` is the widget's _client_ token and ships in the APK, which is what
MSG91 issues it for. It is not the server authkey. The access token the widget
returns is worth nothing by itself: `verify-phone` asks MSG91 which number that
token belongs to and stamps _that_, so a client cannot claim a number it has
never held. A contract test asserts the client never puts a number in the body.

### The widget as configured

Widget `SecureOTPWidgetQHYJ`, id `36687570694c393835393232`. Both client values
are now in `.env`, which is gitignored.

| Setting             | Value                 |
| ------------------- | --------------------- |
| Default channel     | SMS                   |
| Retry channels      | SMS, WhatsApp, Voice  |
| OTP length          | 6                     |
| Resend after        | 10s                   |
| Resend count        | 2                     |
| Retry time          | 15 min                |
| Country restriction | Allow specific: India |
| Invisible OTP       | Enabled               |

Two notes on that table. The country restriction to India matches the
`indianTenDigits()` guard in `send-sms`, so the two agree.

**Retry time stays at 15 minutes** (Amit, 2026-08-22), and that is a deliberate
divergence from the 120-second `otp_expiry` this project chose for Supabase.
Recorded rather than quietly tolerated, because the two numbers look like a
contradiction to anyone reading both files. They govern different paths: Supabase
sends its own SMS on the sign-in path, MSG91 owns the code on the verification
path, and the 15 minutes is MSG91's window for retrying an existing request. The
argument for 2 minutes was about a login credential sitting in a notification
shade. A verification code on an account somebody is already signed into is a
weaker thing to steal, so the shorter window buys less here.

### Verified

The client path, twice, from a plain server-side runtime with no `Origin` header:

```
sendOtpMobile -> HTTP 200  {"message":"366876684971393333303934","type":"success"}
verifyOtp     -> HTTP 200  type=success  accessToken length=160
```

Run against MSG91's configured demo credential, so no SMS was sent and no real
number was messaged. This settles the risk that would have sunk the design: the
widget's `Integration = Mobile` setting does **not** refuse a non-browser
request. The `"Web requests are not allowed for this widget"` message is for
requests that carry browser headers.

### Not verified, and blocked

`verifyAccessToken` has never returned success. With a real, freshly minted
access token it answered `{"message":"AuthenticationFailure","code":"201"}` for
both the header-on-`api.msg91.com` shape this file used originally and the
documented body-on-`control.msg91.com` shape it uses now. The stored authkey is
not the value rotated away on 2026-08-21 and has the right account prefix and
length, so "stale key" does not obviously explain it either.

Two placements remain untested, because MSG91 answered `IPBlocked` after several
demo requests in quick succession. Resume from there rather than re-running what
is already known to fail.

So the last hop of the chain is unproven. Until it works, a user would enter a
correct code, MSG91 would accept it, and the number would not be recorded.
`widgetConfigured()` gates the entry point, which is why the values being in
`.env` is not the same as the feature being on for everyone: it is on for a local
build, for exactly this kind of testing, and a release build gets whatever CI
provides.
