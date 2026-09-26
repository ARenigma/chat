# ADR-0032, Navigation is react-navigation native-stack and bottom-tabs

Status: **decided (2026-09-25) — migration in progress on `nav/native-stack`**
Decision by: Amit Ranjan

Supersedes the hand-rolled layer stack in `App.tsx:567-575` and the route
definitions in `src/lib/routes.ts:12-15`.

Reference: Bluesky `social-app` at `f80c43e` — the structural pattern and the
ownership decisions are based on reading its navigator tree in full (RULE 3).

---

## 1. The decision

Replace the hand-rolled three-layer animation stack
(`PushedLayer` / `TabLayer` / `WalletLayer`) with:

- **`@react-navigation/bottom-tabs` 7.19.2** — one tab navigator per role
  (member / provider), two or three tabs each, custom `tabBar` prop
- **`@react-navigation/native-stack` 7.19.2** — one stack per tab; screens
  registered in every tab stack of that role (Bluesky's `commonScreens` pattern)
- **`@react-navigation/native` 7.4.1** — `NavigationContainer`, `useNavigation`,
  `useIsFocused`, `usePreventRemove`
- **`react-native-screens` 4.28.0** — native Fragment rendering on Android,
  required by native-stack

Nothing else is added. `@react-navigation/stack`, `eventemitter3`,
`drawer-layout`, `pager-view`, `edge-to-edge` and `patch-package` are
deliberately absent. No Bluesky screens or keyboard-controller patches are
ported (keyboard-controller 1.22.5 ships its own rules). No
`reactNavigationIntegration` for Sentry: route params carry peer UUIDs, and
breadcrumb scrubbing is per-field, not structural.

---

## 2. Scope rulings (structural; stated, not asked)

These have a correct answer published by the platform or the library. Each is
recorded here so a future agent does not re-open it without a new fact.

1. **No root native-stack.** The root is the bottom-tab navigator. Each tab is
   its own native stack. Every screen that can be pushed from any tab in a role
   is registered in every tab stack of that role (`memberScreens(Stack)` /
   `providerScreens(Stack)`).

2. **Boot phases stay outside the navigator.** Support gate, loading, signedOut,
   profileSetup, welcomePappal, policyGate, permissions and error are rendered
   by `Root` without any navigator. This is required by ADR-0016 and ADR-0026.

3. **`createNativeStackNavigatorWithAuth` is not ported.** Stock
   `createNativeStackNavigator` is used. Auth routing happens in the boot phases
   outside the navigator, matching `Root`'s existing machine.

4. **No `linking` prop.** `Root`'s `Linking` effect stays the only consumer of
   `getInitialURL` and `url` events. Notifications are routed imperatively
   through the intent queue.

5. **No hand-rolled JS screen transitions.** Deleted: `PushedLayer`, `TabLayer`,
   `WalletLayer`, `useScreenEnter`/`screenOut`, `navDirection`, `homeShift` /
   `revealHome`, `topLevelIn`/`topLevelOut`, the `transitioning` lock,
   `AfterPaint` deferrals, and the two hand-rolled full-screen overlays (the
   ChatRing layer and HomeSuggestionPrompt). These become routes or are removed.
   Kept under animate-expo: in-screen content motion (search, sheets, menus,
   press feedback, the bar pill, onboarding steps, Apply phases).

6. **Reduced motion.** Stacks use `animation: reduced ? 'fade' : 'default'`.
   This deviates from Bluesky (which uses a custom transition). The code cites
   the animate-expo SKILL.md `screen-transitions` table.

7. **Freeze stays off.** No `freezeOnBlur`, no `enableFreeze()`. Covered screens
   gate their own work with focus hooks.

8. **Platform rules kept.**

   - No portrait lock (`screenOrientation` not set; `configChanges` kept).
   - Tabs carry `accessibilityRole="tab"`, as Bluesky does
     (`BottomBar.tsx:195/241/278/321`).

9. **Chat hook lifetime parity.** A chat is _live_ only when its tab is focused
   and every route above it was an overlay (Wallet, ChatRequest). Hooks that
   died on unmount today die when the chat stops being live.

10. **A call owns the screen.** Every incoming-call source goes through one
    glare decision. Every other intent is held until the call ends. Transient UI
    is closed before a ring is shown.

11. **Bar — "port Bluesky's BottomBar, two deviations"** (press 0.90 over 100ms;
    the M3 pill kept). Consequences, stated in code:

    - Opaque surface with a hairline top border (no Frost)
    - Icon-only for both roles (provider labels go; a11y labels stay)
    - **No ripple**, which reverses the `theme.test.ts:3228-3240` pin
    - Badge per M3 `BadgedBox`
    - `icon.md` glyph (ADR-0030 ink scale)
    - Re-select scrolls to top, per M3 navigation-bar guidance

12. **One Chat per peer across the navigator.** Every `openChat` goes through
    `resolveOpenChat`. Every programmatic removal is dispatched with its own
    `source` and `target` (StackRouter acts on `state.index` otherwise).

13. **Intents belong to a session.** Each intent is tagged at enqueue time and
    dropped at flush if the session owner changed.

14. **animate-expo governs every motion.** Stated deviations:

    - No `NativeTabs` (Bluesky structure; owner chose standard bottom-tabs)
    - No `presentation:'modal'`/`'formSheet'` for Apply, Wallet or ChatRequest
      (Bluesky pushes; sheets stay RN Modals as Bluesky's own dialogs do)
    - Press 0.90, which exceeds animate-expo's 3% ceiling (owner decision)
    - Shell spring retuned below Bluesky's ~240ms

15. **Large screens** use the D3 default: bar surface stays full width; the slot
    row is constrained to `CONTENT_COLUMN_MAX`. A navigation rail is deferred;
    bottom-tabs v7 supports `tabBarPosition:'left'` with the same custom
    `tabBar`, so the cost is a later step.

---

## 3. Owner decisions (creative; resolved 2026-09-25)

These had a legitimate menu. The choices below are final.

- **D1 — tab-root title weight at 16.9sp:** SemiBold (`textLgSemiBoldTight`).
  Amit's earlier "regular not bold" applied to 24–28dp titles; at 16.9sp a
  SemiBold title no longer competes with the wordmark.

- **D2 — chat header layout:** End stays in the header
  (`ChatHeaderV2.tsx:264-273`). The provider earnings counter moves into the
  paid-session band. This keeps four 48dp targets on the S22 (384dp) without
  truncating the name.

- **D3 — ≥600dp navigation:** Bar surface stays full width; slot row constrained
  to `CONTENT_COLUMN_MAX`. Stated deviation from M3 (which recommends a rail at
  medium/expanded widths — [navigation-bar](https://m3.material.io/components/navigation-bar/guidelines),
  [navigation-rail](https://m3.material.io/components/navigation-rail/guidelines),
  [window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)).
  A rail costs little later because bottom-tabs v7 already supports
  `tabBarPosition:'left'`.

- **D4 — Bluesky Home header hide-on-scroll:** Not ported. Pappal's Home is a
  short directory with a ProviderTypeTabs filter, not an infinite feed. If
  Amit wants it, it becomes a later step with a scroll-derived shared value and
  a reduced-motion path.

**Veto list accepted** (applied by default on the D3 prototype, veto-able):
ripple removed from the bar, provider tab labels removed, Frost removed from
the bar surface.

---

## 4. Device plan

The S22 holds Play 10300 (1.3.0). A local build cannot install over a Play
build. **Plan (a) accepted:** uninstall Play 10300 from the S22 for the
duration of the migration. Reinstall from Play after step 8 lands. The S22
is the 120Hz reference device for the frame protocol.

Baselines (startup, feel, framestats, size:check) are recorded by the lead on
the local-build device before step 1 lands. This ADR does not include them;
they live in the step-0 baseline commit.

---

## 5. What does not change

- `GestureHandlerRootView`, `KeyboardProvider`, `BlurRootOrView`,
  `SafeAreaProvider`, `QueryClientProvider`, `ThemeProvider` — unchanged
- Boot phases: unchanged
- All `Linking` logic in `Root`
- `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`,
  `react-native-keyboard-controller`, `react-native-safe-area-context`,
  `@shopify/flash-list` — version unchanged
- No `linking` prop on `NavigationContainer`
- No `reactNavigationIntegration` for Sentry

---

## 6. Consequences

- Every `useNavigation` caller must be inside a `NavigationContainer`. The
  existing conditional renders stay outside the container by design.
- `usePreventRemove` replaces `useBackBarrier` and `backGuard.ts` at the route
  adapter boundary. `backGuard.ts` is deleted in step 8.
- Hardware-back detection relies on the fact that a source-less `GO_BACK`
  dispatch means the platform back button. Nothing else calls
  `navigationRef.goBack()` (pinned in `contract.test.ts`).
- Process death with a pushed stack requires `RNScreensFragmentFactory` in
  `MainActivity.onCreate` (before `super.onCreate`) and
  `-keepnames class com.swmansion.rnscreens.** extends androidx.fragment.app.Fragment`
  in ProGuard — both landed in the step-1 commit.
- The JS bundle grows by the react-navigation JS surface. `size-gate.mjs`
  BASELINE is updated to the measured value in the step-1 commit.
- The nav bar hairline and opaque surface replace Frost, which means
  `PappalBlurSurface` no longer wraps the bar. The bar's GPU layer is freed.
