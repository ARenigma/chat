import React, { useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

const HINT =
  'Choose anyone in the Explore list to bring their chat here.';

/**
 * Empty-chats affordance: a plus in a dotted circle. Tap opens a short Paper
 * tooltip (not a sheet) so the empty rail does not look broken.
 * https://developer.android.com/reference/kotlin/androidx/compose/material3/TooltipBox
 */
export function ChatStartHint() {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        testID="chats-empty-plus"
        accessibilityLabel="Start a chat"
        accessibilityHint={HINT}
        press="button"
        size={56}
        style={styles.plus}>
        <Icon name="plus" size={22} color={styles.plusInk.color} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        hardwareAccelerated
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <RNPressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityLabel="Dismiss">
          <View style={styles.bubble} accessibilityRole="text">
            <Text allowFontScaling style={styles.bubbleText}>
              {HINT}
            </Text>
          </View>
        </RNPressable>
      </Modal>
    </>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    plus: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: t.color.border.strong,
    },
    plusInk: {
      color: t.color.text.secondary,
    },
    scrim: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.xl,
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    bubble: {
      alignSelf: 'center',
      maxWidth: 320,
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.md,
    },
    bubbleText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
      textAlign: 'center',
    },
  });
