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

## Docked emoji panel (measured 2026-09-04)

Behaviour observed and reimplemented clean-room; no source, assets or strings
were copied.

- The emoji panel is **not** a bottom sheet. It is docked in the composer,
  directly under the input row, and it occupies exactly the height the IME last
  reported. Because the two are the same height, swapping them moves nothing —
  the transcript, the composer and the send button all stay put, which is why it
  reads as the keyboard _changing_ rather than one surface replacing another.
- The measured height is remembered **per orientation**, because the first open
  happens while the keyboard is on its way down and so has nothing to measure at
  that moment; a landscape keyboard is a different height and reusing the
  portrait value is a visible jump.
- The panel mounts **before** the IME is dismissed. Dismiss-first drops the
  composer to the bottom of the screen for a frame and springs it back.
- Going the other way, the panel is taken down only once the IME has actually
  finished appearing, not when the button was tapped — otherwise there is a
  frame with neither surface up.
- The emoji button's glyph is a smiley while the keyboard is up and a keyboard
  while the panel is up: the control always names what the next tap produces.
- The panel carries its own backspace, in the corner, because it has replaced a
  keyboard that had one.

## Emoji search: the one state where panel and keyboard are up together (2026-09-04)

Read from `ChatActivityEnterView.java` and `EmojiView.java` for the anatomy;
reimplemented clean-room, no source, assets or strings copied.

- The panel's search field raises the ordinary IME, so for that one state the
  panel and the keyboard are up **at the same time**. Telegram models it as a
  distinct `searchingType` rather than as "keyboard up", which is what stops the
  usual keyboard-appeared-so-put-the-panel-away rule from firing.
  (`ChatActivityEnterView.java:12358` `onSearchOpenClose` → `setSearchingTypeInternal`.)
- Opening search **expands** the panel: `setStickersExpanded(true, …)` on the
  same callback. The expanded height is the container minus the status bar, the
  navigation bar, 6dp, the action bar and the composer's own height
  (`checkStickresExpandHeight`, `:13549-13560`) — i.e. everything between the
  header and the composer. The composer and the panel are then translated up
  together by `expanded − keyboardHeight` (`:13588-13594`), which puts the
  composer just under the header and the panel below it, with the keyboard
  covering the panel's lower edge.
- Without the expansion the results would render into a keyboard-sized window
  sitting on top of a keyboard-sized hole, which is what our first pass did.

**What we do differently, and why.** Our panel expands into the same space but
is not translated: the dock is lifted by the IME height and the panel is given
the remainder, which reaches the same geometry with one number instead of a
height plus a matching translation. The composer's row height is measured rather
than assumed, because ours grows with the draft.

**Android detail neither codebase can skip.** Dismissing the IME does not blur
the focused `TextInput` — not by system back, not by the IME's hide key, not by
`Keyboard.dismiss()`. The field has to be blurred explicitly on
`keyboardDidHide`, or "search is over" never fires and the panel stays at its
expanded size.

## Composer measured ON DEVICE, not read off the source (2026-09-04)

Telegram Android on the same Galaxy S22 Ultra this app is verified on
(1080x2316, density 2.8125), read with `uiautomator dump`. Source dp and what
the bar actually renders at have disagreed before, so these are the numbers to
match.

Keyboard up, IME frame `[0,1382][1080,2316]`:

| Element      | Bounds (px)             | dp                                 |
| ------------ | ----------------------- | ---------------------------------- |
| Emoji button | `[29,1232][153,1356]`   | 44 x 44, 10.3 from the left edge   |
| Text field   | `[161,1237][795,1351]`  | 40.5 tall, starts 57 from the left |
| Attach       | `[812,2124][936,2248]`  | 44 x 44                            |
| Mic          | `[936,2124][1060,2248]` | 44 x 44                            |

**The gap that was wrong here.** The composer's controls end at 1356 and the IME
begins at 1382: **26px, 9.2dp**. Idle, the same 26px sits between the controls
and the top of the navigation bar. Ours was 7px — the pill was very nearly
touching the keyboard. `row.paddingBottom` is now `xs` (8dp), which with the
button's own optical inset measures 24px against Telegram's 26px.

**Where we differ, by the owner's instruction.** Telegram's emoji button is
OUTSIDE the field, to its left, and the field starts at 57dp. Ours is the
capsule's first child, inside the pill on its leading edge ("EMOJI should be on
left corner of pill"). The side, the bottom gravity and the circular press disc
are Telegram's; the containment is not.

## Panel lifecycle (2026-09-04)

`createEmojiView()` builds the panel ONCE; every subsequent open is
`setVisibility(VISIBLE)` and every close is `setVisibility(GONE)`
(`ChatActivityEnterView.java:12622`, `:12746`). Nothing is rebuilt on a swap.
Ours unmounted the picker on close, so every keyboard-to-emoji tap reconstructed
a search field, ten tabs and a FlatList inside one frame — the artefact frame
visible on each swap. It is now mounted on first open and hidden with
`display: none` thereafter.

Animation, for when it is added: the panel translates by its own height over
`AdjustPanLayoutHelper.keyboardDuration` = **250ms** on `keyboardInterpolator`
(= `ChatListItemAnimator.DEFAULT_INTERPOLATOR`), started after a **50ms** delay,
and ONLY when the keyboard is not already visible — a swap with the keyboard up
is not animated at all, because the keyboard going down is the animation.
Search expansion is a separate **300ms** on `CubicBezierInterpolator.DEFAULT`
(0.25, 0.1, 0.25, 1).

## Attach surface (2026-09-04)

Read from `ChatAttachAlert.java` and `ChatAttachAlertPhotoLayout.java`.

**Grid, taken unchanged:**

| Fact              | Value                                                                   | Source                                  |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Grid padding      | `PADDING = 2` dp                                                        | `ChatAttachAlertPhotoLayout.java:3976`  |
| Cell gap          | `GAP = 2` dp                                                            | `:3977`                                 |
| Columns           | 3 portrait, 4 tablet or landscape                                       | `:3983-3990`                            |
| Cell size         | `(availableWidth - dp(PADDING*2) - dp(GAP*2)) / itemsPerRow`            | `:4000`                                 |
| Camera position   | grid cell **0**, a normal 1x1 cell with the live preview overlaid on it | `checkCameraViewPosition`, `:3019-3100` |
| Camera permission | requested on TAPPING the camera cell, not on opening the sheet          | `:920-926`                              |
| Attach button row | item width `availableWidth / min(4.5, itemCount)`; row 70dp             | `ChatAttachAlert.java:1520`, `:2906`    |

Note the cell-size expression subtracts exactly TWO gaps whatever the column
count is. That is what the reference does, so it is what we do; a "corrected"
version would not match on a landscape device.

**Sheet mechanics, recorded but NOT used** (ours is docked, see below): appear is
a `SpringAnimation` on `TRANSLATION_Y` with stiffness **350** and damping ratio
**0.75** (`ChatAttachAlert.java:5338-5346`), the scrim animates over **400ms**
with a **20ms** start delay (`:5352-5357`), and the sheet opens at
`availableHeight / 5 * 2` (`ChatAttachAlertPhotoLayout.java:4023`).

**Two deviations, both decided with the owner (2026-09-04):**

1. **Docked, not a sheet.** Telegram's attach surface is a tall bottom sheet that
   dismisses the IME. Ours sits in the emoji panel's slot at keyboard height,
   exclusive with it, so the viewport never moves and the keyboard is one tap
   away — the WhatsApp model.
2. **No photo grid.** Telegram reads the user's gallery from `MediaStore`, which
   needs `READ_MEDIA_IMAGES`. Google Play treats that as a restricted permission
   requiring a declaration, and a paid 1:1 chat app is the textbook rejection for
   it. So cell 0 is the live camera exactly as Telegram has it, and the rest of
   the row is one Photos tile opening Android's system photo picker, which needs
   no permission at all. `contract.test.ts` fails the build if any restricted
   media permission reaches the merged manifest.

**Achievability note.** The live preview is CameraX `PreviewView` in
`ImplementationMode.COMPATIBLE` (TextureView), because a SurfaceView cannot be
clipped to rounded corners or animated with the panel. On the API 36 arm64
emulator the emulated camera opens (`CameraDevice.onOpened()`) and PreviewView
supplies a surface, but `createCaptureSession` times out at 5000ms — while the
emulator's own camera app works. So the live tile is verified only up to session
configuration there and needs a physical device to confirm.

## Docked-panel travel (2026-09-04)

| Fact            | Value                                                                                                    | Source                             |
| --------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Duration        | **250ms** (`AdjustPanLayoutHelper.keyboardDuration`)                                                     | `AdjustPanLayoutHelper.java:42`    |
| Curve           | `CubicBezierInterpolator(0.19919472913616398, 0.010644531250000006, 0.27920937042459737, 0.91025390625)` | `ChatListItemAnimator.java:47`     |
| Animator start  | deferred **50ms**                                                                                        | `ChatActivityEnterView.java:12710` |
| Open            | `setTranslationY(currentHeight - previousHeight)` then animate to 0                                      | `:12700-12706`                     |
| Close           | animate `TRANSLATION_Y` to the panel's own height, then `GONE` in `onAnimationEnd`                       | `:12730-12746`                     |
| Animate at all? | ONLY when the keyboard is not already visible, and only when the height actually changed                 | `:12687`                           |

The last row is the one that is easy to miss and matters most. A swap made with
the keyboard up is not animated: the keyboard sliding away IS the movement, and a
second animation over it reads as a stutter. `previousHeight` also makes a
panel-to-panel swap a no-op, because the height does not change.

Both are now in `motion.ts` as `KEYBOARD_CUBIC`, `dockTo()` and `DOCK_DELAY_MS`,
and the curve and the 250ms are tokens (`m3.easing.keyboard`,
`m3.duration.medium1`) so they cannot drift.

**Deviation: we translate the DOCK, they translate the PANEL.** Telegram's chat
content is padded by `emojiPadding` and the padding is released in the animator's
end callback, so translating the panel alone is enough there. Our dock is
absolutely positioned and bottom-anchored, so the row's position comes from the
dock's HEIGHT — which changes the moment the panel is laid out or removed.
Translating only the panel made it slide while the row jumped. Offsetting the row
and the panel together by however much of the panel is still hidden reproduces
the same visual with one transform on one node and no layout work during the
travel; the offset is released in the same commit the panel stops being laid out,
so the two cancel and there is no snap.

**Android detail.** The offset has to be primed in the tap handler, not in an
effect. From an effect it lands one commit after the layout, and the panel
renders at full height with no offset for a single frame — visible as a flash
when stepped at 60fps, which is how it was found.
