/**
 * M3 Docked Search Bar.
 *
 * Spec: https://m3.material.io/components/search/specs
 *   Height: 56 dp, filled container (surface-container).
 *   Leading: search icon.
 *   Trailing: clear button when text is present.
 *   Corner radius: pill (28 dp half of 56).
 *   Placeholder and value text: body-medium.
 *
 * Docked = inline in the scroll view, not a modal/expanding search.  The caller
 * controls the value and onChange (controlled input).
 */
import React, { memo, useRef } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

/** M3 Docked Search Bar height (dp). */
export const SEARCH_BAR_HEIGHT = 56;

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  /** Called when the clear button is pressed. Default: clears the value. */
  onClear?: () => void;
  testID?: string;
}

function SearchBarView({
  value,
  onChangeText,
  placeholder = 'Search',
  onFocus,
  onBlur,
  onClear,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  const handleClear = () => {
    onClear ? onClear() : onChangeText('');
    inputRef.current?.focus();
  };

  return (
    <View testID={testID} style={styles.container}>
      {/* Leading search icon */}
      <Icon name="search" size={20} color={theme.color.text.secondary} />

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        onFocus={onFocus}
        onBlur={onBlur}
        style={styles.input}
        returnKeyType="search"
        clearButtonMode="never"
        disableFullscreenUI
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityRole="search"
        accessibilityLabel={placeholder}
      />

      {/* Clear button — only visible when there is text */}
      {value.length > 0 ? (
        <Pressable
          onPress={handleClear}
          accessibilityLabel="Clear search"
          press="none"
          size={36}>
          <Icon name="close" size={18} color={theme.color.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const SearchBar = memo(SearchBarView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      height: SEARCH_BAR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.color.bg.sunken,
      // M3 spec: pill shape (radius = height / 2).
      borderRadius: SEARCH_BAR_HEIGHT / 2,
      paddingHorizontal: TOKENS.space.md,
      gap: TOKENS.space.sm,
    },
    input: {
      flex: 1,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      // Remove default RN TextInput padding so it sits flush in the pill.
      paddingVertical: 0,
    },
  });
