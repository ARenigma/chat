import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useSetConversationName } from '../api/conversationLabels';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  conversationId: string | undefined;
  /** The current custom label, if one is set — otherwise the field starts empty. */
  currentLabel: string | undefined;
  /** The peer's real display name, shown as the placeholder (what clearing reverts to). */
  peerName: string;
}

const MAX = 40;

/**
 * Rename a conversation with a PRIVATE label (migration 098). Only the person who
 * sets it sees it; it overrides the peer's display name in their own inbox and
 * chat header. Clearing the field removes the label and reverts to the peer name.
 */
export function RenameChatSheet({ visible, onClose, conversationId, currentLabel, peerName }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const setName = useSetConversationName();
  const [name, setName_] = useState(currentLabel ?? '');

  // Re-seed the field each time the sheet opens, so it reflects the current label.
  useEffect(() => {
    if (visible) {
      setName_(currentLabel ?? '');
    }
  }, [visible, currentLabel]);

  const save = (): void => {
    if (conversationId === undefined) {
      onClose();
      return;
    }
    // A blank name clears the label server-side; that is the "remove" path too.
    setName.mutate(
      { conversationId, name: name.trim() },
      { onSettled: onClose },
    );
  };

  return (
    <Sheet
      visible={visible}
      testID="rename-chat"
      title="Rename chat"
      body={`A private name only you see. Leave empty to use “${peerName}”.`}
      onClose={onClose}>
      <TextField
        testID="rename-chat-input"
        style={styles.input}
        value={name}
        onChangeText={setName_}
        placeholder={peerName}
        placeholderTextColor={theme.color.text.tertiary}
        maxLength={MAX}
        allowFontScaling
        autoFocus
        underlineColorAndroid="transparent"
      />
      <Button
        label={name.trim() === '' && (currentLabel ?? '') !== '' ? 'Remove name' : 'Save'}
        busy={setName.isPending}
        busyLabel="Saving"
        onPress={save}
        testID="rename-chat-save"
      />
    </Sheet>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    input: {
      marginBottom: TOKENS.space.md,
    },
  });
