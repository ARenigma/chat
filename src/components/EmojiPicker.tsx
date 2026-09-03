import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { tick } from '../lib/haptics';
import {
  EMOJI_BY_CATEGORY,
  EMOJI_CATEGORIES,
  TONES,
  TONE_SWATCHES,
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
  /** Exactly the keyboard's height, so the swap moves nothing. */
  height: number;
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
function EmojiPickerView({ visible, height, onBackspace, onPick }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [category, setCategory] = useState<EmojiCategoryId>('recent');
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<readonly string[]>(() => readRecents());
  const [tone, setTone] = useState<string>(() => readTone());
  // Which emoji's tone strip is open, or null. One at a time.
  const [toning, setToning] = useState<string | null>(null);

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
   * The check is on the BASE character, so a already-toned recent still matches
   * its source entry and can be re-toned from the Recent tab.
   */
  const hold = useCallback((char: string) => {
    const base = char.replace(
      /[\u{1F3FB}-\u{1F3FF}]/gu,
      '',
    );
    const takesTone = Object.values(EMOJI_BY_CATEGORY)
      .flat()
      .some(e => e.tone === true && e.char.replace(/️$/, '') === base.replace(/️$/, ''));
    if (takesTone) {
      tick();
      setToning(base);
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
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          placeholderTextColor={theme.color.text.tertiary}
          style={styles.search}
          accessibilityLabel="Search emoji"
          testID="emoji-search"
          allowFontScaling
          underlineColorAndroid="transparent"
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
        <View style={styles.tabs} accessibilityRole="tablist">
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
        <View style={styles.tabs} accessibilityRole="tablist">
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
        </View>
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
    tabs: {
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
