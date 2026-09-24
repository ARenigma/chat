import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** Holds the confirming action back (e.g. until a price is known); cancel stays live. */
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  testID?: string;
}

/**
 * The app-level equivalent of Material's basic confirmation dialog, hosted as an
 * M3 Paper bottom sheet rather than a centered alert.
 *
 * Two outcome-named actions are deliberate: confirmation dialogs should pair a
 * dismissive action with a specific confirming action, not a vague “OK”.
 * https://m3.material.io/components/dialogs/guidelines
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  cancelLabel,
  confirmLabel,
  destructive = false,
  busy = false,
  busyLabel = 'Working…',
  confirmDisabled = false,
  onCancel,
  onConfirm,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);

  return (
    <Sheet
      visible={visible}
      title={title}
      body={body}
      onClose={onCancel}
      dismissOnScrim={!busy}
      testID={testID}
      footer={
        <View style={styles.footer}>
          {destructive ? (
            <>
              <Button
                label={cancelLabel}
                onPress={onCancel}
                disabled={busy}
                testID="confirm-dialog-cancel"
              />
              <Button
                label={confirmLabel}
                onPress={onConfirm}
                kind="danger"
                disabled={busy || confirmDisabled}
                busy={busy}
                busyLabel={busyLabel}
                testID="confirm-dialog-confirm"
              />
            </>
          ) : (
            <>
              <Pressable
                onPress={onCancel}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                press="none"
                highlight="dim"
                style={styles.cancelHit}>
                <Text allowFontScaling style={[styles.cancel, busy && styles.busy]}>
                  {cancelLabel}
                </Text>
              </Pressable>
              <Button
                label={confirmLabel}
                onPress={onConfirm}
                disabled={busy || confirmDisabled}
                busy={busy}
                busyLabel={busyLabel}
                testID="confirm-dialog-confirm"
              />
            </>
          )}
        </View>
      }>
      {null}
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    footer: {
      gap: TOKENS.space.xs,
    },
    cancelHit: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancel: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.secondary,
    },
    busy: {
      opacity: 0.55,
    },
  });
