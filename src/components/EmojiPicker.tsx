import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { tick } from '../lib/haptics';
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
      highlight="ios"
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
   * The cell edge, in px, derived from the window rather than left to flex.
   *
   * See the `cell` style: relative sizing compounds inside `Pressable`, so the
   * grid has to be told an absolute number. Both the grid's own horizontal
   * padding and the sheet's are subtracted so eight columns land inside the
   * content box instead of overflowing it.
   */
  const { width } = useWindowDimensions();
  const cellSize = Math.floor(
    (width - TOKENS.space.xs * 2 - TOKENS.space.md * 2) / COLUMNS,
  );

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
      tick();
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
      tick();
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

  if (!visible) {
    return null;
  }

  return (
    <View style={[styles.panel, { height }]} testID="emoji-panel">
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
          onFocus={() => onSearchFocusChange?.(true)}
          onBlur={() => onSearchFocusChange?.(false)}
        />
        {/* Backspace, where the keyboard's was. The panel takes the keyboard's
            place, so it has to answer for the key the keyboard took away —
            Telegram's panel keeps one in the same corner for the same reason. */}
        <Pressable
          onPress={onBackspace}
          testID="emoji-backspace"
          accessibilityLabel="Delete"
          press="none"
          highlight="ios"
          size={32}
          style={styles.close}>
          <Icon name="close" size={14} color={theme.color.text.secondary} />
        </Pressable>
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
              highlight="ios"
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
              highlight="ios"
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
      paddingHorizontal: TOKENS.space.xs,
      paddingBottom: TOKENS.space.xl,
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
