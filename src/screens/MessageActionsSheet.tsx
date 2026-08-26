import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ReactionEmoji } from '../lib/database.types';
import { REACTION_CHOICES } from '../lib/reactions';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Whose message it is, which decides the title and whether Report appears. */
  mine: boolean;
  /** The sender's name, or 'Your message' when mine. Null while nothing is open. */
  author: string;
  /** The message text, or null on a voice note. */
  body: string | null;
  /** Which emoji the caller already has on this message, so it renders selected. */
  chosen: ReactionEmoji | null;
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onReport: () => void;
}

/**
 * Long-press actions: React and Reply, and Report on the other person's messages.
 *
 * **What is deliberately absent, and it is a safety decision rather than a
 * roadmap gap.** No Copy and no Forward: the app sets `FLAG_SECURE` so a
 * screenshot of a conversation cannot be taken, and both of those are a way to
 * lift somebody's words out of the room they said them in, which defeats the
 * point of the flag. No Delete: a message the sender can destroy after the fact
 * is worthless as evidence, and `submit_report` snapshots a message precisely so
 * an abuser cannot withdraw it. All three are the same argument in three shapes.
 *
 * **Where the quoted message goes.** Not in `title`. Sheet renders `title` at
 * `titleMedium`, which is 22pt Bold, shouting somebody's words back at them,
 * and a long message would stretch the sheet with nothing truncating it. The
 * quote is the first child instead, at `bodyMedium` with `numberOfLines={4}`.
 *
 * **Why the reaction row has no trailing `+`.** The reference this was drawn from
 * has one, and there is no emoji picker behind it, and the closed six-emoji set is
 * the whole safety argument for the feature: a reaction renders under somebody
 * else's words in their transcript, attributed to them at a glance, and free text
 * there would be an unmoderatable channel aimed at one person. A `+` that opens
 * nothing is worse than no `+`, and a `+` that opened a full keyboard would be
 * the thing the CHECK constraint exists to prevent.
 *
 * Both rows are wired to real server calls. React goes through `toggle_reaction`
 * and Reply through `send_message`'s `p_reply_to_id`, both added by migration 011.
 * Nothing here is behind a flag, because nothing here needs to be.
 */
export function MessageActionsSheet({
  visible,
  onClose,
  mine,
  author,
  body,
  chosen,
  onReact,
  onReply,
  onReport,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  return (
    <Sheet
      visible={visible}
      testID="message-actions"
      title={mine ? 'Your Message' : author}
      onClose={onClose}>
      <View style={styles.quote}>
        <Text
          testID="actions-quote"
          allowFontScaling
          numberOfLines={4}
          style={styles.quoteText}>
          {body ?? 'Voice note'}
        </Text>
      </View>

      <View testID="reaction-row" style={styles.reactions}>
        {REACTION_CHOICES.map(emoji => (
          <Pressable
            key={emoji}
            testID={`react-${emoji}`}
            accessibilityLabel={
              chosen === emoji ? `Remove ${emoji} reaction` : `React with ${emoji}`
            }
            // The one place a press scale is right in this sheet: an emoji is a
            // small target and the tap is the whole interaction.
            press="chip"
            size={48}
            onPress={() => onReact(emoji)}
            style={[styles.emojiTarget, chosen === emoji && styles.emojiChosen]}>
            <Text allowFontScaling={false} style={styles.emoji}>
              {emoji}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Menu rows, not Buttons. A full-width filled Button says "this is the
          action of the sheet"; these are a menu, and SafetySheet's reason list
          already set that shape. */}
      <Pressable
        testID="action-reply"
        accessibilityLabel="Reply to this message"
        press="none"
        highlight="ios"
        onPress={onReply}
        style={styles.row}>
        <Text allowFontScaling style={styles.rowLabel}>
          Reply
        </Text>
        <Icon name="reply" size={16} color={theme.color.text.secondary} />
      </Pressable>

      {/* Only on their messages. Reporting your own is meaningless and
          `submit_report`'s evidence snapshot refuses it anyway, it only reads a
          message whose `sender_id` is the person being reported. This row is also
          what preserves the per-message evidence path now that a long press opens
          this sheet instead of going straight to SafetySheet. */}
      {mine ? null : (
        <Pressable
          testID="action-report"
          accessibilityLabel="Report this message"
          press="none"
          highlight="ios"
          onPress={onReport}
          style={styles.row}>
          <Text allowFontScaling style={[styles.rowLabel, styles.danger]}>
            Report This Message
          </Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  quote: {
    alignSelf: 'stretch',
    padding: TOKENS.space.sm,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  quoteText: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
  reactions: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    paddingVertical: TOKENS.space['2xs'],
  },
  emojiTarget: {
    width: 44,
    height: 44,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The chosen one is marked with a fill, not with the accent: this sheet is
  // eight small controls and a coral one among them would read as the primary
  // action rather than as the current state.
  emojiChosen: {
    backgroundColor: t.color.bg.sunken,
  },
  emoji: {
    fontSize: 28,
    lineHeight: 34,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingVertical: TOKENS.space.sm,
  },
  rowLabel: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.primary,
  },
  danger: {
    color: t.color.state.danger,
  },
});
