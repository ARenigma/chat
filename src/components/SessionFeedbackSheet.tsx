/**
 * "How was that?" — the star rating a member gives after a session ends.
 *
 * Goal item 14 (Amit, 2026-09-05). It appears once per session, from wherever
 * the session ended: a chat, or a call started from the provider's page. The
 * store holds `pendingReview` for exactly that reason — the sheet outlives the
 * screen that noticed.
 *
 * Skipping is a first-class answer. A rating prompt with no way past it is a
 * toll gate on leaving a conversation somebody may have found difficult, and
 * the one thing this product cannot afford is making the exit feel expensive.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useSubmitSessionReview } from '../api/provider';
import { useStore } from '../store/useStore';
import { Button } from './Button';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

const STARS = [1, 2, 3, 4, 5] as const;

/** Names the number, so a tap has a meaning and not just a count. */
const RATING_WORD: Record<number, string> = {
  1: 'Not what I needed',
  2: 'It was okay',
  3: 'Helped a bit',
  4: 'Good conversation',
  5: 'Exactly what I needed',
};

export function SessionFeedbackSheet() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const pending = useStore(s => s.pendingReview);
  const clearReview = useStore(s => s.clearReview);
  const submit = useSubmitSessionReview();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const close = useCallback(() => {
    setRating(0);
    setComment('');
    clearReview();
  }, [clearReview]);

  const send = useCallback(() => {
    if (pending === null || rating === 0) {
      return;
    }
    submit.mutate(
      {
        sessionId: pending.sessionId,
        rating,
        comment: comment.trim() === '' ? null : comment.trim(),
      },
      // Closed either way: a rating that failed to save is not worth trapping
      // somebody in a sheet over, and the notice already said so.
      { onSuccess: close, onError: close },
    );
  }, [pending, rating, comment, submit, close]);

  if (pending === null) {
    return null;
  }

  return (
    <Sheet
      visible
      testID="session-feedback"
      title={`How was your session with ${pending.peerName}?`}
      body="Only the rating is shown to other members, never your name."
      onClose={close}
      onCancel={close}
      cancelLabel="Skip"
      footer={
        <Button
          label="Send"
          onPress={send}
          disabled={rating === 0}
          busy={submit.isPending}
          busyLabel="Sending"
          testID="session-feedback-send"
        />
      }>
      <View style={styles.stars} accessibilityRole="radiogroup">
        {STARS.map(n => {
          const on = n <= rating;
          return (
            <Pressable
              key={n}
              onPress={() => setRating(n)}
              testID={`session-feedback-star-${n}`}
              accessibilityRole="radio"
              checked={on}
              accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}, ${RATING_WORD[n]}`}
              press="none"
              size={48}>
              {/* Filled by colour, not by a second glyph: the icon font has one
                  star, and a hollow-vs-solid pair would be two glyphs that must
                  agree about their optical weight forever. */}
              <Icon
                name="star"
                size={34}
                color={on ? theme.color.text.token : theme.color.border.strong}
              />
            </Pressable>
          );
        })}
      </View>
      <Text allowFontScaling style={styles.word} testID="session-feedback-word">
        {rating === 0 ? 'Tap a star' : RATING_WORD[rating]}
      </Text>
      <TextField
        testID="session-feedback-comment"
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="Anything you want to add? (optional)"
        placeholderTextColor={theme.color.text.tertiary}
        maxLength={1000}
        multiline
        allowFontScaling
        underlineColorAndroid="transparent"
      />
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    stars: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
    },
    word: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
      // Reserves the line so the sheet does not grow by one row of text the
      // first time a star is tapped.
      minHeight: 24,
    },
    input: {
      minHeight: 72,
      maxHeight: 140,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.sm,
      paddingBottom: TOKENS.space.sm,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
      color: t.color.text.primary,
      ...TOKENS.typography.bodyLarge,
      textAlignVertical: 'top',
    },
  });
