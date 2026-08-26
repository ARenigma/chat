import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { TextField } from './TextField';

/**
 * The strip the field sits in: `52 = 8 + 36 + 8`.
 *
 * Exported because `LargeTitleBar` adds it to the band it reserves, and the two
 * must not be able to disagree. Measured off `Pappal Home, large title expanded`
 * (54:4).
 */
export const SEARCH_FIELD_HEIGHT = 36;
export const SEARCH_STRIP_HEIGHT = SEARCH_FIELD_HEIGHT + TOKENS.space.xs * 2;

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  testID?: string;
  clearTestID?: string;
}

/**
 * The iOS search field, extracted from the inbox so Explore can have the same one.
 *
 * **It never hides on scroll**, which is the one place this deliberately parts
 * company with WhatsApp. WhatsApp sets `hidesSearchBarWhenScrolling`, and copying
 * it here would undo a fix that is recorded in `InboxScreen`: search in this app
 * reaches the directory as well as the inbox, so an empty inbox is exactly when
 * finding somebody matters most, and the version that hid the field hid it from
 * the one person it was built for. That is also why the bar's collapse travel is
 * 52 and not 104: the title strip is given up, this strip is not.
 *
 * **Sunken, not raised, and no border.** On a white page `bg/raised` is the same
 * colour as `bg/base`, so a raised field is held together by a hairline and
 * nothing else. An iOS search field is an inset well, so it takes the token whose
 * whole job that is, and a fill plus an outline would be saying it twice.
 *
 * **The debounce is not here.** `src/lib/search.ts` owns the 250ms settle, and it
 * stays there because the delay is a property of searching rather than of the
 * control: this field reports every keystroke, and the screen decides when a
 * query has stopped changing.
 */
function SearchFieldView({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  testID,
  clearTestID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <Icon name="search" size={16} color={theme.color.text.tertiary} />
      <TextField
        testID={testID}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        allowFontScaling
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
        underlineColorAndroid="transparent"
      />
      {value !== '' ? (
        <Pressable
          onPress={() => onChangeText('')}
          testID={clearTestID}
          accessibilityLabel="Clear search"
          press="chip"
          size={24}
          style={styles.clear}>
          <Icon name="close" size={11} color={theme.color.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const SearchField = memo(SearchFieldView);

const makeStyles = (t: Theme) => StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    height: SEARCH_FIELD_HEIGHT,
    paddingLeft: TOKENS.space.sm,
    paddingRight: TOKENS.space['2xs'],
    marginHorizontal: TOKENS.space.md,
    // 10, not a capsule. An iOS search bar is a 10pt rounded rect; the capsule is
    // the Material search-pill shape.
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  input: {
    flex: 1,
    // No minHeight: the strip is a fixed 36 and the band arithmetic in
    // LargeTitleBar depends on it staying that. Vertical padding is zeroed for
    // the same reason, because Android's TextInput ships its own.
    paddingVertical: 0,
    ...TOKENS.typography.subhead,
    color: t.color.text.primary,
  },
  clear: {
    width: 24,
    height: 24,
    borderRadius: TOKENS.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.base,
  },
});
