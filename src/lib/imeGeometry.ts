import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useStore as useZustandStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { TOKENS } from '../theme/tokens';

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
  insetBottom: number;
  winH: number;
}

export interface ImeGeometry extends ImeInputs {
  imeSpace: number;
  bodyInset: number;
  panelCeiling: number;
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
 * `bodyInset`: reserves room for whatever the NATIVE IME actually occupies —
 * gated on `keyboardUp` alone, not on `emojiPanelOpen`. `keyboardUp` is already
 * the real signal (`keyboardDidHide`, which fires only once the OS animation
 * finishes), so it does not need a second gate; adding one is what caused the
 * viewport jump below.
 *
 * **The bug this replaced (Amit, 2026-09-18, "clicking emoji reloads the chat
 * viewport"): `toggleEmoji` sets `emojiPanelOpen` SYNCHRONOUSLY on the tap, but
 * the real keyboard takes ~250-300ms longer to animate away — `keyboardUp`
 * does not flip to false until `keyboardDidHide` actually fires.** The old
 * formula, `keyboardUp && (!emojiPanelOpen || emojiSearching)`, zeroed
 * `bodyInset` (and so `listPad`) the INSTANT `emojiPanelOpen` flipped, while
 * the keyboard was still visibly on screen. The transcript's bottom padding
 * collapsed a quarter-second before the space it was padding against actually
 * emptied — on device, a visible reflow: a day divider that had been sitting
 * just off the bottom of the transcript, and the whole list content shifting,
 * both without the member touching anything.
 *
 * `keyboardUp` alone gives every case the right answer: keyboard up, panel
 * closed → imeSpace (unchanged). Panel just opened, keyboard still animating
 * out (`keyboardUp` still true because `keyboardDidHide` has not fired yet) →
 * STILL imeSpace, matching what is actually on screen, until the real event
 * says otherwise. Keyboard confirmed gone, panel open, not searching →
 * `keyboardUp` is false, so 0 — the panel fills that space itself, so the dock
 * must not also be lifted or the two would stack. Panel open AND searching
 * (the search field raises the keyboard again) → `keyboardUp` is true again on
 * its own, no `emojiSearching` branch needed. the reference app's arrangement, recorded
 * in `design/references/chat-app-mechanics.md`.
 *
 * `panelCeiling`: everything the header and the raised keyboard leave over. The
 * Composer subtracts its own input row, which it measures, because the row grows
 * with the draft and with font scale and only it knows how tall it currently is.
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
  const bodyInset = i.keyboardUp ? imeSpace : 0;
  const panelCeiling = Math.max(0, i.winH - i.barHeight - imeSpace);
  const listPad = TOKENS.space.md + bodyInset + i.dockHeight;
  const composerInset =
    i.keyboardUp || i.emojiPanelOpen ? 0 : i.insetBottom + TOKENS.space['2xs'];
  return { ...i, imeSpace, bodyInset, panelCeiling, listPad, composerInset };
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
const selectBarHeight = (g: ImeState): number => g.barHeight;
const selectComposerFocused = (g: ImeState): boolean => g.composerFocused;
const selectDockHeight = (g: ImeState): number => g.dockHeight;

export const useBodyInset = (): number => useZustandStore(useImeStore(), selectBodyInset);
export const useListPad = (): number => useZustandStore(useImeStore(), selectListPad);
export const useComposerInset = (): number =>
  useZustandStore(useImeStore(), selectComposerInset);
export const usePanelCeiling = (): number =>
  useZustandStore(useImeStore(), selectPanelCeiling);
export const useBarHeight = (): number => useZustandStore(useImeStore(), selectBarHeight);
export const useComposerFocused = (): boolean =>
  useZustandStore(useImeStore(), selectComposerFocused);
/**
 * The dock's own measured height alone, without `bodyInset` — for the one
 * caller (the transcript's static content padding) that needs to animate the
 * keyboard-lift portion separately from this structural one. See
 * `AnimatedBodyInset` in ChatScreen.tsx.
 */
export const useDockHeight = (): number => useZustandStore(useImeStore(), selectDockHeight);

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
