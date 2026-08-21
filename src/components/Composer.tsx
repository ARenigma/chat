import React, { memo, useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { MAX_MESSAGE_CHARS } from '../lib/tokenLedger';
import { SendButton } from './SendButton';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder: string;
  bloomKey: number;
  /**
   * Fired per keystroke so the other side can be shown a typing indicator. The
   * throttling lives in the Realtime layer, not here — the composer should not
   * have to know how often a broadcast is affordable.
   */
  onTyping?: () => void;
}

/**
 * Composition state is local — lifting the draft into the store would re-render
 * every subscriber on each keystroke for no benefit. The field floats on
 * elevation rather than sitting behind a divider, and send is inset inside it.
 */
function ComposerView({ onSend, disabled, placeholder, bloomKey, onTyping }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [value, setValue] = useState('');
  const ready = value.trim().length > 0 && !disabled;

  const change = useCallback(
    (next: string) => {
      setValue(next);
      if (next !== '') {
        onTyping?.();
      }
    },
    [onTyping],
  );

  const submit = useCallback(() => {
    if (!ready) {
      return;
    }
    onSend(value);
    setValue('');
  }, [onSend, ready, value]);

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <TextInput
          testID="composer-input"
          style={styles.input}
          value={value}
          onChangeText={change}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.secondary}
          multiline
          maxLength={MAX_MESSAGE_CHARS}
          allowFontScaling
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
          accessibilityLabel="Message"
          accessibilityHint="One message costs one token"
          underlineColorAndroid="transparent"
        />
        <SendButton onPress={submit} disabled={!ready} bloomKey={bloomKey} />
      </View>
    </View>
  );
}

export const Composer = memo(ComposerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space['2xs'],
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
    paddingLeft: TOKENS.space.lg,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: t.color.bg.raised,
    ...TOKENS.elevation.composer,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 132,
    paddingTop: 10,
    paddingBottom: 10,
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
  },
});
