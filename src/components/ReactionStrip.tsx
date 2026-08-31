import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ReactionEmoji } from '../lib/database.types';
import { REACTION_CHOICES } from '../lib/reactions';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  chosen: ReactionEmoji | null;
  /** Hide Report on your own messages. */
  mine: boolean;
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onReport?: () => void;
}

/**
 * Thin WhatsApp-style reaction bar that sits on top of the pressed message.
 *
 * Not a bottom sheet: a single compact strip — six emoji + reply (+ report on
 * theirs). Designed to float just above the bubble without covering the thread.
 */
function ReactionStripView({
  chosen,
  mine,
  onReact,
  onReply,
  onReport,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <View testID="reaction-strip" style={styles.strip}>
      {REACTION_CHOICES.map(emoji => (
        <Pressable
          key={emoji}
          testID={`react-${emoji}`}
          accessibilityLabel={
            chosen === emoji ? `Remove ${emoji}` : `React with ${emoji}`
          }
          press="chip"
          size={36}
          onPress={() => onReact(emoji)}
          style={[styles.emoji, chosen === emoji && styles.emojiChosen]}>
          <Text allowFontScaling={false} style={styles.emojiText}>
            {emoji}
          </Text>
        </Pressable>
      ))}
      <View style={styles.divider} />
      <Pressable
        testID="strip-reply"
        accessibilityLabel="Reply"
        press="chip"
        size={36}
        onPress={onReply}
        style={styles.action}>
        <Icon name="reply" size={16} color={theme.color.text.primary} />
      </Pressable>
      {!mine && onReport ? (
        <Pressable
          testID="strip-report"
          accessibilityLabel="Report"
          press="chip"
          size={36}
          onPress={onReport}
          style={styles.action}>
          <Icon name="report" size={15} color={theme.color.state.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const ReactionStrip = memo(ReactionStripView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      // Soft lift so it reads above the wallpaper without a heavy sheet.
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
      marginBottom: 4,
    },
    emoji: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emojiChosen: {
      backgroundColor: t.color.bg.sunken,
    },
    emojiText: {
      fontSize: 20,
      lineHeight: 24,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: 22,
      backgroundColor: t.color.border.hairline,
      marginHorizontal: 2,
    },
    action: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
