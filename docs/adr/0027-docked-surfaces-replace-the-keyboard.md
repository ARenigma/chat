# ADR-0027, One docked slot with one number replaces KeyboardAvoidingView

Status: **SUPERSEDED on 2026-09-19 by the V2 chat shell**
Date: 2026-09-06
Superseded by: the V2 chat (`src/chat-v2`), device-verified on the S22 and
made the only chat on 2026-09-19 — see `docs/android-audit.md` › "V1 chat
deleted; V2 is the only chat".

> **Read this as history.** The decision below is about a docked slot that no
> longer exists. `src/lib/imeGeometry.ts`, `keyboardEngine.ts` and
> `keyboardPanel.ts` — the JavaScript model of the IME position everything
> here is computed in — were deleted with the V1 chat, along with the emoji
> and attach panels the slot was built to hold.
>
> What replaced it is the platform's own answer, which §4 below deferred:
> `react-native-keyboard-controller`'s `KeyboardStickyView` under a single
> measured dock, with `KeyboardGestureArea` around the pair. The lift is
> native and on the UI thread, so there is no remembered height to predict
> from and no second model to disagree with the first.
>
> **What survives and is still load-bearing:** `adjustNothing` in the
> manifest (pinned in `__tests__/platform.test.ts`), the root
> `KeyboardProvider`, and the rule the 96px measurement below taught — that
> RN's reported keyboard height excludes the navigation-bar inset under
> edge-to-edge, so anything sized from it alone is short by that inset. The
> measurements in §2 are kept for that reason.

---

## 1. The decision

The composer row and all panels that open below it — the emoji picker, the
attach panel — share a single `dockSpace` value. The row's bottom anchor does
not move. Panels fill the slot from the bottom; the IME fills the same slot
from the bottom. Because both fill the same number, swapping them does not
shift the row.

`KeyboardAvoidingView behavior="height"` is gone. It stacked a second resize
mechanism on top of `adjustResize` and shrank the body by RN's reported
keyboard height, which under edge-to-edge is 15dp short of the IME's actual
extent. The body is now lifted by exactly the space the IME occupies, computed
in `src/lib/imeGeometry.ts`.

## 2. The failure this fixes — measured numbers, not estimates

On the S22 Ultra (2026-09-04), the composer dropped **96px — exactly 34dp** on
every emoji-panel open and rose 34dp on every close. Two independent errors
summed to it:

- **19dp**: `composerInset` was zeroed on `emojiPanelOpen`, so the safe-area
  bottom padding present in the keyboard state vanished in the panel state.
  `imeGeometry.ts:150` now zeroes `composerInset` whenever something fills the
  space below the row (IME or panel), and restores `insetBottom + 2xs` only
  when the screen bottom is bare.

- **15dp**: the panel was sized from
  `keyboardDidShow.endCoordinates.height`, which under edge-to-edge **excludes
  the navigation-bar inset**. `dumpsys window` put the IME frame at
  `[0,1382][1080,2316]` (332dp), while RN reported 317dp — 15dp short.
  `imeGeometry.ts:145` computes `imeSpace = keyboardHeight + insetBottom`,
  which adds the inset back, and the panel is sized from `imeSpace` via
  `panelCeiling`. The arithmetic is in `src/lib/imeGeometry.ts` and is the
  source of truth; this ADR restates it to record the causal chain, not to
  duplicate it.

Reference: `developer.android.com/develop/ui/views/layout/edge-to-edge`

## 3. How the slot works

`Composer` renders `<ComposerRow /> <DockedSurface space={dockSpace} />` as
siblings inside the dock Frost. `dockSpace` is a Reanimated shared value with
three states:

| State     | Value                            |
| --------- | -------------------------------- |
| Idle      | `insets.bottom`                  |
| Composing | `keyboardHeight + insets.bottom` |
| Panel     | `panelHeight + insets.bottom`    |

Composing and panel resolve to the same number because `panelHeight` is sized
to `keyboardHeight` (the remembered IME height, persisted across a hide). The
row is therefore stationary on swap **by construction** — no animation, no
condition, no correction.

The panel paints `bg.raised` through the navigation-inset region, the same
region the IME covers, so the visual appearance on swap is a surface sliding
out and one sliding in, not a gap appearing.

## 4. What this removes from ChatScreen

The following are deleted:

- `keyboardUp` state and its Keyboard listeners — they re-rendered all 1858
  lines of ChatScreen on every IME event.
- `composerInset` as a prop threaded through to the dock — replaced by the
  `useComposerInset` selector from `imeGeometry.ts`, which only re-renders the
  one component that uses it.
- `KeyboardAvoidingView` — replaced by a plain `View`. The body lift is
  now the `bodyInset` selector from `imeGeometry.ts`.
- `paddingBottom` on the dock — replaced by the `composerInset` derived value.

The geometry contract is unit-tested on `deriveImeGeometry` directly; the
contract test asserts that `useBodyInset` has no call site inside ChatScreen.

## 5. Deferred decisions — triggers required before adopting

These are recorded here because the plan named them as "recorded in
ADR-0026", which shipped as the permissions gate. They have no other written
home in the repo.

### react-native-keyboard-controller

**ADOPTED 2026-09-19 — this deferral is closed, and the decision recorded
below was reversed.**

`react-native-keyboard-controller` is now a direct dependency and is what the
V2 chat's dock rides on: `KeyboardGestureArea` around the transcript-and-dock
pair, `KeyboardStickyView` under the dock and under the page-down control,
with the root `KeyboardProvider` in App.tsx. The lift is per-frame, native,
and on the UI thread. `dockTo()` and `DOCK_DELAY_MS` were deleted with the
panels they animated.

The trigger named below is roughly what happened, by a different route: the
dock stopped being stationary. The reasoning as written was sound for a
stationary dock and is kept for that reason.

_Original entry:_ Deferred. `dockTo()` in `motion.ts` predicts the IME rise
from the remembered height, matching Telegram's `smoothKeyboard` strategy,
with no additional dependency. `react-native-keyboard-controller@1.22.4`
offers per-frame IME position tracking, which this model does not use: the
dock is stationary, so there is nothing to track.

**Trigger to revisit:** transcript drag-to-dismiss (the gesture needs live IME
coordinates to couple the drag position to the hide animation), or a visible
lag of 200ms or more when the system back gesture dismisses the IME — which
would mean `keyboardDidHide` arrives too late for a no-jump close.

If adopted, it replaces only the `dockSpace` driver in `motion.ts`. Everything
in `imeGeometry.ts` is unaffected: it reads Keyboard events, not frame
positions, and the geometry arithmetic is independent of the source.

_That last prediction was wrong, and it is worth recording why._ Adoption did
not replace one driver and leave the arithmetic alone — it replaced the
arithmetic. `imeGeometry.ts`, `keyboardEngine.ts` and `keyboardPanel.ts` were
deleted outright on 2026-09-19, because once the IME position arrives per
frame from the platform there is nothing for a JavaScript model of it to
compute. A second model of a number the OS already reports is not a
complement to it; it is a second authority, which is the defect the whole V2
shell exists to remove.

### Moving Sheet off RN's Modal

Deferred. RN's `Modal` opens in its own `Activity` window, which carries its
own surface and its own refresh-rate vote. On the S22 at 120Hz this is
invisible in practice, but it is a structural risk: the Modal window's vote
runs independently of the main window's, and a new window in a sheet animation
is a plausible cause of a temporary mode drop.

**Trigger to adopt:** a Perfetto FrameTimeline trace shows the display
dropping from 120Hz while a Sheet Modal is open. Capture with
`scripts/perfetto-feel.sh` (VSYNC-app + FrameTimeline tracks), sheet open, a
30-second capture, then check the `DisplayEventReceiver` vsync period in the
trace. If it stays at 8.3ms throughout, the window boundary is not the
bottleneck and the migration is not justified.
