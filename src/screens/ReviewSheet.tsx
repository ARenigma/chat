import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { TOKENS } from '../theme/tokens';
import { useSubmitReview } from '../api/provider';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';

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
 * if nobody rates — Clarity's rows show "5.0 ★ 39+ reviews", which is the signal
 * a member actually chooses on. So this is offered, once, from the thread the
 * member has already had.
 *
 * Never interrupting: it is opened by tapping, exactly like the refill sheet, and
 * the server refuses a review on a conversation with fewer than two messages so
 * there is nothing to rate before there is something to rate.
 */
export function ReviewSheet({ visible, onClose, conversationId, peerName }: Props) {
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
      onClose={dismiss}>
      <View style={styles.stars}>
        {STARS.map(n => (
          <Pressable
            key={n}
            onPress={() => setRating(n)}
            testID={`star-${n}`}
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            style={styles.star}>
            <Text allowFontScaling style={[styles.starGlyph, n <= rating && styles.starOn]}>
              ★
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        testID="review-comment"
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="Anything you want to add? (optional)"
        placeholderTextColor={TOKENS.color.text.secondary}
        multiline
        maxLength={1000}
        allowFontScaling
        underlineColorAndroid="transparent"
      />

      <Button
        label={submit.isPending ? 'Saving…' : 'Submit'}
        onPress={() => {
          if (conversationId !== undefined && rating > 0) {
            submit.mutate(
              { conversationId, rating, comment: comment.trim() === '' ? null : comment.trim() },
              { onSuccess: dismiss },
            );
          }
        }}
        disabled={submit.isPending || rating === 0}
        testID="review-submit"
      />
      <Button label="Not now" kind="secondary" onPress={dismiss} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stars: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: TOKENS.space.xs,
    paddingBottom: TOKENS.space.md,
  },
  star: {
    paddingHorizontal: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space['2xs'],
  },
  // Weight rather than colour: the accent budget is spent, and a filled glyph
  // against an outline reads unambiguously without it.
  starGlyph: {
    fontSize: 30,
    color: TOKENS.color.bg.sunken,
  },
  starOn: {
    color: TOKENS.color.text.primary,
  },
  input: {
    alignSelf: 'stretch',
    minHeight: 72,
    maxHeight: 140,
    padding: TOKENS.space.md,
    marginBottom: TOKENS.space.sm,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.sunken,
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.primary,
    textAlignVertical: 'top',
  },
});
