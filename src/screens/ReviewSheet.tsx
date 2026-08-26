import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useSubmitReview } from '../api/provider';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  conversationId: string | undefined;
  peerName: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Rating a conversation.
 *
 * The directory now publishes a rating and a review count, and both are useless
 * if nobody rates, Clarity's rows show "5.0 ★ 39+ reviews", which is the signal
 * a member actually chooses on. So this is offered, once, from the thread the
 * member has already had.
 *
 * Never interrupting: it is opened by tapping, exactly like the refill sheet, and
 * the server refuses a review on a conversation with fewer than two messages so
 * there is nothing to rate before there is something to rate.
 */
export function ReviewSheet({ visible, onClose, conversationId, peerName }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const submit = useSubmitReview();

  const dismiss = (): void => {
    setRating(0);
    setComment('');
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      testID="review-sheet"
      title={`How was talking to ${peerName}?`}
      body="Only the rating is shown to other people, and never your name."
      onCancel={dismiss}
      cancelLabel="Not Now"
      onClose={dismiss}>
      <View style={styles.stars}>
        {STARS.map(n => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            testID={`star-${n}`}
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            // No `press` prop meant every star inherited `press="card"` and
            // shrank 2.5% on tap. An iOS star rating does not animate.
            press="none"
            highlight="ios"
            style={styles.star}>
            <Text allowFontScaling style={[styles.starGlyph, n <= rating && styles.starOn]}>
              ★
            </Text>
          </Pressable>
        ))}
      </View>

      <TextField
        testID="review-comment"
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="Add a comment"
        placeholderTextColor={theme.color.text.tertiary}
        multiline
        maxLength={1000}
        allowFontScaling
        underlineColorAndroid="transparent"
      />
      {/* '(optional)' moved out of the placeholder and into a footer, which is
          where iOS puts optionality: a placeholder is a hint about what to type,
          not a statement about whether you have to. */}
      <Text allowFontScaling style={styles.footnote}>
        The comment is optional.
      </Text>

      <Button
        label="Submit"
        busy={submit.isPending}
        busyLabel="Submitting review"
        onPress={() => {
          if (conversationId !== undefined && rating > 0) {
            submit.mutate(
              { conversationId, rating, comment: comment.trim() === '' ? null : comment.trim() },
              { onSuccess: dismiss },
            );
          }
        }}
        // `rating === 0` is a real precondition and stays disabled. The pending
        // half moved to `busy`, so the narrated label is legible.
        disabled={rating === 0}
        testID="review-submit"
      />
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  stars: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: TOKENS.space.xs,
    paddingBottom: TOKENS.space.md,
  },
  // 8, not 4. A 30pt glyph with 4pt each side is a ~38pt visual, under iOS's 44
  // minimum, and it was rescued only by the default hitSlop happening to be big
  // enough. At 8 the visual itself clears 44.
  star: {
    paddingHorizontal: TOKENS.space.xs,
    paddingVertical: TOKENS.space.xs,
  },
  // Weight rather than colour: the accent budget is spent, and a filled glyph
  // against an outline reads unambiguously without it.
  starGlyph: {
    fontSize: 30,
    color: t.color.bg.sunken,
  },
  starOn: {
    color: t.color.text.primary,
  },
  input: {
    alignSelf: 'stretch',
    minHeight: 72,
    maxHeight: 140,
    padding: TOKENS.space.md,
    marginBottom: TOKENS.space.sm,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
    textAlignVertical: 'top',
  },
  footnote: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.secondary,
    paddingBottom: TOKENS.space.sm,
  },
});
