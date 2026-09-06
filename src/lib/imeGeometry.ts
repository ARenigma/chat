import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useStore as useZustandStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { TOKENS } from '../theme/tokens';
import { heightSizeClass } from './windowSize';

/**
 * Where the chat screen's IME geometry lives, and why it is not React state.
 *
 * ---------------------------------------------------------------------------
 * ONE number for the space under the composer row
 * ---------------------------------------------------------------------------
 * so the row cannot move when the keyboard and the emoji panel trade places.
 *
 * **The bug this replaces, measured (S22 Ultra, 2026-09-04).** The composer
 * dropped 96px — exactly 34dp — every time the panel opened, and rose 34dp
 * every time the keyboard came back. Two independent errors summed to it:
 *
 *  - 19dp: `composerInset` was zeroed on `emojiPanelOpen`, so the safe-area
 *    padding present in the keyboard state vanished in the panel state.
 *  - 15dp: the panel was sized from `keyboardDidShow.endCoordinates.height`,
 *    which under edge-to-edge EXCLUDES the navigation-bar inset, while the IME
 *    window runs to the bottom of the screen. `dumpsys window` put the IME
 *    frame at [0,1382][1080,2316] (332dp) while RN reported 317dp.
 *
 * `KeyboardAvoidingView behavior="height"` is gone with them. It stacked a
 * second resize mechanism on top of `adjustResize` and shrank the body by RN's
 * short number, so its lift could never agree with the panel's height. We lift
 * the body ourselves by the height the IME actually occupies, and the panel is
 * sized from `readKeyboardHeight` — see the divergence note below.
 * https://developer.android.com/develop/ui/views/layout/edge-to-edge
 *
 * ---------------------------------------------------------------------------
 * Why a store and not `useState` on the screen
 * ---------------------------------------------------------------------------
 * These numbers used to be six `useState`s in ChatScreen, so a keyboard show
 * re-rendered all 1858 lines of it — twice, because zeroing `composerInset`
 * changed the dock's height, which fired its `onLayout`, which set state again.
 *
 * The five expressions come out of ONE call on ONE input set, so they cannot
 * drift by a commit. That property is the whole point: before, `keyboardUp`
 * (screen state) and `emojiPanelOpen` (arriving through a Composer effect)
 * already landed in separate commits.
 *
 * The rule that makes it work, and it is load-bearing: **the owner holds the
 * handle, the leaves hold the subscriptions.** ChatScreen calls
 * `useChatImeStore()`, which subscribes to nothing. Only the four small leaf
 * components read a value. Call `useBodyInset()` from ChatScreen's own body and
 * the screen silently goes back to re-rendering on every keystroke of the IME —
 * which is why `__tests__/contract.test.ts` asserts it does not.
 *
 * Not `src/store/useStore.ts`: that is an app singleton whose values outlive the
 * screen and whose subscribers are spread across the whole tree. These are
 * measurements of ONE ChatScreen instance, and two instances briefly coexist
 * during a chat→chat pop, so the leaving screen's last `onLayout` would write
 * the arriving one's geometry.
 *
 * Not `useImeSpace()` either, which is a different question with a different
 * answer: it reports 0 the moment the IME hides, because a form only needs
 * padding while the keyboard is actually there. Here the last measured height
 * is deliberately STICKY and gated on `keyboardUp`, so `panelCeiling` — which
 * sizes a panel that is open precisely when the keyboard is not — stays a real
 * number across a show/hide cycle.
 *
 * ---------------------------------------------------------------------------
 * Short windows, and why the arithmetic alone could not save them
 * ---------------------------------------------------------------------------
 * Every number above is correct in landscape and the screen was still unusable,
 * because in a compact-height window there is genuinely no room to divide.
 *
 * **Measured, Redmi Note 7 Pro in landscape (2026-09-06).** Window 851×393dp;
 * the navigation bar moves to the RIGHT edge, so `insetBottom` is 0.
 *
 *   status inset + header row   84dp
 *   talk-time strip             46dp
 *   "We have notified X"        55dp
 *   composer row                55dp
 *   IME (`keyboardDidShow`)    204dp
 *   ------------------------------- window 393dp
 *
 * Header + strip + IME + row is 389dp, so the transcript was already zero. Add
 * the notified banner and the total is 444dp: the dock is bottom-anchored, so it
 * overflowed UPWARD and `composer-input` landed at y=257 under a frost bar
 * ending at y=357 — not merely clipped, but unable to take a tap, because the
 * frost took it instead. With the panel's search field focused `panelCeiling`
 * came to 4dp and the panel rendered as a 22px sliver: the field being typed
 * into was itself clipped away.
 *
 * Two rules govern it and neither is optional:
 * https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability
 *   "Enable app layouts to scroll to verify all content is reachable regardless
 *    of the height of the display."
 * https://developer.android.com/develop/ui/compose/layouts/adaptive/adaptive-dos-and-donts
 *   "Change UI components as the window size changes."
 * Restricting orientation to dodge it is the one thing the same pages forbid,
 * and ADR-0017 already decided we do not.
 *
 * So two derived booleans, on the published 480dp compact-height breakpoint
 * (`windowSize.ts`, itself from `use-window-size-classes`):
 *
 *  - `barCollapsed` — in a short window, while the keyboard or a docked panel is
 *    up, the frosted bar carries the header row ONLY. The talk strip, the
 *    notified line and the extend card stand down for the duration. 185dp → 84dp
 *    (Amit's call, 2026-09-06, over folding them into the header row or letting
 *    them scroll away with the transcript; the countdown is not persistent while
 *    someone is typing, and that is the accepted cost).
 *  - `dockCeiling` — what the bar leaves for the dock with no keyboard up, so
 *    the panel can be capped and the overflow becomes impossible rather than
 *    merely absent. It does not bind in portrait: 851 − 185 − 55 is 611dp
 *    against a panel the `keyboardPanel` clamp already holds to 420dp.
 *
 * `barSpace` prefers the separately measured `headerHeight` the instant the bar
 * collapses, rather than waiting for the Frost's own `onLayout` to report the
 * new number. Without it the panel opens one frame short — capped against a bar
 * that is on its way out — and pops to full height on the next.
 */
export interface ImeInputs {
  /** The IME is up. Not the same as "has a height": the height is sticky. */
  keyboardUp: boolean;
  /** Raw `endCoordinates.height`, kept across a hide. */
  keyboardHeight: number;
  emojiPanelOpen: boolean;
  /** The panel's own search field has focus, so panel AND IME are up together. */
  emojiSearching: boolean;
  composerFocused: boolean;
  /** The dock's measured height while collapsed. Not updated while searching. */
  dockHeight: number;
  /** The frosted top bar's measured height. */
  barHeight: number;
  /**
   * What the bar measures with the header row alone — status inset included, so
   * it is comparable with `barHeight`. Measured always, used only while
   * `barCollapsed`, so the collapse costs no frame. See the header note.
   */
  headerHeight: number;
  insetBottom: number;
  winH: number;
}

export interface ImeGeometry extends ImeInputs {
  imeSpace: number;
  bodyInset: number;
  /** The window is compact-height (< 480dp): a phone in landscape. */
  shortWindow: boolean;
  /** Short window, and something is docked: the bar keeps the header row only. */
  barCollapsed: boolean;
  panelCeiling: number;
  /** What the bar leaves for the dock with no keyboard up. */
  dockCeiling: number;
  listPad: number;
  composerInset: number;
}

const INPUT_KEYS = [
  'keyboardUp',
  'keyboardHeight',
  'emojiPanelOpen',
  'emojiSearching',
  'composerFocused',
  'dockHeight',
  'barHeight',
  'headerHeight',
  'insetBottom',
  'winH',
] as const;

const DEFAULTS: ImeInputs = {
  keyboardUp: false,
  keyboardHeight: 0,
  emojiPanelOpen: false,
  emojiSearching: false,
  composerFocused: false,
  dockHeight: 0,
  barHeight: 0,
  headerHeight: 0,
  insetBottom: 0,
  winH: 0,
};

/** The inputs alone, picked by name — see `set` for why this is not a spread. */
function inputsOf(g: ImeInputs): ImeInputs {
  const out = {} as ImeInputs;
  for (const key of INPUT_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[key] = g[key];
  }
  return out;
}

/**
 * The five numbers, from one input set, in one place.
 *
 * `bodyInset`: the keyboard and the panel are mutually exclusive EXCEPT while
 * the panel's own search field has focus, when both are up — the dock is lifted
 * above the keyboard and the panel expands into what is left. Telegram's
 * arrangement, recorded in `design/references/telegram.md`.
 *
 * `panelCeiling`: everything the header and the raised keyboard leave over. The
 * Composer subtracts its own input row, which it measures, because the row grows
 * with the draft and with font scale and only it knows how tall it currently is.
 *
 * `dockCeiling`: the same question with no keyboard up — everything the bar
 * leaves. It is what stops the panel overflowing a short window; see the header.
 *
 * `listPad`: how far the transcript is padded clear of the dock. The COLLAPSED
 * dock only — the search expansion overlays the chat rather than pushing it, so
 * growing this with it would scroll the conversation away.
 *
 * `composerInset`: the dock's own bottom padding. Zero whenever something is
 * filling the space below it — the IME covers the navigation bar, and so does
 * the panel — and the safe-area inset only when the screen bottom is bare.
 */
export function deriveImeGeometry(i: ImeInputs): ImeGeometry {
  const imeSpace = i.keyboardHeight + i.insetBottom;
  const bodyInset = i.keyboardUp && (!i.emojiPanelOpen || i.emojiSearching) ? imeSpace : 0;
  /*
   * `winH > 0` is not defensive noise: an unmeasured window is 0, and 0 is
   * compact, so without it every screen would spend its first frame believing it
   * was in landscape and collapse the bar.
   */
  const shortWindow = i.winH > 0 && heightSizeClass(i.winH) === 'compact';
  const barCollapsed = shortWindow && (i.keyboardUp || i.emojiPanelOpen);
  const barSpace =
    barCollapsed && i.headerHeight > 0 ? i.headerHeight : i.barHeight;
  const panelCeiling = Math.max(0, i.winH - barSpace - imeSpace);
  const dockCeiling = Math.max(0, i.winH - barSpace);
  const listPad = TOKENS.space.md + bodyInset + i.dockHeight;
  const composerInset =
    i.keyboardUp || i.emojiPanelOpen ? 0 : i.insetBottom + TOKENS.space['2xs'];
  return {
    ...i,
    imeSpace,
    bodyInset,
    shortWindow,
    barCollapsed,
    panelCeiling,
    dockCeiling,
    listPad,
    composerInset,
  };
}

export interface ImeState extends ImeGeometry {
  set: (patch: Partial<ImeInputs>) => void;
}

export type ImeStore = StoreApi<ImeState>;

export function createImeStore(seed: Partial<ImeInputs> = {}): ImeStore {
  return createStore<ImeState>()((set, get) => ({
    ...deriveImeGeometry({ ...DEFAULTS, ...seed }),
    set: patch => {
      /*
       * The inputs are PICKED by name rather than spread off the snapshot. A
       * spread would carry the five derived fields too, and they would survive
       * into `deriveImeGeometry`'s own `{ ...i, imeSpace, ... }` only because
       * the fresh ones happen to be listed after it. Add a sixth derived field
       * above that spread and stale numbers would leak in silently — which is
       * exactly the drift this module exists to make impossible.
       */
      const current = inputsOf(get());
      const next = { ...current, ...patch };
      if (INPUT_KEYS.every(key => next[key] === current[key])) {
        return;
      }
      set(deriveImeGeometry(next));
    },
  }));
}

/*
 * A module-level default so a Composer rendered outside the provider still gets
 * a number rather than a crash. It is NOT a mitigation: an unwritten store
 * yields `panelCeiling = 0`, which collapses the emoji panel while search has
 * focus. It matches the old `panelCeiling = 0` prop default exactly, so it is
 * not a regression — the real protection is the contract assertion that the
 * Composer has exactly one call site.
 */
const ImeContext = createContext<ImeStore>(createImeStore());
export const ImeGeometryProvider = ImeContext.Provider;

/** The handle. Subscribes to NOTHING — see the rule in this file's header. */
export function useImeStore(): ImeStore {
  return useContext(ImeContext);
}

/*
 * Selectors are module-scope constants because zustand v5 memoises the snapshot
 * on `[api, selector]`; an inline arrow would be a new selector every render and
 * defeat it. Each returns a primitive, so `Object.is` bails out of every notify
 * that did not change that particular field.
 */
const selectBodyInset = (g: ImeState): number => g.bodyInset;
const selectListPad = (g: ImeState): number => g.listPad;
const selectComposerInset = (g: ImeState): number => g.composerInset;
const selectPanelCeiling = (g: ImeState): number => g.panelCeiling;
const selectDockCeiling = (g: ImeState): number => g.dockCeiling;
const selectBarHeight = (g: ImeState): number => g.barHeight;
const selectComposerFocused = (g: ImeState): boolean => g.composerFocused;
const selectShortWindow = (g: ImeState): boolean => g.shortWindow;
const selectBarCollapsed = (g: ImeState): boolean => g.barCollapsed;

export const useBodyInset = (): number => useZustandStore(useImeStore(), selectBodyInset);
export const useListPad = (): number => useZustandStore(useImeStore(), selectListPad);
export const useComposerInset = (): number =>
  useZustandStore(useImeStore(), selectComposerInset);
export const usePanelCeiling = (): number =>
  useZustandStore(useImeStore(), selectPanelCeiling);
export const useDockCeiling = (): number =>
  useZustandStore(useImeStore(), selectDockCeiling);
export const useBarHeight = (): number => useZustandStore(useImeStore(), selectBarHeight);
export const useComposerFocused = (): boolean =>
  useZustandStore(useImeStore(), selectComposerFocused);
export const useShortWindow = (): boolean =>
  useZustandStore(useImeStore(), selectShortWindow);
export const useBarCollapsed = (): boolean =>
  useZustandStore(useImeStore(), selectBarCollapsed);

/**
 * The screen's own store, created once and fed by the Keyboard listeners.
 *
 * `useLayoutEffect`, not `useEffect`, for the window sync. Under Fabric a layout
 * effect runs inside the commit, so the follow-up render lands in the same
 * frame. With a passive effect, a rotation would paint one frame with the old
 * `insetBottom` in `composerInset` and the old `winH` in `panelCeiling` while
 * Composer had already recomputed its own `panelHeight` for the new
 * orientation — the panel would collapse for a frame and snap back. That is
 * composer movement on a geometry swap, which is the failure this file's header
 * is about.
 */
export function useChatImeStore({
  insetBottom,
  winH,
  seedKeyboardHeight,
}: {
  insetBottom: number;
  winH: number;
  /**
   * The remembered keyboard height, so the very first show has something to
   * lift by on the same frame. Passed in rather than read here: this module is
   * pure geometry, and `readKeyboardHeight` reaches MMKV — which would drag
   * native storage into every unit test of the arithmetic.
   */
  seedKeyboardHeight: number;
}): ImeStore {
  const [store] = useState(() =>
    createImeStore({ keyboardHeight: seedKeyboardHeight, insetBottom, winH }),
  );

  useLayoutEffect(() => {
    store.getState().set({ insetBottom, winH });
  }, [store, insetBottom, winH]);

  // `Will` rather than `Did` on iOS: the padding has to change on the same frame
  // the keyboard starts moving, or the composer visibly jumps 34pt at the end of
  // the animation. Android only emits the `Did` pair.
  // https://reactnative.dev/docs/keyboard
  useLayoutEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      e => {
        store.getState().set({ keyboardHeight: e.endCoordinates.height, keyboardUp: true });
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        store.getState().set({ keyboardUp: false });
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [store]);

  return store;
}
