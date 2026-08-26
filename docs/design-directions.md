# Design directions, three production-grade options

The brief: **lighter, more interactive, less serious, with character.** The current
theme is competent and cold, a monochrome grey system with one rose accent on a
strict five-use budget. It reads as restrained, which was right when the product
was an AI companion trying not to seem creepy, and is wrong now that the product
is "a real person will listen."

This document is the research, then three complete directions to choose between.
Each one specifies the whole system, colour, type, shape, motion, buttons, so
whichever is picked can be implemented without further design decisions.

---

## Part 1, What the research actually says

### Google's own data backs "less serious"

[Material 3 Expressive](https://design.google/library/expressive-material-design-google-research)
is the most-researched update Google has made to a design system: three years,
net-positive across all age groups, and **younger users showed the strongest
preference**. They scored designs against emotional attributes, _playful,
energetic, creative, friendly, positive vibe_. The mechanisms they landed on are
specific and worth copying:

- **Spring motion, not duration curves.** A motion-physics system in the theme.
- **Shape morphing.** Components change shape in response to input; a button is
  not a rigid rectangle that merely tints.
- **Richer palettes** and heavier rounding.

This matters because it converts "make it more fun" from taste into something
with evidence behind it.

### The restraint caveat, which cuts against overdoing it

Every 2026 motion round-up says the same thing: the shift is toward
_whisper-level_ feedback, a faint glow on long-press, not a confetti burst, and
**don't animate everything, because users tune out noise.** The performance bar
is concrete: anything slower than **100ms reads as lag**, and on 120Hz screens
janky 60fps is visible.

The other useful discipline: **define one signature interaction** that is
unmistakably yours. Tinder has the card fling. We should have exactly one, not
twelve.

### How the fluidity is actually achieved (the honest technical answer)

Fluid apps are not fluid because of prettier easing curves. They are fluid
because the animation never touches the JavaScript thread.

- **Reanimated** runs animation on the **UI thread via worklets**, so motion
  holds 60–120fps even when JS is busy. This is the whole ballgame.
- **Springs over durations.** `withSpring` responds to velocity and overshoot,
  so it feels answerable to the finger rather than played back at it.
  `Layout.springify()` does the same for layout changes.
- **Interruptibility.** A gesture-driven spring can be caught mid-flight. A
  timing animation cannot, which is what makes duration-based UI feel like a
  cutscene.
- **`useSharedValue` is state for motion; `useState` is state for logic.** Mixing
  them is what produces dropped frames.
- Builders should be hoisted out of components or memoised.

We already have Reanimated 4 and use it correctly in a few places (the inverted
transcript, the typing indicator, `FadeInDown` on rows). We are using perhaps a
fifth of it.

### One correction on the sources in the brief

**21st.dev, shadcn/ui, WatermelonUI and GSAP are all web libraries.** They are
React DOM + Tailwind + CSS/JS animation. None of their code can be dropped into
this app, React Native has no DOM, no CSS cascade, and GSAP has no supported RN
target. Their _ideas_ transfer completely; their implementations do not.

The React Native equivalents, which is what we would actually build on:

| Web thing in the brief                | React Native equivalent                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| shadcn/ui                             | [react-native-reusables](https://reactnativereusables.com/), the same copy-paste philosophy, Nativewind + a port of Radix primitives |
| GSAP timelines                        | Reanimated 4 (`withSpring`, `withSequence`, layout animations)                                                                       |
| Framer Motion's declarative `animate` | **Moti**, a Framer-Motion-style wrapper over Reanimated                                                                              |
| CSS filters / canvas tricks           | **Skia** (Shopify), GPU 2D canvas, shaders, blur                                                                                     |
| Lottie for designer motion            | Lottie, or **Rive** when the animation needs _state_                                                                                 |

Recommended stack if we go beyond what we have: **Reanimated (core) + Moti
(declarative micro-interactions) + Rive (one signature moment) **. Skia only if
we later need charts or real blur. Adding all four now would be gold-plating.

---

## Part 2, Fifteen apps, and what is worth stealing from each

Grouped by what they are actually good at rather than by category.

### Character without being childish

| App            | The move                                                                                                                  | Take it?                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Finch**      | A pet you care for _by_ caring for yourself. Character carried by one illustrated creature, not by the whole UI shouting. | **Yes, the principle.** One warm character element, everything else calm.          |
| **Duolingo**   | Mascot-led, heavy gamification, loud colour, streak pressure.                                                             | **The mascot idea, not the pressure.** Streaks and guilt are wrong for loneliness. |
| **Headspace**  | Warm illustration, generous whitespace, slow motion, orange. Calm _is_ the brand.                                         | **Yes**, the pacing and the warmth.                                                |
| **Clubhouse**  | Hand-drawn avatars and warm off-white made a social app feel like a living room.                                          | **Yes**, hand-drawn beats stock photography for human warmth.                      |
| **Marco Polo** | Video messaging that feels like a letter, not a broadcast. Soft, unhurried.                                               | The unhurried framing.                                                             |

### Fluidity as the product

| App                 | The move                                                                                              | Take it?                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Family (wallet)** | Famous for motion: everything springs, nothing cuts. Motion _is_ the differentiator.                  | **Yes**, spring-everything discipline.                                      |
| **Arc Search**      | Aggressive, confident motion on a browser. Proof that motion can carry a brand with almost no colour. | The confidence; not the aggression.                                         |
| **Copilot Money**   | "Delightful" finance, restrained palette, immaculate transitions, no gimmicks.                        | **Yes**, this is the closest tonal target for "less serious but not silly". |
| **Cash App**        | Huge type, flat bold colour, tactile number entry.                                                    | Big type for the one number that matters (tokens).                          |
| **Revolut / Monzo** | Fintech that earned character through colour and micro-copy while handling money.                     | Micro-copy tone.                                                            |

### Systems worth copying wholesale

| App / system     | The move                                                                         | Take it?                                                              |
| ---------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Linear**       | Dark, precise, fast. Motion is short and confident. Best-in-class _restraint_.   | Motion timing discipline.                                             |
| **Notion**       | Character entirely via illustration and copy on a neutral base.                  | **Yes**, cheapest way to get character.                               |
| **Airbnb (DLS)** | Warm neutral + one strong accent, and a real token pipeline.                     | **Yes**, the pipeline model, which we already have.                   |
| **Hinge**        | Human warmth in a dating app without sleaze: warm neutrals, real editorial type. | **Yes, carefully**, closest adjacent-risk product that stayed classy. |
| **Discord**      | Blurple, rounded everything, jokes in the loading strings. Character via voice.  | Voice and rounding; not the density.                                  |

### The three lessons that survive all fifteen

1. **Character comes from one or two elements, not from everything.** Finch has a
   bird. Notion has doodles. Duolingo has an owl. The rest of the UI is quiet.
2. **Warm neutral bases beat pure grey** for anything human. Grey reads clinical,
   which is precisely the word we are trying to avoid.
3. **Motion earns the "premium" read, colour earns the "fun" read.** Family is
   almost monochrome and feels alive; Duolingo is loud and feels fun. We need a
   deliberate mix, and it is cheaper to buy aliveness with motion than with hue.

---

## Part 3, The shared foundation (applies to whichever direction wins)

### Move the colour system to a 12-step semantic scale

This is the one non-negotiable upgrade. Our current tokens are hand-picked hexes
per mode, which already failed once: `text/secondary` shipped at **3.13:1** and
broke AA until a test caught it.

[Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
solves this properly, and the reason is structural, **the semantic contract lives
in the step number, not the hex**:

| Steps | Role                                                |
| ----- | --------------------------------------------------- |
| 1–2   | App background, subtle background                   |
| 3–5   | Component background, resting / hover / pressed     |
| 6–8   | Borders, subtle / interactive / strong + focus ring |
| 9–10  | Solid fills (9 is the highest-chroma step)          |
| 11–12 | Low-contrast text / high-contrast text              |

Steps 11 and 12 are **guaranteed** Lc 60 and Lc 90 APCA contrast on step 2 of the
same scale. Because the guarantee is perceptual, it survives dark-mode inversion,
which is exactly what our hand-tuned pairs did not.

Practically: `surface.raised → step 3` needs no per-mode override, and the
accessibility test we already have stops being a tripwire and becomes a formality.
We keep our generator; only the input scale changes.

### Motion tokens, replacing raw durations

Springs, not milliseconds. Four named springs cover everything:

```
spring.snap    damping 30  stiffness 400  mass 0.7 , taps, toggles, chips
spring.smooth  damping 26  stiffness 220  mass 1.0 , sheets, screens, layout
spring.bounce  damping 14  stiffness 260  mass 0.9 , the signature moment only
spring.breath  duration 4000  sine in-out          , the one non-spring: presence
```

Rules: nothing over **300ms** for feedback; **100ms** is the lag threshold; every
entering/exiting animation carries `.reduceMotion()`; builders hoisted to module
scope.

### What stays regardless

- The token pipeline (Figma → `tokens.json` → generated theme → drift gate).
- The accent-budget test. It has already forced two good arguments.
- No SVG in animated subtrees, that crash is documented and real.
- AAA on body text in both modes.

---

## Part 4, The three directions

### Direction A, "Warm Paper"

_Calm with character. A well-made paperback, not a clinic._

|               |                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Base**      | Warm off-white `sand.1/2`; cards `sand.3`. Never pure grey.                                                  |
| **Accent**    | Single **terracotta** `#C2543B` at step 9. Warm, human, non-romantic.                                        |
| **Support**   | One muted sage for positive states. Nothing else.                                                            |
| **Type**      | **Serif display** for headings (Instrument / Fraunces), sans for UI. The serif is where the character lives. |
| **Shape**     | Radii 12/16/20; pill buttons; hairline borders at step 6.                                                    |
| **Motion**    | `spring.smooth` everywhere; nothing bounces. Slow, certain.                                                  |
| **Signature** | Message bubbles settle with a soft weight, like paper landing.                                               |
| **Buttons**   | Filled step 9 primary, step 3 secondary with step 7 border, text tertiary. Press: scale 0.97 + step 4 tint.  |

**Reads as:** thoughtful, warm, adult, safe.
**Risk:** the _least_ different from today. May not feel "lighter" enough.
**Best if:** the priority is trust and Play-review safety.

---

### Direction B, "Soft Pop" ← my recommendation

_The direct answer to the brief. M3-Expressive logic, adult execution._

|               |                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base**      | Near-white `slate.1`, cards pure white, generous air.                                                                                                             |
| **Accent**    | **Three** small-dose accents: rose `#E45C7F` (primary action), citrus `#F2A93B` (tokens, energy), sky `#4A9DE0` (presence, info). High chroma, tiny surface area. |
| **Type**      | Big friendly sans (Plus Jakarta / Geist), heavy display weights, tabular numerals for the token count.                                                            |
| **Shape**     | **Heavy rounding**, radii 16/24/full. Chips everywhere. **Shape morphs on press** (radius animates), straight from M3 Expressive.                                 |
| **Motion**    | `spring.snap` for taps, `spring.bounce` for send. Squash-and-stretch on the send button.                                                                          |
| **Signature** | **Send**: the button squashes, the bubble launches with slight overshoot and settles. One moment, done extremely well.                                            |
| **Buttons**   | Primary rose fill, radius morphs 24→16 on press with scale 0.96; secondary white with step 6 border; chips are tappable pills that fill on select.                |

**Reads as:** modern, alive, friendly, unmistakably 2026.
**Risk:** playfulness in an intimacy-adjacent product can drift toward flirty.
**Mitigation:** accents on _actions and states only_, never on avatars, never on
message bubbles, never a heart or a spark anywhere.
**Best if:** the priority is retention and feeling current, which the brief says
it is.

---

### Direction C, "Quiet Neon"

_Dark-first, cool, precise. Linear or Arc, softened._

|               |                                                                            |
| ------------- | -------------------------------------------------------------------------- |
| **Base**      | Deep charcoal `#0C0C0D`, layered surfaces via elevation not borders.       |
| **Accent**    | One luminous **mint** `#5BE7B4`, used sparingly and brightly.              |
| **Type**      | Tight geometric sans, tabular numerals, generous letter-spacing on labels. |
| **Shape**     | Radii 10/14; crisp; subtle inner highlights.                               |
| **Motion**    | Fast, low-overshoot springs. Confident and short.                          |
| **Signature** | Presence: a soft luminous pulse when the other person is there.            |
| **Buttons**   | Mint fill with dark label; ghost buttons with a 1px step-7 border.         |

**Reads as:** premium, modern, cool, a little exclusive.
**Risk, and I would weigh this heavily:** dark + glow + one-to-one paid chat is
the visual signature of hookup and cam apps. This is the direction most likely to
cost us a Play review, and it fights ADR-0001's whole positioning.
**Best if:** we later decide the audience wants something that feels private and
premium, and we accept that review risk knowingly.

---

## Part 5, Recommendation

**Direction B, "Soft Pop", with two constraints from A.**

1. It is the only one that actually answers "lighter, interactive, less serious",
   and Google's own research says that preference is real and strongest among
   younger users.
2. Keep **A's warm base** rather than a cold white, warmth is what stops
   playfulness reading as juvenile, and stops the app reading as clinical.
3. Keep the **accent budget**, widened to three hues but with the same rule:
   actions and states only. That single rule is what separates "friendly" from
   "flirty", and it is the difference that matters for Play and for how the
   product feels to someone lonely at 2am.

**Not C.** The aesthetic is genuinely appealing and it is the wrong bet for a
product whose main existential risk is being mistaken for something else.

### What implementation would involve

| Step | Work                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 1    | Regenerate `tokens.json` on Radix 12-step scales, three accents, warm base |
| 2    | Add motion tokens (four springs) to the generator; replace raw durations   |
| 3    | Add Moti for declarative micro-interactions                                |
| 4    | Rebuild `Button` with radius-morph press states                            |
| 5    | Build the signature send interaction                                       |
| 6    | Update the accent-budget and contrast tests to the new scales              |
| 7    | Sweep the ten screens                                                      |

Roughly a day of focused work, gates green throughout. Nothing here touches the
schema, the safety model, or the auth flow.

---

## Part 6, What was actually chosen and built

None of the three, in the end. A fourth direction, **"Warm Signal"**, was
synthesised from nine references supplied afterwards (a Dribbble chat concept,
a Savee pin of Kretya's _Mengobrol_, and seven Pinterest boards including five
colour systems). It keeps Direction A's warm base and Direction B's energy, and
takes the structure from the references rather than from either.

### Where each part came from

| Source                                           | Taken                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| _Mengobrol_ (Kretya)                             | The structural spine: warm off-white page, **pure-white cards**, one accent, avatar rail with `+` first, floating pill action |
| Dribbble _Chat App Concept_ + its Pinterest twin | Counting display headline, search pill, dashed "add" ring, circular icon buttons, dense list under a hero                     |
| Yellow social pin                                | The inline coloured band that interrupts a list to ask one thing, now the rating prompt                                       |
| Urbanist pin                                     | The typeface, and "muted neutrals + a near-black that is not black"                                                           |
| WW/STUDIO _Coral_                                | The palette's bones, Paper / Stone / Coral / Ink                                                                              |
| MP069 + MP072                                    | Warm off-white over cool grey, deep warm ink instead of black, and publishing a contrast figure per swatch                    |
| FEST / Bolt                                      | Three-colour discipline, sand as the neutral                                                                                  |

### Deliberately not taken

- **The orange-on-black gradient.** The best-looking thing in the references and
  the wrong bet here: dark + warm glow + paid one-to-one chat is the visual
  signature of cam and hookup apps. The coral survives; the darkness does not.
- **Glass bubbles over a colour field.** They fail AA at body size, and Android
  blur in React Native is expensive for what it buys.
- **A four-tab bar and a stories rail.** Two destinations is one too few for a
  tab bar, and we are not a stories product, the rail carries _who is free now_,
  which is information rather than decoration.

### One correction to the sources

The contrast ratios printed on those colour-system boards do not reproduce.
"Toxic Orange 6.98:1" measures 5.16 against the same board's dark and 3.01
against white; "Aqua Mist 11.71" measures 8.63. Every pair in
`design/tokens.json` was therefore measured rather than copied, and the file
says so. One measurement is load-bearing: **white on coral `#F2543D` is 3.4:1**,
a fail, which is why the accent is two tokens, `bg.accent` for marks and
`bg.accentStrong` for anything under a label.

### The system

- **Colour**, warm paper 1–7, coral 3/9/10/11, sage (presence), citrus (tokens
  only), warm ink 11/12, garnet for danger. Danger is deliberately _not_ a red:
  a red beside a coral accent is two signals the eye cannot separate.
- **Type**, Urbanist (OFL), five static faces bundled from `assets/fonts`,
  mounted into the APK by Gradle. Every style names its own face and **nothing
  sets a `fontWeight`**, a concrete family plus a weight makes Android
  synthesise a weight the family already ships.
- **Motion**, four springs as physical triplets, with the perceptual damping
  ratio _derived_ by the generator so the prose cannot drift from the physics:
  `snap` 0.93, `smooth` 1.01 (critically damped), `bounce` 0.59 (the send, and
  nothing else), `gentle` 0.85. Press scales, radius-morph targets, stagger
  delays, decay and the gesture thresholds are all tokens too.
- **Physics**, Reanimated for the springs, `react-native-gesture-handler` for
  velocity. Moti and the other wrappers were skipped: they sit on top of
  Reanimated and would duplicate what a token-driven `springTo` already gives.

Everything above is enforced by tests rather than described: contrast per pair,
warmth per neutral, faces bundled, no raw duration or damping outside the theme,
`bounce` used in exactly one place, and reduce-motion honoured on every entrance.
