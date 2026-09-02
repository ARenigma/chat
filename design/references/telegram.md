# Telegram Android — measured reference (chat surface)

**Licence line, first.** Telegram Android is GPL-2.0 (`~/references/telegram/LICENSE`).
Copying its code, assets, icons, Lottie files or strings into Pappal would put
Pappal under the GPL. Measurements, timings, thresholds and interaction anatomy
are not copyrightable, so this file records THOSE — dp, ms, curves, behaviour —
each with the `File.java:line` it was read from, and the app re-implements them
in its own code. Nothing in this file is source. See ADR-0025 and CLAUDE.md
RULE 3. The clone lives outside the repo at `~/references/telegram` (shallow,
720 MB) and is never vendored.

Harvested 2026-09-02 from the `master` checkout. All paths are relative to
`TMessagesProj/src/main/java/org/telegram/`. Where Pappal differs, the
"Pappal / differs because" column says so; a blank means "adopt".

---

## Screen transitions — `ui/ActionBar/ActionBarLayout.java`

| Measured                                                                                                                         | file:line                      | Pappal / differs because                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| Push: incoming fragment `translationX = dp(48) * (1 - t)`                                                                        | `:1893`                        | `M3.distance.push = 48` (was 24)                                                   |
| Push: incoming fragment alpha 0 → 1                                                                                              | `:1877`                        | `screenIn` opacity                                                                 |
| Push duration **150 ms** (190 only for preview-open)                                                                             | `:1830`                        | `M3.duration.short3 = 150`; M3's medium2 (300) read sluggish on device             |
| Push interpolator `DecelerateInterpolator(1.5f)`                                                                                 | `:614`, `:1873`                | M3 emphasized-decelerate + `spatialDefault` spring (settles ~168 ms) — same family |
| **Pop is the same routine, same 150 ms, symmetric**                                                                              | `:1899-1907`, `:2670`          | `screenOut` mirrors `screenIn`                                                     |
| Old fragment dims under the incoming one: `argb(120*opacity)` clamped 0.8 → max ~38 % black                                      | `:1204-1206`                   | Not adopted: our overlay is opaque and fades in over Home; the dim is implicit     |
| Content first, THEN animate: `needDelayOpenAnimation()` → 200 ms; `resumeDelayedFragmentAnimation()` cuts it short when laid out | `:2280`, `:2295`, `:1919-1928` | `AfterPaint` OUTSIDE the animated overlay: content commits, then the entrance runs |
| Keyboard open → wait 250 ms (push) / 200 ms (pop) before animating                                                               | `:2270`, `:2676`               | Not yet; candidate for ChatScreen back with IME up                                 |
| Transition watchdog force-ends at 1500 ms                                                                                        | `:1746-1748`                   | —                                                                                  |
| Swipe-back commit: `x < width/3` or predictive `x < dp(56)/2 \|\| velX < -1000`                                                  | `:1489`                        | RN has no back-progress; system predictive back stands in                          |
| Frame loop clamps dt to 18 ms                                                                                                    | `:1824-1829`                   | Reanimated runs on the UI thread; n/a                                              |

## Bottom sheet — `ui/ActionBar/BottomSheet.java`

| Measured                                                                | file:line                | Pappal                                                                         |
| ----------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| **Dim alpha 51/255 ≈ 0.20**                                             | `:220-221`, `:1751`      | Ours 0.4 (`interaction.scrim`), a deliberate heavier dim; revisit against this |
| Open **400 ms**, `EASE_OUT_QUINT` (0.23, 1, 0.32, 1), 20 ms start delay | `:212-213`, `:1759-1763` | Ours: `spatialDefault` spring ~168 ms. Telegram is slower and softer on sheets |
| Dismiss 250 ms `EASE_OUT` / 200 ms `DEFAULT`                            | `:2046-2050`             | Ours: spring with finger velocity                                              |
| Drag-release settle `250 * (translationY / 0.8 cm)` ms                  | `:404-405`               | Ours: velocity-carrying spring                                                 |
| Dismiss travel = height + IME + dp(10) + nav inset                      | `:2033-2037`             | —                                                                              |

## Popup menu — `ui/ActionBar/ActionBarPopupWindow.java`

| Measured                                                                                      | file:line              | Pappal                                       |
| --------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------- |
| Show duration `150 + 16 * itemCount` ms                                                       | `:896`, `:965`         | `menuIn`: 100 ms fade + `spatialFast` scaleY |
| Scale origin top-right (pivotX = width, pivotY = 0); background scaleY 0 → 1 while items fade | `:847-848`, `:890-895` | `transformOrigin` top/bottom by anchor side  |
| Item cascade: translationY dp(-6) → 0, alpha 0 → 1, window 4                                  | `:875-886`             | Not adopted (menus are ≤ 4 items)            |
| Dismiss 150 ms; scaleOut → 0.8 + alpha 0                                                      | `:69`, `:1059-1068`    | `menuOut` 100 ms fade                        |
| Dim behind 0.2                                                                                | `:783-793`             | Ours 0.4 via token                           |

## OTP / code entry — `ui/CodeFieldContainer.java`, `ui/LoginActivity.java`

| Measured                                                                                              | file:line                                                    | Pappal                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Auto-submit on the last digit, synchronously, no Next tap, zero delay**                             | `CodeFieldContainer.java:239-241`                            | `CodeField.onComplete` fires at length; wired to `onVerify`          |
| Re-entrancy guard `nextPressed`                                                                       | `LoginActivity.java:4688-4698`                               | `canSubmit(state)`                                                   |
| Auto-focus next box; backspace on empty box steps back one                                            | `:235-238`, `:135-146`                                       | Single hidden input + painted segments; equivalent                   |
| Paste of full code splits across boxes from the focused index                                         | `:218-232`, `:283-299`                                       | Digits-only slice in `onChangeText`                                  |
| **Error shake: SpringAnimation, stiffness 600, amplitude 10 dp, no explicit damping**                 | `AndroidUtilities.java:3517-3543`, `LoginActivity.java:5030` | `shakeX` on `snap` (k=400): 9/7/4/0 hops. Close; ours settles softer |
| Error haptic `KEYBOARD_TAP` + `FLAG_IGNORE_GLOBAL_SETTING`                                            | `LoginActivity.java:6779`                                    | Add on `fail()`                                                      |
| After shake: 150 ms then refocus box 0; red state auto-clears after 3000 ms                           | `:5030-5043`, `:6793-6795`                                   | Add                                                                  |
| **Success: per-box fill staggered 75 ms × index; proceed at `length*75 + 400` ms (6 boxes → 850 ms)** | `:4999-5015`, `:6960-6976`                                   | Add: segments turn accent in sequence while verifying, spinner shows |
| Box springs: stiffness 400 no-bounce; success scale stiffness 500 low-bounce                          | `CodeNumberField.java:142-160`                               | `snap` (400) matches                                                 |
| Digit enter 220 ms / replace 350 ms `OvershootInterpolator(1.5)`                                      | `CodeNumberField.java:200`, `:216-219`                       | —                                                                    |
| Box 34×42 dp, gap 7; text 20 sp bold; stroke 1.5 dp, radius 4 dp                                      | `CodeFieldContainer.java:187-200`, `:172-176`, `:43`, `:70`  | Compare in Phase 6                                                   |
| SMS auto-retrieval fills and submits immediately                                                      | `LoginActivity.java:5149-5151`                               | `autoComplete="sms-otp"` + onComplete — same                         |
| Login spinner 20 dp, accent                                                                           | `LoginActivity.java:776-781`                                 | `LoadingIndicator size={20}` accent                                  |

## Progress indicators

| Measured                                                                              | file:line                                                    | Pappal                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `RadialProgressView`: **accent** `key_progressCircle`, 40 dp, stroke 3 dp, round caps | `RadialProgressView.java:63-71`                              | `LoadingIndicator` default accent; container disc tonal (`accentTint`), never grey |
| Rotation 2000 ms; sweep breathes 4° ↔ 270° over 500 ms each way                       | `:41-42`, `:134`, `:157-168`                                 | Native M3 indicator (its own timing)                                               |
| Grey is used ONLY in `WebviewActivity` (type 3 track `#b3b3b3`)                       | `ContextProgressView.java:40-52`, `WebviewActivity.java:202` | No grey spinners in Pappal                                                         |
| `CircularProgressDrawable` 18 dp, 2.25 dp, 5400 ms Material cycle                     | `CircularProgressDrawable.java:19-49`                        | —                                                                                  |

## Chat-list rows — `ui/Cells/DialogCell.java`

| Measured                                                                                         | file:line                                     | Pappal                                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| **Row height 70 dp (2-line), 76 dp (3-line)** + 1 px separator                                   | `:171-172`, `:1020`                           | `layout.rowTwoLine = 72` (M3). 2 dp apart; keep M3           |
| **Avatar 52 dp** (2-line) / 56 dp (3-line), left 11, top 9                                       | `:2467`, `:2444`, `:169`                      | Chats list uses 48; ProviderRow 40. Candidate: 52            |
| Text starts at 72 dp (11 + 52 + 9)                                                               | `:170`                                        | —                                                            |
| Name 17 sp bold; preview 16 sp; time 12 sp; counter text 13 sp                                   | `:1247-1255`, `Theme.java:7891-7894`, `:7791` | Phase 6 type: titleMedium 16 / bodyMedium 14 / labelSmall 11 |
| Unread badge height 20.67 dp, pad 6.33, min width 8                                              | `:1225-1227`                                  | Badge token compare                                          |
| **Online dot: r=5 dp green in r=7 dp ring (14 dp), centre at right−6 / bottom−8; appear 150 ms** | `:5068-5090`                                  | Avatar `online` dot — compare                                |
| Separator inset 72 dp                                                                            | `:4771-4788`                                  | Ours `md + 40 + sm = 68`                                     |

## Stories rail — `ui/Stories/DialogStoriesCell.java`

| Measured                                                   | file:line                       | Pappal                                                                                             |
| ---------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Expanded avatar 48 dp**, collapsed 26.33 dp              | `:1657`, `:141`                 | Home rail was 48 (= Telegram); Amit asked for bigger → trying 56 (Telegram's 3-line dialog avatar) |
| Item width 70 dp; name below 11 sp bold; rail height 81 dp | `:111`, `:1512`, `:118`         | Rail item width to check against 56                                                                |
| Story ring 2 dp unread / 1.3 dp read                       | `StoriesUtilities.java:769-816` | `railRing` +12 total — compare                                                                     |
| Expand `OvershootInterpolator(0.9)`                        | `:576`                          | —                                                                                                  |

## Composer — `ui/Components/ChatActivityEnterView.java`

| Measured                                                                                                    | file:line                                                        | Pappal (Phase 5)                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| **`DEFAULT_HEIGHT = 44`** bar and every button                                                              | `:6437`, `:2721`, `:2806`                                        | Buttons must be 48 (Android min, `minTarget`); pill 44 |
| **Text 18 dp; padding top 9 / bottom 10; max 6 lines; bottom gravity**                                      | `:5779`, `:5781`, `:5778`                                        | Adopt 18/9/10/6                                        |
| Edit text insets left 52 / right 50 (chat) / bottom 1.5                                                     | `:5790`                                                          | —                                                      |
| Send circle Ø 36 (height − 8), inset 4 from right/bottom                                                    | `:14900-14913`                                                   | Ours coral disc — compare                              |
| No `setLineSpacing`; `includeFontPadding(false)`, `fallbackLineSpacing(false)`                              | `:5771`, `:5750`                                                 | `includeFontPadding:false` in Phase 6                  |
| Bar growth 250 ms, cubic (0.199, 0.011, 0.279, 0.910); text offset animated too                             | `ChatActivity.java:7896-7940`, `ChatListItemAnimator.java:46-47` | Adopt for multi-line growth                            |
| **Send reveal: 220 ms `EASE_OUT_QUINT`, alpha 0→1, scale 0.1→1; mic crossfades out; attach shrinks 100 ms** | `:8217-8218`, `:10302-10319`, `:8117-8151`                       | SendButton — compare                                   |
| Reverse (non-empty → empty) 150 ms                                                                          | `:8634`                                                          | —                                                      |
| Compose shadow ≈ 1.5 dp asset                                                                               | `Theme.java:8317`                                                | —                                                      |

## Message bubbles — `ui/Cells/ChatMessageCell.java`, `ui/ActionBar/MessageDrawable.java`

| Measured                                                                               | file:line                                               | Pappal                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| **Corner radius 17 dp** (user default), near-corner 6, media 6                         | `SharedConfig.java:315`, `MessageDrawable.java:574-577` | Ours 18 tail-less — recorded choice             |
| Tail extends 8 dp past body (6 net), 83° arc                                           | `MessageDrawable.java:699-729`                          | No tail (product choice)                        |
| Text inset left 11 (out) / 17 (in); right 10 (+6 out); top 8; total height text + 19.5 | `ChatMessageCell.java:16622-16645`, `:7752`             | Ours 16/10 — compare                            |
| **Max width = screen − dp(80 + 42 if avatar)**                                         | `:7393-7395`                                            | Check Turn.tsx max width                        |
| **Text 16 dp default**; name/reply 14                                                  | `Theme.java:8029-8036`, `SharedConfig.java:313`         | Phase 6 bodyLarge 16/24                         |
| **Time 12 dp**; ticks 12×12; time at right−9 (in) / −38.5 (out)                        | `Theme.java:8402`, `:13798-13800`, `:8185`              | Ours BubbleTime 11 → labelSmall 11; consider 12 |
| Same-sender consecutive spacing ~4 dp tighter                                          | `:10942-10958`                                          | Compare Turn spacing                            |
| Group avatar beside incoming 42 dp, left 6, shift 48                                   | `:13833`, `:13884`                                      | n/a (1:1)                                       |

## Swipe-to-reply & reactions — `ui/ChatActivity.java`, `ui/Components/ReactionsContainerLayout.java`

| Measured                                                                                     | file:line                                     | Pappal                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------- |
| Drag 1:1, clamped at −80 dp, no rubber band                                                  | `ChatActivity.java:5018`                      | —                             |
| Start after 0.4 cm horizontal and `\|dx\|/3 > dy`                                            | `:5019`                                       | —                             |
| **Haptic `KEYBOARD_TAP` once at 50 dp; commit at 50 dp on release**                          | `:5033-5054`                                  | Adopt if swipe-reply is built |
| Snap-back 180 ms decelerate                                                                  | `:5223-5228`                                  | —                             |
| Reply icon springs: visibility k=1500 ζ=1; fill k=400 ζ=0.5; ring k=200 ζ=1                  | `:4651-4670`                                  | —                             |
| Reaction long-press = system long-press (500 ms), `LONG_PRESS` haptic                        | `ReactionsContainerLayout.java:2262`, `:2240` | Turn long-press — compare     |
| Reaction bubble appear 250 ms `OvershootInterpolator(0.5)`; item select 240 ms; enter 150 ms | `:1499-1503`, `:2009`, `:2197`                | ReactionStrip — compare       |

## Typing / online — `ui/Components/TypingDotsDrawable.java`

| Measured                                                           | file:line                          | Pappal                                      |
| ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------- |
| 3 dots, radius 1.33 dp rest → 2.33 peak, pitch 6 dp                | `:69-80`, `:124-126`               | `CallingDots` DOT 4 / PITCH 8 — compare     |
| Stagger 0/150/300 ms; 320 up + 320 down, period 800 ms, decelerate | `:28`, `:69-77`, `:99-101`         | `duration.breath 4200` is a different idiom |
| Header title 18, subtitle 14                                       | `ChatAvatarContainer.java:282-307` | —                                           |
| Online dot appear 150 ms                                           | `DialogCell.java:5082`             | —                                           |

## Haptics (counts in `ui/`: 167 `KEYBOARD_TAP`, 73 `LONG_PRESS`)

| Event                                                   | Constant                       | file:line                                                 |
| ------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| Wrong code / field error                                | `KEYBOARD_TAP` + ignore-global | `LoginActivity.java:6779`, `:1170`                        |
| Message long-press menu                                 | `LONG_PRESS`                   | `ChatActivity.java:32815`                                 |
| Swipe-reply threshold                                   | `KEYBOARD_TAP` + ignore-global | `ChatActivity.java:5033-5041`                             |
| Voice-record lock                                       | `KEYBOARD_TAP`                 | `ChatActivityEnterView.java:4630`                         |
| Send tap                                                | **none found**                 | — (negative result; ours `tick()` on send is a departure) |
| Validation errors (waveform) `APP_ERROR {30,10,150,10}` | custom                         | `BotWebViewVibrationEffect.java:9-18`                     |

## Interpolators — `ui/Components/CubicBezierInterpolator.java:11-22`

`DEFAULT (0.25,0.1,0.25,1)` · `EASE_OUT (0,0,0.58,1)` · `EASE_OUT_QUINT (0.23,1,0.32,1)` · `EASE_IN (0.42,0,1,1)` · `EASE_BOTH (0.42,0,0.58,1)` · `EASE_OUT_BACK (0.34,1.56,0.64,1)` · `EmphasizedDecelerate (0.05,0.7,0.1,1)` · `EmphasizedAccelerate (0.3,0,0.8,0.15)` · `StandardDecelerate (0,0,0,1)`. Telegram ships the M3 emphasized curves verbatim, which is why the M3 hybrid and the Telegram feel are not in tension.

## Not yet measured (follow-up)

Voice-note recorder (lock / slide-to-cancel / waveform cadence) · stickers and emoji panel · media viewer · profile and settings surfaces · pull-to-archive on the dialog list · `DialogsItemAnimator` (180 ms decelerate) as a model for our list add/remove.

## Negative results (looked for, not there)

`Theme.key_dialogProgressCircle` does not exist · no `preloadFragment` API (the pre-layout trick is `needDelayOpenAnimation`) · no `setLineSpacing` on the composer · no spring on reaction-bubble appear · no rubber-band on swipe-to-reply · no `SwipeRefreshLayout` anywhere.
