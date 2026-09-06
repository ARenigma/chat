import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onTransitionSettled } from '../theme/motion';
import {
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  EMOJI_BY_CATEGORY,
  EMOJI_CATEGORIES,
  TONES,
  TONE_SWATCHES,
  emojiForNative,
  searchEmoji,
  withTone,
  type Emoji,
  type EmojiCategoryId,
} from '../lib/emoji';
import { pushRecent, readRecents, readTone, writeTone } from '../lib/emojiRecents';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { TextField } from './TextField';

/**
 * Columns in the grid. Eight is what a 393dp phone fits at a comfortable 44dp
 * target — the same count every system keyboard uses at this width.
 */
const COLUMNS = 8;

/**
 * The grid's horizontal padding. Telegram's emoji grid uses 5dp either side
 * (`EmojiView.java:1751`); eight columns then divide the rest of the width
 * exactly, with no dead strip at the edge.
 */
const GRID_PAD = 5;

/**
 * The floating backspace: 48dp square, 2dp from the grid's bottom-right corner.
 * Telegram's anatomy (`EmojiView.java:2675-2679`) — it floats OVER the grid
 * rather than sitting in the search row, so the search row's trailing control is
 * free to mean "close the search", which is what it means in every search field.
 */
const BACKSPACE = 48;

interface Props {
  visible: boolean;
  /**
   * The keyboard's exact height while browsing, so the swap moves nothing; the
   * space between the header and the raised keyboard while searching. The parent
   * picks which, this only renders into it.
   */
  height: number;
  /**
   * Fired when the search field takes or loses the keyboard. The panel and the
   * IME are up together in that state, which the dock has to know about.
   */
  onSearchFocusChange?: (focused: boolean) => void;
  /** Backspace, because the panel replaces a keyboard that had one. */
  onBackspace: () => void;
  /** The already-toned string, ready to append to the draft. */
  onPick: (emoji: string) => void;
}

/** One grid cell. Memoised because the grid re-renders on every tone change. */
const Cell = memo(function CellView({
  char,
  size,
  onPick,
  onHold,
}: {
  char: string;
  size: number;
  onPick: (char: string) => void;
  onHold?: (char: string) => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={() => onPick(char)}
      onLongPress={onHold === undefined ? undefined : () => onHold(char)}
      accessibilityLabel={char}
      press="none"
      highlight="dim"
      style={[styles.cell, { width: size, height: size }]}>
      <Text allowFontScaling={false} style={styles.glyph}>
        {char}
      </Text>
    </Pressable>
  );
});

/**
 * The in-app emoji picker.
 *
 * The system keyboard already has emoji, so this exists to be *better than* that
 * for the one thing a chat needs: getting back to the handful you actually use.
 * Hence Recent first and persisted, and hence search — a keyboard's emoji pane
 * has no search on Android.
 *
 * Presented in the app's own `Sheet`.
 *
 * `@gorhom/bottom-sheet` was tried first and removed (Amit, 2026-09-04). It is
 * the obvious library for this and it does not work on this stack: on Reanimated
 * 4.6 the sheet mounts and LAYS OUT correctly — its nodes report the right bounds
 * in the accessibility tree — and then never paints, so the transcript shows
 * straight through where the picker should be. Verified on a Galaxy S22 with
 * `enableDynamicSizing={false}` (the snapPoints override) already ruled out; it
 * matches the library's open reports of silently failing under Reanimated 4.
 * Exactly the failure class RULE 5 exists for, so it went back out again.
 */
function EmojiPickerView({
  visible,
  height,
  onBackspace,
  onPick,
  onSearchFocusChange,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [category, setCategory] = useState<EmojiCategoryId>('recent');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<readonly string[]>(() => readRecents());
  const [tone, setTone] = useState<string>(() => readTone());
  // Which emoji's tone strip is open, or null. One at a time.
  const [toning, setToning] = useState<string | null>(null);
  const searchRef = useRef<TextInput>(null);
  /** Whether the search field holds the focus, so the X can mean "close it". */
  const [searchOpen, setSearchOpen] = useState(false);

  // W5#6: defer the heavy FlatList/tabs/search mount until after the push
  // transition settles. EmojiPicker is kept mounted-but-hidden (display:none)
  // from first open; without this gate its ~1,800 cells would mount on the same
  // frame as the entering screen, competing for frame budget. Once `visible`
  // becomes true the user has already opened the picker, so we show content
  // regardless — user interaction always wins over the pre-warm gate.
  // `requestIdleCallback` is the unconditional fallback: if setTransitioning(false)
  // is never called (App.tsx PushedLayer write side not yet wired), the content
  // always appears on the next idle frame — not permanently stranded.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let fired = false;
    const settle = () => {
      if (!fired) {
        fired = true;
        setSettled(true);
      }
    };
    const unsubscribe = onTransitionSettled(settle);
    const idle = requestIdleCallback(settle);
    return () => {
      unsubscribe();
      cancelIdleCallback(idle);
    };
  }, []);

  const onFocus = useCallback(() => {
    setSearchOpen(true);
    onSearchFocusChange?.(true);
  }, [onSearchFocusChange]);

  const onBlur = useCallback(() => {
    setSearchOpen(false);
    onSearchFocusChange?.(false);
  }, [onSearchFocusChange]);

  /**
   * Telegram's `closeSearch`: leave the searching state, clear the query, and
   * give the focus back — here by blurring, which fires `onBlur` and lets the
   * dock collapse the panel to keyboard size again.
   */
  const closeSearch = useCallback(() => {
    setQuery('');
    searchRef.current?.blur();
  }, []);

  /**
   * Give up the focus when the keyboard goes, whoever took it away.
   *
   * Android does not blur a TextInput when the IME is dismissed — by the system
   * back button, by the IME's own hide key, or by `Keyboard.dismiss()`. So the
   * field stayed focused with no keyboard, `onBlur` never fired, and the panel
   * stayed in its expanded search size: the composer sat 15dp low and stayed
   * there until the next toggle (found on device, 2026-09-04). Blurring here is
   * what makes `onBlur` the single honest signal for "search is over".
   */
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      searchRef.current?.blur(),
    );
    return () => hidden.remove();
  }, []);

  /**
   * The cell edge, derived from the window rather than left to flex.
   *
   * See the `cell` style: relative sizing compounds inside `Pressable`, so the
   * grid has to be told an absolute number.
   *
   * Only the grid's OWN padding is subtracted. It used to also subtract
   * `space.md` twice, left over from when the picker lived inside a `Sheet` that
   * had its own inset — the Sheet went and the subtraction stayed, so eight
   * columns were laid out for a box 32dp narrower than the one they were in and
   * ~90px of the panel's right edge was dead (measured on an S22 Ultra: the grid
   * spanned [46 … 990] of 1080).
   *
   * `GRID_PAD` is 5dp, which is Telegram's own grid padding
   * (`EmojiView.java:1751`, recorded in design/references/telegram.md).
   */
  const { width } = useWindowDimensions();
  const cellSize = Math.floor((width - GRID_PAD * 2) / COLUMNS);

  // Recents are read once at mount; re-read on each open so a pick made in
  // another conversation this session is reflected.
  useEffect(() => {
    if (visible) {
      setRecents(readRecents());
      setQuery('');
      setToning(null);
    }
  }, [visible]);

  const searching = query.trim() !== '';

  /**
   * What the grid shows: search hits, the recents list, or a category.
   *
   * Recents are stored already-toned, so they bypass `withTone` — re-applying
   * the current tone to a stored '👍🏽' would append a second modifier.
   */
  const data = useMemo<readonly string[]>(() => {
    if (searching) {
      return searchEmoji(query).map(e => withTone(e, tone));
    }
    if (category === 'recent') {
      return recents;
    }
    const list: readonly Emoji[] = EMOJI_BY_CATEGORY[category];
    return list.map(e => withTone(e, tone));
  }, [searching, query, category, recents, tone]);

  const pick = useCallback(
    (char: string) => {
      setRecents(pushRecent(char));
      onPick(char);
    },
    [onPick],
  );

  /**
   * Long-press opens the tone strip, but only for emoji that take one.
   *
   * The lookup is a reverse map keyed by BOTH the base string and all five
   * pre-composed toned strings, so an already-toned recent finds its source
   * entry and can be re-toned from the Recent tab. The old version tried to
   * derive the base by stripping `U+1F3FB..U+1F3FF` with a regex, which is
   * wrong for every ZWJ sequence carrying two modifiers (🧑🏽‍🤝‍🧑🏿) and for the
   * VS16 cases it then had to special-case again on the next line.
   */
  const hold = useCallback((char: string) => {
    const entry = emojiForNative(char);
    if (entry?.skins !== undefined) {
      setToning(entry.char);
    }
  }, []);

  const chooseTone = useCallback(
    (next: string) => {
      setTone(next);
      writeTone(next);
      setToning(null);
    },
    [],
  );

  return (
    /*
     * Kept MOUNTED and hidden with `display: none`, not unmounted.
     *
     * Telegram creates its `emojiView` once (`createEmojiView()`) and thereafter
     * only flips `setVisibility(VISIBLE/GONE)` (`ChatActivityEnterView.java:12622`
     * and `:12746`). Unmounting meant every single keyboard-to-emoji tap rebuilt
     * the search field, ten tabs and a fresh FlatList on the JS thread inside one
     * frame — which is the artefact frame visible on every swap. The parent still
     * defers the FIRST mount until the panel is first opened, so a user who never
     * taps emoji never pays for it.
     */
    <View
      style={[styles.panel, { height }, visible ? null : styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
      testID="emoji-panel">
    {/* W5#6 gate: render the heavy content only after the push transition
        settles (or immediately if the user already opened the picker). The outer
        View above is always rendered so the slot holds its height in the dock. */}
    {(settled || visible) ? <>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={theme.color.text.tertiary} />
        <TextField
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          placeholderTextColor={theme.color.text.tertiary}
          style={styles.search}
          accessibilityLabel="Search emoji"
          testID="emoji-search"
          allowFontScaling
          underlineColorAndroid="transparent"
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {/* Closes the search, which is what a trailing X in a search field means
            everywhere. It used to be backspace, and that was the bug behind
            "emoji/keyboard switch doesn't work after clicking cross on search":
            the X deleted a character, the search field kept the focus, and the
            panel had no way out. Telegram's own search close is `closeSearch`
            (`ChatActivityEnterView.java:2701-2707`): drop the searching state,
            clear the query, hand the focus back to the message field. */}
        {searchOpen ? (
          <Pressable
            onPress={closeSearch}
            testID="emoji-search-close"
            accessibilityLabel="Close search"
            press="none"
            highlight="dim"
            size={32}
            style={styles.close}>
            <Icon name="close" size={14} color={theme.color.text.secondary} />
          </Pressable>
        ) : null}
      </View>

      {/* The tone strip, shown in place of the tabs while a tone is being
          chosen: the two are the same row of small glyph targets, and stacking
          them would push the grid down mid-interaction. */}
      {toning !== null ? (
        <View style={styles.toneStrip} accessibilityRole="tablist">
          {TONES.map((t, i) => (
            <Pressable
              key={t === '' ? 'default' : t}
              onPress={() => chooseTone(t)}
              accessibilityLabel={i === 0 ? 'Default skin tone' : `Skin tone ${i}`}
              selected={t === tone}
              press="none"
              highlight="dim"
              style={styles.tab}>
              <Text allowFontScaling={false} style={styles.tabGlyph}>
                {TONE_SWATCHES[i]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : searching ? null : (
        /*
         * Scrollable, because ten 36dp targets plus their gaps are 380dp before
         * padding and the narrowest phone this app installs on is 320dp. RN
         * defaults `flexShrink` to 0, so an overflowing row does not compress —
         * it clips, and the tab it clips is the last one (Flags). A keyboard's
         * own category strip scrolls for the same reason.
         */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.tabsBox}
          contentContainerStyle={styles.tabs}
          accessibilityRole="tablist">
          {EMOJI_CATEGORIES.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setCategory(c.id)}
              accessibilityLabel={c.label}
              accessibilityRole="tab"
              selected={c.id === category}
              testID={`emoji-tab-${c.id}`}
              press="none"
              highlight="dim"
              style={[styles.tab, c.id === category ? styles.tabOn : null]}>
              <Text allowFontScaling={false} style={styles.tabGlyph}>
                {c.glyph}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={data as string[]}
        keyExtractor={(item, i) => `${item}-${i}`}
        numColumns={COLUMNS}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Cell char={item} size={cellSize} onPick={pick} onHold={hold} />
        )}
        style={styles.gridBox}
        ListEmptyComponent={
          <Text allowFontScaling style={styles.empty}>
            {searching
              ? 'No emoji match that.'
              : 'Emoji you use will show up here.'}
          </Text>
        }
      />

      {/* Backspace, floating over the grid's bottom-right corner rather than
          sitting in the search row: Telegram's placement
          (`EmojiView.java:2675-2679`, 48dp square, 2dp margin). The panel has
          replaced a keyboard that had this key, so it has to answer for it —
          but not at the cost of the search field's own close control. */}
      {/* Positioned by a plain wrapper, NOT by putting `position: absolute` on
          the Pressable: Pressable hoists box properties onto its root AND leaves
          them on its inner view, so an absolute Pressable lands its offsets on
          the wrong node — the button rendered at the grid's bottom-LEFT with
          `right: 2` set (device, 2026-09-04). Same trap as the percentage cell
          widths noted on `cell`. */}
      <View style={styles.backspaceSlot} pointerEvents="box-none">
        <Pressable
          onPress={onBackspace}
          testID="emoji-backspace"
          accessibilityLabel="Delete"
          press="none"
          highlight="material"
          size={BACKSPACE}
          style={styles.backspace}>
          <Icon name="delete" size={20} color={theme.color.text.secondary} />
        </Pressable>
      </View>
    </> : null}
    </View>
  );
}

export const EmojiPicker = memo(EmojiPickerView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /*
     * The docked panel. Sized to the keyboard it replaces (see keyboardPanel.ts)
     * and painted on the app's own surface, because it is standing in for the
     * IME: anything translucent here would show the transcript sliding behind
     * what is meant to read as a keyboard.
     */
    panel: {
      backgroundColor: t.color.bg.raised,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
      paddingTop: TOKENS.space.xs,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    search: {
      flex: 1,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      paddingVertical: TOKENS.space.xs,
    },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The strip itself: the hairline and the height live here so they survive
    // the swap between the scrolling tab row and the fixed tone row.
    // `display: none` takes it out of layout entirely — a zero height alone would
    // still leave it participating and still cost a measure pass.
    hidden: { display: 'none' },
    tabsBox: {
      flexGrow: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    tabs: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.xs,
      paddingBottom: TOKENS.space['2xs'],
      // A row that fits has its tabs spread; one that overflows scrolls.
      minWidth: '100%',
    },
    toneStrip: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.xs,
      paddingBottom: TOKENS.space['2xs'],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    tab: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The selected category, marked with the same tonal pill the nav bar uses
    // for its active destination rather than a bespoke underline.
    tabOn: {
      backgroundColor: t.color.bg.accentTint,
    },
    tabGlyph: {
      fontSize: 20,
      lineHeight: 24,
    },
    // Fills whatever the panel has left after the search row and tabs. The
    // panel's own height is fixed (the keyboard's), so the grid is the part
    // that flexes and scrolls.
    gridBox: {
      flex: 1,
    },
    grid: {
      paddingHorizontal: GRID_PAD,
      // Clears the floating backspace, so the last row is never under it.
      paddingBottom: BACKSPACE + TOKENS.space.xs,
    },
    backspaceSlot: {
      position: 'absolute',
      right: TOKENS.space.hair,
      bottom: TOKENS.space.hair,
    },
    backspace: {
      width: BACKSPACE,
      height: BACKSPACE,
      borderRadius: BACKSPACE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.raised,
    },
    /*
     * Sized in absolute px by the caller, never as a percentage or a fractional
     * flex. Both were tried on device and both collapsed the cell to a speck:
     * `Pressable` hoists box properties (width, aspectRatio…) onto its root AND
     * leaves them on the inner view so the inner fills the root — which is fine
     * for absolute values and compounding for relative ones, so a `12.5%` cell
     * became 12.5% of 12.5%.
     */
    cell: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    glyph: {
      fontSize: 28,
      lineHeight: 34,
    },
    empty: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
      paddingTop: TOKENS.space.xl,
    },
  });
