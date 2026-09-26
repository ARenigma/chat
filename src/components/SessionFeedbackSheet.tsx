/**
 * "How was that?" — the star rating a member gives after a session ends.
 *
 * Goal item 14 (Amit, 2026-09-05). It appears once per session, from wherever
 * the session ended: a chat, or a call started from the provider's page. The
 * store holds `pendingReview` for exactly that reason — the sheet outlives the
 * screen that noticed.
 *
 * Members only, and this file is where that is settled rather than trusted:
 * `useWasTheMember` below checks the session row before the sheet can open, so
 * a provider is never asked no matter which screen raised the notice.
 *
 * Skipping is a first-class answer. A rating prompt with no way past it is a
 * toll gate on leaving a conversation somebody may have found difficult, and
 * the one thing this product cannot afford is making the exit feel expensive.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { fadeSwapFast, fadeSwapOutFast } from '../theme/motion';
import { useSubmitSessionReview } from '../api/provider';
import { supabase } from '../lib/supabase';
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
 * Two screens notice a session ending now: the chat watches `activeSession`
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

/**
 * "Was I the MEMBER of that session?" — asked of the session row itself.
 *
 * Both screens that notice a session ending decide this from
 * `peerThread?.i_am_member ?? true` (`CallScreen`'s `isMemberSide`, and
 * `resolveChatV2Conversation` in `src/chat-v2/rows.ts` for the chat),
 * and the `?? true` is a hole: a conversation summary row that has not reached
 * this device yet reads as "I am the member". So a PROVIDER whose conversation
 * list is still loading — or whose list query failed, which is forever — is
 * handed a sheet inviting them to rate a member. Rating in this product runs one
 * way only (006's rule, restated in 066), so that sheet is not a Send button
 * that fails, it is a question the app must never have asked.
 *
 * The screens' optimism cannot simply be inverted: a member calling straight
 * from the directory may genuinely have no summary row yet, and defaulting the
 * other way would swallow the review after every first call — which is exactly
 * the call whose rating matters most. So the guess stays where the screens make
 * it, and the truth is read here, once, for whoever set `pendingReview`. Any
 * future caller inherits the gate without having to remember it.
 *
 * Race-free against the end it is asking about: `member_id` is written when the
 * row is inserted (`answer_call` 037:1008, `accept_session_request` 086:174) and
 * never changes, so it reads the same before and after `end_call` lands. SELECT
 * on paid_sessions is granted to BOTH participants ("Participants read own
 * sessions", 030:183), so the provider's client gets a real `false` rather than
 * an empty result it would have to interpret.
 *
 * Fails closed, and fails CLEARED. A row that cannot be read (offline, RLS)
 * yields no sheet — the member has lost one prompt about a session whose rating
 * could not have been submitted over that same dead connection anyway, where the
 * other direction puts the wrong question to the wrong person. The notice is
 * then dropped rather than left hanging, because the store keeps the FIRST
 * writer (useStore.ts:175): a `pendingReview` parked behind a read that will
 * never answer would swallow every session that ends after it, for the rest of
 * the app run.
 *
 * `staleTime: Infinity` — who the member of a finished session was is a fact
 * about the past, and the sheet may ask twice for one id (see `ASKED`).
 *
 * Nothing here runs until a session has actually ended. This sheet is mounted
 * for the whole life of the signed-in tree (App.tsx:1825), so a `useSelfId()`
 * beside the query — the obvious way to get the id to compare against — would
 * put an `auth.getUser()` round trip into every launch to serve a question
 * asked a few times a day. `getSession()` reads the stored session locally
 * instead, inside the queryFn, so the whole gate costs nothing until it is
 * needed. Local is enough for a client-side gate: the server still refuses a
 * review from anyone but the member (066:109), so this only decides what to
 * put on screen.
 */
function useWasTheMember(sessionId: string | null) {
  return useQuery<boolean>({
    queryKey: ['session', 'was-member', sessionId ?? ''],
    enabled: sessionId !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getSession();
      const selfId = auth.session?.user.id;
      if (selfId === undefined) {
        return false;
      }
      // paid_sessions is not in the generated types (read via RPC elsewhere);
      // cast the table read as `useSessionEvents` does (api/sessions.ts:515).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = (await (supabase as any)
        .from('paid_sessions')
        .select('member_id')
        .eq('id', sessionId)
        .maybeSingle()) as {
        data: { member_id: string } | null;
        error: { message: string } | null;
      };
      if (error) throw new Error(error.message);
      return data !== null && data.member_id === selfId;
    },
  });
}

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
  const { data: wasTheMember, isError: memberUnknown } = useWasTheMember(
    pending?.sessionId ?? null,
  );

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
    if (memberUnknown) {
      // The read gave up (it retries once). Drop the notice instead of parking
      // it: first-writer-wins would make a stuck `pendingReview` eat every
      // session that ends later in this run.
      clearReview();
      return;
    }
    if (wasTheMember === undefined) {
      // The row has not answered yet. Hold the notice — it is still pending, so
      // this effect runs again the moment the answer lands.
      return;
    }
    if (!wasTheMember) {
      // The provider's side of the session, or a session this account is not in
      // at all. Drop it silently: there is no member-rates-provider sheet to
      // show them and no second question to offer instead.
      clearReview();
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
  }, [pending, askedFor, wasTheMember, memberUnknown, clearReview]);

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
              {/* Filled by the fill glyph, not by colour alone.
                  The note that used to sit here said the icon font had one star
                  and that a hollow-vs-solid pair would be two glyphs that must
                  agree about their optical weight forever. That stopped being
                  true when the set gained a real fill: Phosphor's `star` and
                  `star-fill` are one family's two weights of one drawing, in
                  one font, so they cannot drift. Colour alone also failed the
                  rule that state must not be carried by hue on its own. */}
              <Icon
                name="star"
                active={on}
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
        entering={fadeSwapFast} exiting={fadeSwapOutFast}
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
