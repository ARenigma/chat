# ADR-0016, Onboarding is one screen

Status: **decided and shipped**
Date: 2026-08-26
Reference: [FuseAppOnboarding](https://github.com/georgecartridge/FuseAppOnboarding),
translated file by file rather than reproduced from a screenshot

---

## 1. The decision

The whole of onboarding — welcome, sign-in, verification, completion — is a
single React component with no navigation inside it. One atmospheric field mounts
at the start and survives to the end. Everything else is a transition over that
surface.

This is not a styling choice. It is the property that makes the reference feel
like a place rather than a sequence, and it is the first thing that a reasonable
refactor would destroy. `__tests__/onboarding.test.ts` fails if a navigator
appears in the file or if `<BloomField>` is rendered more than once.

## 2. What the field actually does

Three radial gradients over white, nested, each fading to **transparent** rather
than to the page colour so overlaps composite instead of interpolating. Across
the flow only three things about them change:

| Property    | Welcome         | Everywhere after                             |
| ----------- | --------------- | -------------------------------------------- |
| centre      | bottom edge     | top edge (innermost overshoots to `y: -0.2`) |
| solid core  | 300 / 200 / 80  | collapsed to 0 / 50 / 0                      |
| `endRadius` | 500 / 450 / 350 | **unchanged**                                |

`endRadius` never moving is the point. The field does not slide away and it does
not fade out; its centre travels while its size holds. Every change is carried by
the same three staggered animations, delayed 0.65 / 0.52 / 0.40 seconds — widest
last, so the innermost core leads.

## 3. Four things a screenshot cannot tell you

Each of these was built wrong first, shipped, and only caught by reading the
source or by frame-stepping a recording.

1. **The exit is a re-centring, not a translation.** Sliding the layers off the
   top and fading them reads as a curtain being pulled.
2. **The widest layer moves last.** Inverting the delays turns a field unfurling
   into a field collapsing.
3. **The carousel rows travel downward.** `window.insert(at: 0)` pushes every
   surviving row down one slot; the motion is the effect. Swapping text inside
   stationary rows gives the right words with none of it.
4. **The colour changes on every interaction**, not every step. The source
   reassigns `gradient` on each submit, so the field turns over under every tap.

Point 3 hid behind a subtler bug worth recording: the window expression
`(WINDOW_SIZE - 1 - row) - tick` produces the correct highlighted word and the
wrong direction, because the highlighted row is the centre of five and the centre
is a fixed point of the reversal. It passed every test. The tests now pin the
whole array against the source's own trace.

## 4. Where we deliberately differ

**The checklist branches.** Fuse's three steps are sequential — every user needs
all three keys — so its list is full height from the first frame. Ours are
alternatives: Google **or** phone, never both. A permanently visible "Your code"
row would be a promise the Google route never keeps, so the list grows a second
row only on the phone branch, using the same transition.

**Marks are 28pt, not 38.** Fuse uses full-colour illustrations. Ours is
hand-drawn line geometry built for a 20–28pt tab bar; at 38 the outlines read as
empty boxes. Related: `phone` is unusable above tab-bar size because its handset
end-caps derive from stroke weight rather than the box, so only the arc survives
and it reads as a smile. `receipt` carries the code step instead.

**Palettes rotate within one accent.** The source goes blue → orange → purple,
which it can afford because a wallet has no colour story. This app has one coral
and the field is the only place it appears at full strength.

## 5. Sign-in

Google runs through **Credential Manager** in an app-owned bottom sheet
(`GoogleCredentialModule.kt`), which is what keeps the one-screen property intact
through the only step that used to leave the app. The browser redirect remains as
a fallback for devices that cannot show the sheet.

Three rules encoded there and asserted in tests:

- The sheet is requested twice — filtered to authorised accounts first, then
  opened wide. One-shot with the filter off always shows a full picker; one-shot
  with it on fails outright for a first-time user.
- A **dismissal is not a failure**. It propagates rather than falling back, and
  the screen shows nothing. Falling back would reopen the browser under someone
  who just closed the sheet.
- The nonce is generated and SHA-256'd natively. Google gets the hash, Supabase
  gets the original, because `skip_nonce_check = false`.

Phone sign-in goes through the Supabase send-SMS hook with **Fast2SMS** as
carrier. See §6.

## 6. Correction to ADR-0009 and ADR-0006

Both said phone OTP was gated on our own TRAI/DLT registration, one to three
weeks. `supabase/config.toml` repeated it and named MSG91 as the carrier.

**`send-sms/index.ts` has only ever read `FAST2SMS_API_KEY`.** Fast2SMS's OTP
route sends on _their_ registered template, so no DLT registration of ours is
required and the gate described in those ADRs was a gate for a carrier we do not
use. Phone sign-in was enabled on 2026-08-26.

What riding their template costs, so it is a decision and not a surprise: no
custom sender ID, and no app-signature suffix, so **Android SMS Retriever
autofill will not fire** and the code has to be typed. ADR-0009 §1 remains
correct that the autofill hash depends on Google's app-signing certificate and
cannot exist before a first Play upload; that work is simply no longer on the
critical path.

MSG91 remains in the picture only for `verify-phone`, the separate widget path
for attaching a number to an account that already has a session.
`PHONE_VERIFY_ENABLED` stays **false** until `verifyAccessToken` returns success
at least once.

## 7. The keyboard is part of the layout

Following [Android's layout guidance](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics),
the IME is a first-class occupant of the window rather than something to draw
behind. The manifest asks for `adjustResize`, and **that alone was not enough**:
React Native 0.86 runs edge-to-edge, where the window no longer shrinks, and the
form is absolutely positioned over the field — so the phone input sat underneath
the keyboard.

Two changes, both from the source's own behaviour:

- `KeyboardAvoidingView` (`height` on Android, `padding` on iOS, matching
  `AuthScreen` and `ChatScreen`) lifts the bottom-anchored block.
- The field slides off the top while the keyboard is up, which is
  `showGradient = !keyboardShown` in the source. A raised keyboard leaves about a
  third of the display, and a saturated field in the remainder makes a text input
  something to squint at.

Listeners are `keyboardDidShow` / `keyboardDidHide`; the `Will` variants are
iOS-only and a `Will`-only listener is a silent no-op on Android.

## 8. Performance, and what we do not know

The transition measures 52% janky frames on the only device available here. That
number is not usable: the emulator's `ro.hardware.egl` is `emulation`, ANGLE over
SwiftShader, a software rasteriser, and a radial gradient is the worst thing to
hand one. Hardware-texture promotion was tried and moved it to 52.3%, which is
noise, so it was reverted rather than pay the memory for an unproven win.

Re-measure with `dumpsys gfxinfo` on physical hardware before changing anything
here. There is no Material 3 motion library for React Native and none is wanted;
Reanimated 4 runs on the UI thread, which is what the reference is doing too.

**The 2026-09-02 jerk, and how it was found.** A visible jerk right as the field
came to rest was diagnosed by frame-diffing a `screenrecord` at 30fps rather than
by watching. The tell was an ISOLATED spike in mean-abs-diff at ~1287ms after the
Continue tap — one frame of large change AFTER the field had settled to zero
diff at 1188–1254ms. It was the welcome palette being re-exposed: the colour used
to swap at the 1.2s handoff (a second staggered cross-fade), landing in the same
tick as the form mount, and for one frame the base layer still painted the old
welcome gradient under an arriving layer at opacity 0. See §2 (colour now leaves
at t=0 with the exit, not at the handoff) and `BloomField.tsx` (two-slot swap).
After the fix the field settles clean (0.0 at 1155–1221ms) and the only later
activity is the form fading up over a static field. Emulator janky-frame % moved
5.2 → 8.2 across the two captures, which on SwiftShader is noise (8 vs 10 frames);
the frame-diff is the signal that means something until this is re-run on hardware.

## 9. The nine gaps, and where they landed (2026-08-26)

A line-by-line diff against the Swift found nine places where the first build had
the structure right and the behaviour missing. Seven are closed:

| #   | Source                                  | Now                                                                                   |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `CompletionStep` works, then resolves   | `CompletionRow.tsx`: spinner, then the mark on `bounce`, text swapped on a key change |
| 2   | `keyboardShown = false` on submit       | `Keyboard.dismiss()` in both submit paths                                             |
| 3   | glyph `.move(.leading)+.opacity+.scale` | `ZoomInLeft`                                                                          |
| 4   | description in `+30`, out `-60`         | `FadeInUp` / `FadeOutUp`                                                              |
| 5   | `ContinueButton` is icon + label        | mark restored before the label                                                        |
| 6   | submit `.opacity(isValid ? 1 : 0.2)`    | `goIdle` fill while the field is short                                                |
| 8   | column masked clear→black→black→clear   | two page-coloured scrims at 30% each end                                              |

Two are deliberately open:

**7 — per-step success state.** The source dims a completed input to `0.4` and
disables it. Ours has no moment to show it: the phone field unmounts the instant
the code step opens, so the state would exist for less than one frame. It becomes
real only if a step ever stays on screen after being answered.

**9 — the newly inserted row skips its animation.** The source's
`.transaction { if item.id == window.first?.id { animation = nil } }` stops the
top row flying in from outside the frame. Our carousel translates the whole stack
rather than animating rows individually, and `COLUMN_OFFSET` already parks row 0
above the visible frame, so there is nothing on screen for the exemption to
protect. Implementing it would change no pixels.

**A tenth gap, closed 2026-09-02: colour and position exited as two events.** The
port held the welcome palette through `leaving` and swapped colour only at the
1.2s handoff, so the field turned over twice — once in position at t=0, once in
colour at t=1.2s. The source does it once: `gradient = form.first.gradient` is
assigned inside the same `withAnimation(.smooth(duration: 0.7))` as `phase = 1`
(`OnboardingFlow.swift:69-74`), and the per-gradient `.animation(.smooth.delay(x),
value: phase > 0)` delays only centre/radius. `paletteFor('leaving')` now returns
the form palette, so the handoff does no field work; and the form subtree is
mounted (hidden) at the press so its commit lands in the 0–400ms window where no
layer moves, not on the field's last frames.

**Three departures where this app had already decided the question**, all argued
in the code rather than silently taken: the busy indicator is this app's
eight-spoke `Spinner` rather than the source's rotating dashed circle; the
completed mark is the accent rather than green, which appears nowhere in this
palette; and the carousel mask is two scrims rather than a real mask, which is
only equivalent because the column sits directly on `bg/base`.
