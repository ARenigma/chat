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
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { fadeSwapFast } from '../theme/motion';
import { useSubmitSessionReview } from '../api/provider';
import { useStore } from '../store/useStore';
import { Button } from './Button';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { TextField } from './TextField';

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * One session, one prompt — for the whole run of the app.
 *
 * Two screens notice a session ending now: ChatScreen watches `activeSession`
 * cross from live to null, and CallScreen fires on unmount. They are not
 * alternatives, they overlap, because `get_active_session` (037:732) selects the
 * conversation's latest live session WITHOUT filtering by channel — so the chat
 * the member lands on after hanging up reads back the audio/video session row
 * they were just in and watches it end a second time.
 *
 * The store's first-writer-wins only holds while a sheet is still up. Once the
 * member has rated or skipped, `clearReview` has set `pendingReview` back to
 * null, and the second notice arriving a poll later would open a fresh sheet for
 * a session they have already answered about — the exact thing that comment
 * promises not to do.
 *
 * So the "already asked" memory lives here, beside the thing that must not
 * appear twice, rather than in the store. Module scope because it has to outlive
 * this component's mounts, and ids only, so it costs a handful of uuids per app
 * run. A session id is never reissued, so there is nothing to evict.
 */
const ASKED = new Set<string>();

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
  /**
   * The session this mount is currently asking about, which is what makes the
   * `ASKED` check above safe to read during render: the id goes into the set the
   * moment the sheet is claimed, so without a separate record of "and it is
   * mine" the very sheet that just registered would hide itself on the next
   * render. Cleared by `close`, so a repeat notice for the same session finds
   * `askedFor === null`, falls to the `ASKED` branch, and is dropped.
   */
  const [askedFor, setAskedFor] = useState<string | null>(null);

  const close = useCallback(() => {
    setRating(0);
    setComment('');
    setAskedFor(null);
    clearReview();
  }, [clearReview]);

  useEffect(() => {
    if (pending === null || askedFor === pending.sessionId) {
      return;
    }
    if (ASKED.has(pending.sessionId)) {
      // Somebody already put this session to the member. Drop the notice rather
      // than leave it pending, or it would re-open on the next render.
      clearReview();
      return;
    }
    ASKED.add(pending.sessionId);
    setAskedFor(pending.sessionId);
  }, [pending, askedFor, clearReview]);

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

  if (pending === null || askedFor !== pending.sessionId) {
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
              size={48}
              // The one icon site with no `style` at all, so there was no radius
              // for the state layer to inherit and it painted a square behind the
              // star glyph. A star is an icon-only control like any other, and
              // those take borderless (circular) ink.
              // https://developer.android.com/training/material/animations
              shape="circle">
              {/* Filled by colour, not by a second glyph: the icon font has one
                  star, and a hollow-vs-solid pair would be two glyphs that must
                  agree about their optical weight forever. */}
              <Icon
                name="star"
                size={TOKENS.icon['2xl']}
                color={on ? theme.color.text.token : theme.color.border.strong}
              />
            </Pressable>
          );
        })}
      </View>
      {/*
        * Keyed on the rating so React remounts the node and Reanimated runs the
        * entrance — the word used to hard-cut between "Tap a star", "Not what I
        * needed" and "Exactly what I needed" as the stars were tapped.
        *
        * This is the sharpest unjustified teleport in the product: it is the
        * line that names what somebody felt about a conversation that may have
        * mattered a great deal to them, and it changed with no bridge at all.
        * Rare tier (once per session end), so the budget is there to spend.
        *
        * `fadeSwapFast` rather than a slower swap because the word is chasing
        * the finger — a tap on the fourth star should read as the word already
        * agreeing, not as the word catching up. `styles.word` reserves the line
        * (minHeight), so a remount cannot reflow the sheet.
        */}
      <Animated.Text
        key={rating}
        entering={fadeSwapFast}
        allowFontScaling
        style={styles.word}
        testID="session-feedback-word">
        {rating === 0 ? 'Tap a star' : RATING_WORD[rating]}
      </Animated.Text>
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
