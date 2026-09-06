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
  headerHeight: 0,
  insetBottom: 0,
  winH: 0,
};

// The S22 Ultra measurement the fix was derived from: RN reported a 317dp
// keyboard while the IME window ran 332dp to the bottom of the screen, over a
// 15dp navigation bar.
const KEYBOARD = 317;
const NAV_BAR = 15;

/**
 * The Redmi Note 7 Pro in landscape, measured 2026-09-06 — the window the chat
 * screen could not fit into. 1080x2340 at density 2.75, so 851x393dp, and the
 * navigation bar moves to the RIGHT edge, which is why `insetBottom` is zero.
 */
const LAND = {
  winH: 393,
  header: 84, // status inset + the header row
  bar: 185, // header + talk strip (46) + "We have notified X" (55)
  keyboard: 204,
  row: 55, // the composer's input row
} as const;

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

  it('leaves the portrait window exactly as it was', () => {
    // The short-window work must be invisible above 480dp, which is where every
    // measured number in this file was taken. A tall window is never collapsed,
    // and its dock ceiling is far too large to bind against a panel the
    // `keyboardPanel` clamp already holds to 420dp.
    const portrait = deriveImeGeometry({
      ...BASE,
      keyboardUp: true,
      emojiPanelOpen: true,
      keyboardHeight: KEYBOARD,
      insetBottom: NAV_BAR,
      barHeight: 200,
      headerHeight: 90,
      winH: 851,
    });
    expect(portrait.shortWindow).toBe(false);
    expect(portrait.barCollapsed).toBe(false);
    // The bar's FULL height is what both ceilings subtract, header measurement
    // present or not.
    expect(portrait.panelCeiling).toBe(851 - 200 - (KEYBOARD + NAV_BAR));
    expect(portrait.dockCeiling).toBe(851 - 200);
    expect(portrait.dockCeiling - 55).toBeGreaterThan(420 + NAV_BAR);
  });

  it('treats an unmeasured window as tall, not as landscape', () => {
    // `winH` is 0 for the first frame of every screen, and 0 is below the 480dp
    // compact breakpoint. Without the guard the bar would collapse on mount.
    expect(deriveImeGeometry({ ...BASE, keyboardUp: true }).shortWindow).toBe(false);
    expect(deriveImeGeometry({ ...BASE, keyboardUp: true }).barCollapsed).toBe(false);
  });

  it('collapses the bar to its header row in a short window, and only while docked', () => {
    // https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
    // Compact height is < 480dp: any phone in landscape.
    const idle = deriveImeGeometry({
      ...BASE,
      winH: LAND.winH,
      barHeight: LAND.bar,
      headerHeight: LAND.header,
      keyboardHeight: LAND.keyboard,
    });
    expect(idle.shortWindow).toBe(true);
    // Nothing is docked, so all three rows stay and the bar keeps its height.
    expect(idle.barCollapsed).toBe(false);
    expect(idle.dockCeiling).toBe(LAND.winH - LAND.bar);

    for (const docked of [{ keyboardUp: true }, { emojiPanelOpen: true }]) {
      const g = deriveImeGeometry({
        ...BASE,
        ...docked,
        winH: LAND.winH,
        barHeight: LAND.bar,
        headerHeight: LAND.header,
        keyboardHeight: LAND.keyboard,
      });
      expect(g.barCollapsed).toBe(true);
      // The collapsed height is used at once, off the separate measurement,
      // rather than waiting a frame for the Frost's own onLayout to catch up.
      expect(g.dockCeiling).toBe(LAND.winH - LAND.header);
    }
  });

  it('leaves the landscape dock enough room that it cannot overflow upward', () => {
    // The defect: bar 185 + row 55 + panel 204 is 444dp of a 393dp window. The
    // dock is bottom-anchored, so the 51dp went off the TOP — the composer
    // landed behind the frosted bar, where it could not even be tapped.
    const before = LAND.bar + LAND.row + LAND.keyboard;
    expect(before).toBeGreaterThan(LAND.winH);

    const panelOpen = deriveImeGeometry({
      ...BASE,
      emojiPanelOpen: true,
      winH: LAND.winH,
      barHeight: LAND.bar,
      headerHeight: LAND.header,
      keyboardHeight: LAND.keyboard,
    });
    // What the Composer caps the panel with. Room for the panel AND the row.
    const panel = Math.min(LAND.keyboard, panelOpen.dockCeiling - LAND.row);
    expect(panel).toBe(LAND.keyboard);
    expect(LAND.header + LAND.row + panel).toBeLessThanOrEqual(LAND.winH);
  });

  it('gives expanded emoji search the whole ceiling in a short window', () => {
    // Searching is the one state with the keyboard AND the panel up. Docked, the
    // panel was `ceiling - row` = 4dp, and rendered as a 22px sliver with the
    // search field clipped out of it. Expanded it takes the ceiling itself,
    // because the row is out of layout for the duration.
    const searching = deriveImeGeometry({
      ...BASE,
      keyboardUp: true,
      emojiPanelOpen: true,
      emojiSearching: true,
      winH: LAND.winH,
      barHeight: LAND.bar,
      headerHeight: LAND.header,
      keyboardHeight: LAND.keyboard,
    });
    expect(searching.barCollapsed).toBe(true);
    expect(searching.panelCeiling).toBe(LAND.winH - LAND.header - LAND.keyboard);
    expect(searching.panelCeiling).toBe(105);
    // Docked would have been unusable; the uncollapsed bar makes it worse still.
    expect(searching.panelCeiling - LAND.row).toBe(50);
    expect(LAND.winH - LAND.bar - LAND.keyboard - LAND.row).toBe(-51);
    // And the dock is still lifted, so the panel is not under it.
    expect(searching.bodyInset).toBe(LAND.keyboard);
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
