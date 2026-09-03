import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { springTo } from '../theme/motion';
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
  /*
   * Overshoot appear, from nothing near the bubble corner.
   *
   * Telegram's reaction bar scales in over 250ms on an OvershootInterpolator(0.5)
   * with the pivot at the anchored corner (ReactionsContainerLayout.java:1499,
   * :847-848). `bounce` (ratio 0.59) overshoots the same way; the origin is set
   * per side below so it grows out of the bubble it belongs to rather than the
   * screen centre. `springTo` carries ReduceMotion.System, so it snaps in under
   * reduce-motion instead of springing.
   */
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.value = springTo(1, 'bounce');
  }, [appear]);
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(appear.value, 1),
    transform: [{ scale: 0.85 + 0.15 * appear.value }],
  }));
  return (
    <Animated.View
      testID="reaction-strip"
      style={[
        styles.strip,
        mine ? styles.stripOriginMine : styles.stripOriginPeer,
        animated,
      ]}>
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
    </Animated.View>
  );
}

export const ReactionStrip = memo(ReactionStripView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: TOKENS.space.hair,
      paddingHorizontal: 6,
      paddingVertical: TOKENS.space['2xs'],
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
      marginBottom: TOKENS.space['2xs'],
    },
    // The strip sits above the bubble; growing out of the bubble's own corner
    // (bottom, on the speaker's side) reads as belonging to that message.
    stripOriginPeer: {
      transformOrigin: 'bottom left',
    },
    stripOriginMine: {
      transformOrigin: 'bottom right',
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
      marginHorizontal: TOKENS.space.hair,
    },
    action: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
