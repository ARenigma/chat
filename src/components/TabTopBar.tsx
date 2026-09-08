import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { searchIn, searchOut } from '../theme/motion';
import { useStore } from '../store/useStore';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { SearchBar } from './SearchBar';
import { TokenCounter } from './TokenCounter';
import { TourAnchor } from './TourAnchor';
import type { TourTargetId } from '../store/useHomeTour';

/**
 * The search field's side margin, in dp, and it is 7 rather than a token
 * because the reference measures 7.
 *
 * `contentView.addView(fragmentSearchField, LayoutHelper.createFrame(
 *    LayoutHelper.MATCH_PARENT, 48, Gravity.TOP, 7, -2, 7, 0))`
 * — DialogsActivity.java:5344 in the 12.10.1 tree. MATCH_PARENT width, 48dp
 * tall, 7dp either side.
 *
 * Named and commented rather than inlined because 7 looks like a mistake next
 * to a spacing scale of 4/8/12/16: the app's `space.xs` is 8 and `space.md` is
 * 16, and someone tidying this to either would move the magnifier off the mark.
 * The field's own 12dp glyph inset is what supplies the optical margin, so the
 * outer one is deliberately smaller than anything else on the screen — the two
 * together are the reference's 23dp from screen edge to glyph box.
 */
const SEARCH_ROW_SIDE_MARGIN = 7;

/**
 * The bar every top-level tab wears, and the reason it is one component.
 *
 * Amit, 2026-09-08: "home to fovourties o setting the top app bar remians
 * constant -- just chnage pappal to fav to settings but weight of fav and
 * setting should be regular not bold like brand", and, before that, the rule
 * this exists to keep: "the viewport must not shift when hopping beteen types
 * (listener to astro) or screens (home to favourite)". A second copy of these
 * paddings on another screen is how that shift comes back — one row that all
 * three tabs render is the only version of "constant" a diff can check.
 *
 * WhatsApp is the reference he named: one bar across Chats / Updates / Calls /
 * Settings, the screen's own name in it, the same trailing controls, and NO
 * back arrow, because a tab's first screen has nothing to go back to. A back
 * arrow appears only on a pushed screen.
 *
 * Search belongs to the SCREEN, not to this bar: WhatsApp's magnifier filters
 * whatever list you are looking at. So this owns the field, the crossfade and
 * the geometry, and the caller owns what the query means.
 */

interface Props {
  /** The screen's name. Rendered in the brand face only when `brand`. */
  title: string;
  /**
   * The wordmark treatment — Home only. Every other tab takes the regular
   * face at the same size, which is the weight difference Amit asked for.
   */
  brand?: boolean;
  /** True while the field is open in place of the title row. */
  searching: boolean;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** What this screen's search is over, e.g. "Search your favourites". */
  searchPlaceholder: string;
  /** Prefix for this instance's testIDs, e.g. `home` -> `home-search`. */
  testID: string;
  /**
   * Tour step to anchor on the wallet chip. Home only: the first-run tour
   * points at ONE wallet, and three anchors with the same id would leave the
   * spotlight measuring whichever tab mounted last.
   */
  walletTourId?: TourTargetId;
}

export function TabTopBar({
  title,
  brand = false,
  searching,
  onSearchOpen,
  onSearchClose,
  query,
  onQueryChange,
  searchPlaceholder,
  testID,
  walletTourId,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openWallet = useStore(s => s.openWallet);

  /*
   * No entering animation on the FIRST render, and this is a real defect and
   * not a nicety.
   *
   * Found on the device: on Favourites the bar rendered its wallet chip and
   * nothing else — no title, no magnifier — while Home, running this same
   * component, was fine. `TabLayer` (App.tsx) mounts a non-Home tab and holds
   * it at `opacity: 0`, which its animated style turns into
   * `display: 'none'`, until the tab is first activated. A Reanimated
   * `entering` animation on a subtree that mounts inside a `display: 'none'`
   * parent never runs, so the row stayed at FadeIn's starting opacity of 0 and
   * simply never faded in. Home mounts visible at cold start, so it never
   * showed the bug.
   *
   * The crossfade is only wanted when the row CHANGES state anyway: a bar
   * appearing with the screen should already be there. So the first render
   * gets no `entering`, and every render after it does.
   */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const enter = mounted.current ? searchIn : undefined;
  const exit = mounted.current ? searchOut : undefined;

  return (
    /*
     * One row, two states, crossfaded in place. Nothing slides, because the
     * field arrives in the row the icons were in.
     *
     * 350ms on EASE_OUT_QUINT, symmetric — `BoolAnimator animatorSearchVisible`
     * at DialogsActivity.java:307-308, the animator that carries the field and
     * the chrome around it. `searchIn` / `searchOut` in src/theme/motion.ts
     * hold the citation and the correction history (they ran 150ms with no
     * easing at all until 2026-09-07, read off ActionBarMenuItem.java, which is
     * the LEGACY action-bar search the dialogs list stopped using several
     * versions ago).
     */
    <View
      /*
       * `collapsable={false}`, and it is load-bearing on Android.
       *
       * Device-found on Favourites: this row rendered its wallet chip and
       * nothing else — no title, no magnifier — while Home, running the same
       * component, was fine. RN Android's view flattening
       * (NativeViewHierarchyOptimizer) folds away a View that draws nothing of
       * its own, and this row inside a `TabLayer` that mounts hidden and is
       * revealed later came back without its flattened children. The chip
       * survived because its fill makes it a real view. Proven by giving this
       * container a background in a throwaway build: everything painted.
       * https://reactnative.dev/docs/view#collapsable-android
       */
      collapsable={false}
      style={[styles.nav, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
      {searching ? (
        <Animated.View
          key="search-row"
          entering={enter}
          exiting={exit}
          style={styles.searchRow}>
          {/* NO arrow beside the field, and the field takes the whole row.
              Amit, 2026-09-07: "telegram search icon is on left edge of the bar
              and one cross to the right edge on the bar with full width bar --
              see clearly", and the source is unambiguous:
                contentView.addView(fragmentSearchField,
                  LayoutHelper.createFrame(MATCH_PARENT, 48, Gravity.TOP,
                                           7, -2, 7, 0));
              (DialogsActivity.java:5344) — MATCH_PARENT with 7dp side margins,
              no sibling. Leaving search is the hardware back button and the
              field's own trailing mark, which is the same `onExit` below. */}
          <SearchBar
            testID={`${testID}-search-input`}
            value={query}
            onChangeText={onQueryChange}
            placeholder={searchPlaceholder}
            onClear={() => onQueryChange('')}
            /* The trailing mark is the exit as well as the clear, which is what
               the reference's is: its handler clears what is clearable and
               otherwise runs `onCloseSearch`
               (FragmentSearchField.java:142-155). */
            onExit={onSearchClose}
          />
        </Animated.View>
      ) : (
        <Animated.View
          key="nav-row"
          entering={enter}
          exiting={exit}
          style={styles.navRow}>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMedium}
            allowFontScaling={!brand}
            numberOfLines={1}
            style={brand ? styles.wordmark : styles.title}>
            {title}
          </Text>
          <View style={styles.navTrailing}>
            <Pressable
              onPress={onSearchOpen}
              testID={`${testID}-search`}
              accessibilityLabel={searchPlaceholder}
              press="none"
              size={TOKENS.interaction.minTarget}
              /* Circle, matching the leave-search arrow this row used to hold. */
              shape="circle"
              style={styles.navIcon}>
              {/* 20, not 24 (Amit, 2026-09-07: "our search icon is too big").
                  Measured on the Redmi before changing it: at size 24 the
                  magnifier inked 66px at density 2.75 = exactly 24.00dp,
                  against the wallet glyph beside it at ~18dp. `size` is NOT the
                  rendered size: Icon.tsx multiplies by ICON_SCALE (1.2) and
                  Lucide inks 19.97 of its 24-unit grid, so 20 -> em round(24)
                  -> ink 19.97dp. */}
              <Icon name="search" size={TOKENS.icon.md} color={theme.color.text.secondary} />
            </Pressable>
            {walletTourId === undefined ? (
              <TokenCounter balance={balance} onPress={openWallet} />
            ) : (
              <TourAnchor id={walletTourId}>
                <TokenCounter balance={balance} onPress={openWallet} />
              </TourAnchor>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    nav: {
      // The bar owns its surface rather than borrowing the page's. Same colour,
      // so nothing changes visually — but a row that paints is a row Android
      // will not flatten, which is the other half of the fix above.
      backgroundColor: t.color.bg.base,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    // The one place TitanOne appears outside a logo file. Lowercase coral, per
    // v13. `numeralMedium` is unrelated — the wordmark carries its own size.
    wordmark: {
      fontFamily: TOKENS.face.wordmark,
      fontSize: 28,
      lineHeight: 34,
      color: t.color.bg.accent,
    },
    /*
     * Favourites and Settings: the SAME 28dp size in the regular face and the
     * page's own ink, so the bar's height and the title's baseline do not move
     * between tabs while the weight plainly does ("weight of fav and setting
     * should be regular not bold like brand"). `headlineMedium` is Geist
     * Regular at exactly 28dp, so this is a token role and not a second
     * hand-set size beside the wordmark's.
     */
    title: {
      ...TOKENS.typography.headlineMedium,
      color: t.color.text.primary,
    },
    navTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /*
     * A real 48dp box with the glyph centred in it, not a 28x40 box with slop.
     *
     * Both nav controls wear this style — the button that OPENS search and the
     * back arrow that leaves it — and both passed `size={28}`, which asks
     * Pressable for `max(8, ceil((48 - 28) / 2)) = 10` of `hitSlop`
     * (Pressable.tsx:231-234). Almost none of it survived: "The touch area never
     * extends past the parent view bounds"
     * (https://reactnative.dev/docs/view#hitslop), and the search glyph is the
     * FIRST child of a content-sized `navTrailing` row whose left edge is the
     * glyph box's own left edge, so the 10dp on that side is clipped to nothing
     * and the remaining 10dp on the other side falls in the 8dp gap the token
     * counter's own slop is already claiming. Effective box ~28-36 x 40 against
     * Android's floor: "we recommend that each interactive UI element have a
     * focusable area, or touch target size, of at least 48dp x 48dp"
     * (https://developer.android.com/guide/topics/ui/accessibility/apps).
     *
     * This is the same defect the search field's clear control had until
     * 2026-09-07 and it takes the same fix: one laid-out `interaction.minTarget`
     * box that no ancestor can shrink, with the glyph centred inside it. See the
     * GLYPH_SLOT header in src/components/SearchBar.tsx for the long version.
     * `size` is still passed, now as the same 48, so the Pressable and the style
     * agree rather than one of them silently deciding.
     *
     * It also makes the nav row 48dp tall in BOTH states — this box, or the
     * search field's own 48dp row — which the content swap below relies on; see
     * the note on `styles.swap`.
     */
    navIcon: {
      width: TOKENS.interaction.minTarget,
      height: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Both nav states occupy the same row so the crossfade has nothing to
    // reflow: the search field lands where the icons were.
    navRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TOKENS.space.xs,
    },
    /*
     * The search row is NOT `navRow`, and the difference is the point.
     *
     * `navRow` is `space-between` with a gap, which is right for the resting
     * chrome (wordmark, search, wallet) and wrong for search: it would hold the
     * field to its content width and centre it in the leftovers. The field has
     * to be the row.
     *
     * `SEARCH_ROW_SIDE_MARGIN` is the reference's own 7dp
     * (DialogsActivity.java:5344 `createFrame(MATCH_PARENT, 48, ..., 7, -2, 7,
     * 0)`) rather than the app's usual `space.md`. It is deliberately narrower
     * than every other margin on this screen, because the field's 12dp internal
     * glyph inset already supplies the optical inset — stacking 16dp on top of
     * that is exactly how the magnifier ended up 28dp from the screen edge
     * instead of 23.
     */
    searchRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      /*
       * NEGATIVE, and that is the point: this has to CANCEL the parent.
       *
       * `nav` above carries `paddingHorizontal: TOKENS.space.md` (16dp), which
       * is right for the resting chrome and wrong for search — it is a padding,
       * so a child cannot opt out of it, only pull back through it. Measured on
       * the Redmi before this line existed: the pill sat 26.9dp from each screen
       * edge, which is exactly 16 (nav) + 7 (this margin) + 4 (the pill's own
       * inset) and 16dp further in than the reference on both sides.
       *
       * The reference is 7dp of row margin over a 4dp pill inset — 11dp from
       * screen edge to pill (DialogsActivity.java:5344 `createFrame(
       * MATCH_PARENT, 48, Gravity.TOP, 7, -2, 7, 0)` and :3294
       * `setPadding(dp(4) x4)`). So the margin is `7 - 16 = -9`, written as the
       * subtraction rather than as `-9` so that changing either the nav padding
       * or the reference's 7 keeps this correct instead of silently drifting.
       */
      marginHorizontal: SEARCH_ROW_SIDE_MARGIN - TOKENS.space.md,
    },
  });
