import {
  createImeStore,
  deriveImeGeometry,
  type ImeInputs,
} from '../src/lib/imeGeometry';
import { TOKENS } from '../src/theme/tokens';

/**
 * The 96px composer jump, as arithmetic rather than as a string match.
 *
 * `__tests__/contract.test.ts` has guarded this since the fix by grepping for
 * the expressions. That gate is worth keeping — it stops the code being moved
 * back inline — but a grep cannot tell you the numbers still come out equal.
 * These do.
 */
const BASE: ImeInputs = {
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

// The S22 Ultra measurement the fix was derived from: RN reported a 317dp
// keyboard while the IME window ran 332dp to the bottom of the screen, over a
// 15dp navigation bar.
const KEYBOARD = 317;
const NAV_BAR = 15;

describe('IME geometry', () => {
  it('gives the keyboard and the panel the same room, which is the 96px fix', () => {
    const up = deriveImeGeometry({
      ...BASE,
      keyboardUp: true,
      keyboardHeight: KEYBOARD,
      insetBottom: NAV_BAR,
    });
    const panel = deriveImeGeometry({
      ...BASE,
      emojiPanelOpen: true,
      keyboardHeight: KEYBOARD,
      insetBottom: NAV_BAR,
    });

    // The 19dp half: safe-area padding that existed in one state and was zeroed
    // in the other. Both states put the dock's own inset at the same number.
    expect(up.composerInset).toBe(panel.composerInset);
    expect(up.composerInset).toBe(0);

    // The 15dp half: the lift is the height the IME actually occupies, nav bar
    // included, not RN's shorter report.
    expect(up.imeSpace).toBe(KEYBOARD + NAV_BAR);
    expect(up.bodyInset).toBe(up.imeSpace);
  });

  it('keeps the dock lifted while the panel search field has the keyboard', () => {
    // The one state where both are up together. Closing the lift here would put
    // the expanded panel underneath the dock.
    const searching = deriveImeGeometry({
      ...BASE,
      keyboardUp: true,
      emojiPanelOpen: true,
      emojiSearching: true,
      keyboardHeight: KEYBOARD,
      insetBottom: NAV_BAR,
    });
    expect(searching.bodyInset).toBe(KEYBOARD + NAV_BAR);

    // Panel open WITHOUT search: the panel fills that space itself, so the dock
    // must not also be lifted or the two would stack.
    const panelOnly = deriveImeGeometry({
      ...BASE,
      keyboardUp: true,
      emojiPanelOpen: true,
      keyboardHeight: KEYBOARD,
      insetBottom: NAV_BAR,
    });
    expect(panelOnly.bodyInset).toBe(0);
  });

  it('pads the bottom only when the screen bottom is actually bare', () => {
    const bare = deriveImeGeometry({ ...BASE, insetBottom: NAV_BAR });
    expect(bare.composerInset).toBe(NAV_BAR + TOKENS.space['2xs']);
    expect(bare.bodyInset).toBe(0);
  });

  it('keeps a measured keyboard height across a hide, so the ceiling survives', () => {
    // `panelCeiling` sizes a panel that is open precisely when the keyboard is
    // not. If the height were zeroed on hide the ceiling would jump to the full
    // window and the panel would be sized against nothing.
    const store = createImeStore({ winH: 2340, insetBottom: NAV_BAR });
    store.getState().set({ barHeight: 200 });
    store.getState().set({ keyboardHeight: KEYBOARD, keyboardUp: true });
    const whileUp = store.getState().panelCeiling;

    store.getState().set({ keyboardUp: false });
    expect(store.getState().keyboardHeight).toBe(KEYBOARD);
    expect(store.getState().panelCeiling).toBe(whileUp);
  });

  it('does not notify when nothing actually changed', () => {
    // Every write lands on a subscriber list that re-renders leaf components. A
    // repeated `keyboardDidShow` with the same height is common on Android.
    const store = createImeStore({ keyboardHeight: KEYBOARD });
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.getState().set({ keyboardUp: true, keyboardHeight: KEYBOARD });
    expect(notifications).toBe(1);
    store.getState().set({ keyboardUp: true, keyboardHeight: KEYBOARD });
    expect(notifications).toBe(1);
    store.getState().set({ keyboardUp: false });
    expect(notifications).toBe(2);
  });

  it('never leaks a stale derived number back into the snapshot', () => {
    // `set` picks the inputs by name rather than spreading the snapshot, which
    // carries the five derived fields. A spread would work only by key order in
    // `deriveImeGeometry`'s return, and would break silently the day a sixth
    // derived field was added above it.
    const store = createImeStore({ keyboardHeight: KEYBOARD, insetBottom: NAV_BAR });
    store.getState().set({ keyboardUp: true });
    expect(store.getState().bodyInset).toBe(KEYBOARD + NAV_BAR);

    store.getState().set({ dockHeight: 120 });
    expect(store.getState().listPad).toBe(TOKENS.space.md + KEYBOARD + NAV_BAR + 120);
    expect(store.getState().bodyInset).toBe(KEYBOARD + NAV_BAR);
  });
});
