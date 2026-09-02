# The Fuse motion system

Extracted 2026-08-22 from `pin/734368283032602485` frame by frame, at 111ms and
154ms sampling, using the `video-analyzer` MCP against a local copy of the clip
(720x720, 30fps, 24.7s, silent).

**Colour is deliberately excluded.** Amit's instruction: take the system, not the
palette, because ours stays coral. Fuse cycles blue then orange then purple per
step; the transferable part is _that the accent changes per step and how it
changes_, not which hues.

## What the clip actually is

A wallet key-creation onboarding, five states:

| Time         | State                                          |
| ------------ | ---------------------------------------------- |
| 0:00         | Looping word carousel, Continue with Apple     |
| 0:01 to 0:03 | Native Sign in with Apple sheet, Face ID, Done |
| 0:05 to 0:10 | Device Key then 2FA Key steps                  |
| 0:11 to 0:17 | Recovery Key: email, then a 6 digit code       |
| 0:18 to 0:23 | Setting up, then ready                         |

## Rule 1: the word carousel is a continuous loop, not a pager

Three words stacked vertically, one focused. The focused word is full-weight and
full-opacity with a small coloured glyph beside it; its neighbours sit at roughly
10% opacity at the same size. It advances about every 1.1s on its own, and it
**keeps running behind a presented modal** rather than pausing.

Transferable as a device for saying three things in one screen's worth of space
without a pager or dots.

## Rule 2: one accent per step, cross-faded through a desaturated midpoint

On advancing a step the accent interpolates rather than cutting. Measured across
frames 8 to 10 of the 0:07 to 0:09 burst, roughly **220ms**, and the midpoint
frame is visibly desaturated, which is what interpolating through a colour space
looks like rather than a wipe or a fade-to-white.

## Rule 3: the accent wash is a top-anchored feathered radial, and only on active steps

Not a linear gradient and not a flat fill: a heavily feathered radial bleeding
down from the top edge, no discernible edge anywhere.

It is **absent entirely on terminal states.** The final "Your wallet is ready"
screen is pure white. So the wash means "work in progress", which makes it
information rather than decoration.

On the larger screen-to-screen transition at 0:04 to 0:07 the wash travels from a
bottom anchor to a top anchor and **overshoots its radius before settling**, over
roughly 1.4s. That overshoot is the "bounce".

## Rule 4: the stepper persists, and promotion is fast

The three steps stay on screen throughout. The active one carries larger type at
full opacity plus a coloured marker; completed and pending ones drop to about 25%.

Promotion from one step to the next completes **within a single 111ms sample**, so
it is at or under about 150ms. It is much faster than the accent cross-fade
happening around it, which is what stops the screen feeling like it is sliding.

Marker states are distinct glyphs, not just colours: pending is a faded outline,
active is a ring, in-progress is a spinner ring, complete is a filled dot.

## Rule 5: the CTA narrates itself

"Create Device Key" becomes "Creating Device Key" on tap, and the pill compresses
slightly. No spinner inside the button; the progress lives in the Dynamic Island.

## Rule 6: progress and success live in the Dynamic Island

Expand to a rounded square over about **330ms**, show a progress ring, resolve to
a check, hold about **450ms**, then collapse in about **150ms**.

This is the single largest "bounce" in the clip and most of it is Apple's own
spring, not the app's.

## Rule 7: text state changes are opacity only

"Setting up your wallet" to "Your wallet is ready!" is a pure cross-fade with **no
scale and no translate**. Nothing in the clip scales text.

## How this lands in our codebase

All physics belong in `src/theme/motion.ts`, which a test already enforces as the
only place springs may live. Nothing here should be written inline in a screen.

| Rule                                  | Where it landed                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Word carousel                         | `WordCarousel`, on `AuthScreen`'s first step                                           |
| Accent per step, cross-faded          | `Stepper`, in the provider application flow                                            |
| Top-anchored wash, active states only | **dropped.** See "The wash, decided" below                                             |
| Persistent stepper, fast promotion    | `Stepper`, same                                                                        |
| Self-narrating CTA                    | `Button`'s `busy` / `busyLabel`, all ten mutation buttons                              |
| Dynamic Island progress               | not portable. Android equivalent is a notification or an in-app pill                   |
| Opacity-only text swaps               | `fadeSwap`: the auth title, the application intro, the status copy, every button label |

**Correction to the row above.** This table used to say rules 2 and 4 applied to
"the provider application flow, which already has steps". It did not have steps:
`ProviderApplicationScreen` was one `ScrollView` with six fields and one button.
It has three now, and the regrouping paid for itself independently of the motion:
date of birth was the third of those six, so the screen's own promise, that the
age gate refuses a 17-year-old immediately rather than after six fields, was not
being kept. It is in the first group of three now. The field-to-step map lives in
`src/lib/applicationSteps.ts` so `missing_fields` can open the step holding the
first flagged field, and a contract test fails if a field on the form belongs to
no step.

The only real step machine before that was `AuthScreen`'s three-step type, which
is where rule 1 went anyway.

Two things do not transfer and should not be faked:

- **The Dynamic Island.** Android has no equivalent surface. Forcing a floating
  pill in the status bar area would be an imitation of a platform affordance
  rather than a use of one.
- **Face ID.** Our auth is Google OAuth through the system browser.

## Two rules reinterpreted rather than copied, and one deleted

Written down because a reader who knows the clip will otherwise think they were
dropped, and re-add them.

**Rule 2's hue cycle became a walk up the coral ramp.** Fuse goes blue, orange,
purple. Our palette is coral-only by settled decision, so cross-fading coral to
coral is nothing at all and the rule would have reduced to decoration. What
transfers is the _mechanism_: interpolate rather than cut, and pass through a
desaturated midpoint. `border/strong` grey → `bg/accent` → `bg/accentStrong`,
interpolated in RGB, and the midpoints of that genuinely are desaturated
mid-corals. Measured against both page colours before it was accepted: 1.68:1,
3.44:1 and 5.19:1 on white and 6.11:1 on black, so every state clears the 3:1
non-text minimum. `bg/accentTint` looks like the obvious first rung and is not
usable as one: it measures 1.22:1 on white, the same failure the tokens file
already records for the citrus.

**Rule 4's larger active type became opacity-only promotion.** The two rules
contradict each other and rule 7 wins. Swapping a type style reflows the row on
the frame the state changes while the opacity is still travelling over 150ms, so
the label jumps and then fades. One type style for all three labels; promotion is
carried by opacity plus the marker shape. A contract test asserts `Stepper` reads
exactly one typography token, so this cannot be quietly "restored".

**Rule 4's in-progress spinner marker was deleted.** The reference has four marker
states and one is a spinner ring. Nothing in this flow is ever mid-step:
`useSubmitApplication` is a single mutation at the very end, so that glyph could
never appear. The CTA narrates the submit instead, which is rule 5. The three
remaining markers are still distinct _shapes_ and not only colours, as the
reference insists: ring, filled disc, filled disc with a tick.

## The wash, decided: dropped

Rule 3 does not ship. Recorded properly because the reasoning is not "it was
hard", and because the research behind it should not be repeated by whoever picks
this up next.

**The technical objection is gone.** It needs no dependency: React Native 0.86.2
ships radial gradients in core via the `experimental_backgroundImage` style prop.
Verified in the installed tree, on both platforms (`RadialGradient.kt` on
Android, `RCTRadialGradient.mm` on iOS, and the prop lives in shared
`ReactCommon`), with no API-level gate anywhere near this app's `minSdkVersion`
24, using a real hardware shader so the feathering is genuine rather than
approximated. It also does not reproduce the failure that got `react-native-svg`
banned: the crash there was a layout event dispatched from inside a draw pass, and
a style-resolved background drawable dispatches nothing. The blur alternative was
investigated and is worse than it looks: RN implements `filter: blur()` on
Android with `RenderEffect`, which is API 31+, so on a minSdk 24 app it silently
renders nothing on 24 through 30.

**Three reasons it still stays out, in order of weight.**

1. **Half the rule cannot be built at all right now.** Reanimated 4.5.3 lists
   `experimental_backgroundImage: false` in its animatable-prop config. The clip's
   overshoot, the wash travelling to a new anchor and overrunning its radius
   before settling, which is the _bounce_ and most of why rule 3 reads as good,
   cannot be driven on the shader. Adopting today would ship the static half of a
   rule whose moving half is the point, and shipping half of it is how it gets
   judged and rejected on the wrong evidence.
2. **It is the first non-flat surface in a system that asserts flatness**, in the
   tokens, in the ADRs, and in a test. Adopting it means editing
   `theme.test.ts`'s `has no gradients or glow anywhere`, a gate that is the
   repo's record of a deliberate decision, not an obstacle. That gate is left
   exactly as it was, which is what keeps this decision reversible in one
   argument rather than one commit.
3. **It puts the accent behind a page**, which the accent budget forbids in
   spirit. The budget's own test only matches `backgroundColor`, so a wash would
   pass it on a technicality, and passing a gate on a technicality is worse than
   failing it.

**What it would take to reverse this**, so nobody has to rediscover it: an ADR
(the flatness decisions are on the record and a migration comment is the wrong
place to overturn a document); a narrowing of the gradient assertion rather than a
deletion of it, scoped to one named file so decorative gradients stay banned
everywhere else; two colour tokens rather than one, because
`scripts/check-contrast.mjs` does `parseInt(hex.slice(1, 3), 16)` and silently
ignores the alpha on an 8-digit hex, so the rendering token has to stay 8-digit
while a pre-composited opaque twin is what gets measured; and the far colour stop
ended at the same RGB with zero alpha rather than at the keyword `transparent`,
because nothing premultiplies for you and a transparent-black stop smears through
grey. That last one is not hypothetical: the same trap is live in
`Stepper.tsx`'s marker ramp, and the comment there names it.

The other five rules stand on their own without it, which is the other half of
this decision: nothing that shipped is waiting on the wash.

## Rule 1 is measured out, not implemented

Adopted, watched on a device, and reverted the same day. Recording it because the
reason generalises to any opacity-driven focus in this app.

The carousel was driving the three claims on the sign-in screen. On the emulator
it cycled correctly at the reference's cadence, and the two unlit lines were
unreadable, which is what the component was built to do: the Fuse reference puts
neighbours at roughly 10% opacity.

The arithmetic rules it out for body copy:

| Neighbour alpha | Composite on white | Contrast | AA at 4.5:1 |
| --------------- | ------------------ | -------- | ----------- |
| 0.10            | `#EEEEEE`          | 1.16:1   | fails       |
| 0.50            | `#AAAAAC`          | 2.32:1   | fails       |
| 0.80            | `#77777B`          | 4.46:1   | fails       |
| 0.85            | `#6E6E73`          | 5.07:1   | passes      |
| 1.00            | `#55555A`          | 7.41:1   | passes      |

The effect needs a deep fade and accessibility needs a shallow one, and 0.85 is
where they cross: by then the fade is imperceptible and there is no effect left.

The content made it worse. One of the three lines was "Not therapy, just
company", which is the product's whole ethical position, and it was unreadable
two thirds of the time.

So rule 1 applies only to **decoration**. In the reference it cycles single words
inside a display-size headline, where every variant is a complete thought and
nothing is concealed. `WordCarousel` is kept, unused and clearly marked, because
that home is real and the component is correct; adopting it needs headline copy
chosen on purpose, which is a product decision rather than an implementation one.

Worth naming what caught this: nothing did, automatically. `contrast:check`
measures token pairs, not composites, and the screen passed every gate. It was
caught by recording the emulator and stepping the frames.

## Screen transitions (M3 hybrid, added 2026-09-02)

The rules above are the Fuse onboarding surface. This section is the app-wide
screen/surface motion language, decided with Amit on 2026-09-02 (Option C of the
motion research): Material 3 _standard-scheme_ springs for anything that moves or
resizes, M3 emphasized easing for opacity and colour, and the M3 transition
patterns for choreography. It is a hybrid because M3's own transition-patterns
doc still specifies enter/exit on easing+duration while telling you to move to
springs for spatial motion — so spatial is springs, effects is timing.

Everything lives in `src/theme/motion.ts`; no screen writes its own physics.

| Pattern              | Where                                           | Builder                      | Physics                                                                                                                                        |
| -------------------- | ----------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Forward / back       | pushed overlays, provider tree, Recharge wallet | `screenIn` / `screenOut`     | fade (emphasized-decel in 300 / emphasized-accel out 200) under a short `±distance.push` slide on `spatialSlow`; direction from `navDirection` |
| Top-level            | tab layers (Favourites/Calls/You), boot phases  | `topLevelIn` / `topLevelOut` | exiting fades out (100), then entering fades in (200); no slide, no shared element                                                             |
| Enter / exit (sheet) | `Sheet`, `SpotlightCard`                        | `sheetIn` / `sheetOut`       | Y on `spatialDefault`; the sheet body never fades — the scrim carries the dim                                                                  |
| Enter / exit (menu)  | `PaperMenu`                                     | `menuIn` / `menuOut`         | `scaleY` from the anchor edge on `spatialFast` + a short fade; `transformOrigin` set by the caller                                             |
| Row entrance         | `ProviderRow`, `ProviderCard`                   | `rowIn(index)`               | opacity + `translateY 12→0` on `spatialSlow`, staggered                                                                                        |
| First-boot dissolve  | welcome → AuthScreen                            | `authArrive`                 | a 700ms fade, matching the onboarding content beat                                                                                             |

**Direction is a shared value, not a prop.** `navDirection` (`makeMutable`) is set
by the navigation helpers immediately before the route changes — `pushRoute`/
`pushProvider` set `'forward'`, `popRoute`/`popProvider`/`leaveChat` and the
hardware-back handler set `'back'`. `screenIn`/`screenOut` read it when they run,
which for the leaving screen is at unmount, after its props are gone; a shared
value is the only thing that survives that. The Recharge wallet page sets
`'forward'` on its own not-visible→visible transition in render, before the mount
commits, so a preceding pop cannot leave it entering from the wrong side.

**The Reanimated spring trap.** M3 publishes standard springs as
`{dampingRatio, stiffness}`, and `withSpring` _silently ignores stiffness_ the
moment a `dampingRatio` key is present (it switches to a duration
parameterisation — `react-native-reanimated/.../spring/spring.js`). So the M3
springs are authored as ratio+stiffness in `design/tokens.json` and the generator
emits the physical triplet `damping = 2·ζ·√(k·m), mass:1` that `withSpring` and
the `.springify()` layout builders both honour. A test round-trips the ratio.

**Reduced motion is a split, not an off switch.** Opacity animations carry
`ReduceMotion.Never` (a fade is the accessible fallback and must still run);
translate and scale carry `ReduceMotion.System` (via `springTo`), so they collapse
to nothing. The net effect under "remove animations" is exactly "fades only".

**Bloom timings stay separate.** `src/lib/bloom.ts` (`BLOOM_FIELD_MS` etc.) is a
source-measured system from the Fuse clip and sits outside the M3 tokens; the
onboarding field is not an M3 transition and must not be retuned by them.

**Predictive back.** RN 0.86 registers an always-enabled `OnBackPressedCallback`
at targetSdk 36, so the system treats the app as handling back and the opt-in is
on by default — no manifest flag is added (`enableOnBackInvokedCallback="false"`
would be the opt-out). RN exposes no gesture-progress to JS, so an in-app back
_preview_ is not possible; the M3 `screenOut` back variant stands in, and root
back shows the Leave dialog. Verify on an API 36 device that the launcher preview
is suppressed and `hardwareBackPress` fires once per gesture.

### Addendum, 2026-09-02 evening — what the device taught the screen transition

Everything below was found by frame-stepping `screenrecord` at 60fps on the S22
Ultra with a Metro-served debug build, after a false start (see the last point).

- **`entering` layout animations do not run on the pushed overlays.** The custom
  worklet builder and a stock `FadeIn` were both frame-stepped: the layer painted
  at full opacity in a single frame every time, while `exiting` on the same view
  ran correctly. The entrance is therefore driven from shared values
  (`useScreenEnter` in `motion.ts`): the view mounts at opacity 0 / offset 48
  from the style's initial values and the ramp starts from `onLayout`, once the
  screen has real geometry — Telegram's `needDelayOpenAnimation` in effect.
  Starting it from `useEffect` was tried first and the clock ran ahead of a heavy
  screen's first paint, so ChatScreen's first visible frame was already two-thirds
  faded.
- **Home's slide-in is kicked from the pop, not from the new route.** An effect on
  `route.name === 'home'` ran after the overlay had begun fading, so Home's jump
  to -48 was visible through it (a 28-unit spike in the frame diff). `revealHome()`
  is called by `popRoute`/`leaveChat`/the back handler _before_ `setRoute`, while
  the overlay is still opaque; Home then settles on the same `spatialDefault`
  spring the overlay leaves on, so the two halves move together.
- **The screen fade is Telegram's curve, not M3's.** `emphasized-decelerate`
  (0.05, 0.7, 0.1, 1) is ~70% complete 35ms in; over a 150ms fade it finished in
  two frames and read as a cut. `M3.easing.decelerate` (0.33, 1, 0.68, 1) is the
  cubic ease-out Android's `DecelerateInterpolator(1.5f)` draws and what Telegram
  runs its 150ms push/pop on (`ActionBarLayout.java:614`, `:1873`); the pop is the
  same curve mirrored (`:1899-1907`). Geometry is Telegram's too: 48dp of travel
  (`:1893`), 150ms (`:1830`). Recorded as a departure in the token note.
- **No opaque cover between Home and a pushed screen.** `coverHome` snapped to
  white in one frame and the overlay then faded in white-on-white — invisible —
  while the deferred content popped in unanimated: Home → pure white → chat, on
  every push. Removed; the overlay's own opaque surface fading in over the
  visible Home is the M3 fade-through.
- **Tab layers cross-fade without the out-then-in gap.** The 100ms delay showed
  the always-mounted Home between the two fades.
- **The false start.** A debug build made with the repo's default
  `debuggableVariants = []` embeds the JS bundle and never talks to Metro; the
  debug network-security config also refused cleartext to `localhost`, so even
  the packager status check failed. Every "hot-reload" capture for two hours was
  of the JS baked into the APK. `scripts/dev-device.sh` builds the Metro-served
  variant explicitly (`-PmetroHotReload`); the default is unchanged and pinned by
  a test. Before trusting a device capture, check the APK has no
  `index.android.bundle` and that a visible probe edit actually shows up.
- **Still open:** ChatScreen takes ~500ms from tap to first paint (the entrance
  cannot start before that); the 150ms exit fade is as abrupt as Telegram's by
  design but should be judged by hand on device; `bubbleLaunch`/`bubbleArrive`
  `entering` animations in the chat may be affected by the same suppression and
  have not been frame-stepped.
