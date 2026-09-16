import React, { memo, useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION, EASE_BREATHE } from '../theme/motion';
import { avatarImageSource, clayFraming, isClayUri } from '../lib/clayAvatars';

/**
 * 40 replaces 42, and that is a platform number rather than a rounder one: iOS
 * Messages and Contacts both use 40 in a list row, so the two lists in this app
 * agree with the platform instead of with each other by a couple of points.
 * `ROW_SEPARATOR_INSET` derives from it, which is the point of exporting
 * `ROW_AVATAR`.
 */
/*
 * A closed union rather than `number`, so a new size is a decision someone
 * makes once here instead of a literal that drifts across screens.
 *
 * 42 joins it for the chat header (2026-09-07). It is the reference's value,
 * not a nudge: `ChatAvatarContainer` sets
 * `avatarImageView.setRoundRadius(dp(21))` (:265), and a circular avatar's
 * round radius is half its side. The header had been using 30 — a LIST ROW
 * size — which is what read as too small.
 */
type Size = 26 | 30 | 34 | 40 | 42 | 48 | 56 | 76 | 88;

interface Props {
  initial: string;
  /**
   * A profile photo. When present it covers the initial once loaded; the initial
   * stays underneath as the fallback (and shows while the photo loads, or forever
   * if there is no photo). The presence dot still paints on top.
   */
  uri?: string | null;
  size?: Size;
  /**
   * `warm` applies the coral wash. It marks *your* side of things, the mark on
   * the empty state, the person you are already talking to, never a provider in
   * the directory, where washing one avatar coral would read as a recommendation
   * nobody made.
   */
  tone?: 'neutral' | 'warm' | 'positive';
  online?: boolean;
  /** Slow breathing scale, so the mark reads as present rather than static. */
  breathing?: boolean;
  /**
   * Which surface the avatar is sitting on, so the presence dot's ring can match
   * it.
   *
   * The ring exists to cut the green circle away from whatever is behind it, and
   * it can only do that if it is painted in that thing's colour. It was
   * hardcoded to `bg/base`, which was right while every avatar sat on the page,
   * and became a white hole punched in the corner of a `ThreadBubble` the moment
   * one sat on `bg/sunken`. Naming the surface rather than passing a colour keeps
   * the choice inside the theme.
   */
  surface?: 'base' | 'sunken';
  testID?: string;
}

const FONT: Record<Size, number> = {
  26: 11,
  30: 12,
  34: 13,
  40: 15,
  // 16 sits on the line the neighbours already describe: the map runs at very
  // close to 0.375x the diameter (40->15, 48->18), and 42*0.375 = 15.75.
  42: 16,
  48: 18,
  56: 20,
  76: 27,
  88: 31,
};

/**
 * The presence dot's outer diameter, ring included. The green circle is this
 * minus the 4pt the ring costs.
 *
 * A map rather than the `size <= 30 ? 10 : 13` it replaces, because 48 broke the
 * two-branch version: Figma measures a 12pt circle on a 48pt avatar, which is 16
 * here, and 13 was neither the old answer nor the new one. Every other value is
 * exactly what the ternary produced, so nothing but 48 moves.
 */
const DOT: Record<Size, number> = {
  26: 10,
  30: 10,
  34: 13,
  40: 13,
  // 13, with 40 rather than with 48. The dot is a presence mark, not a
  // proportion: 48 is the one avatar Figma measured a bigger circle on, and 42
  // is nearer the row sizes that all carry 13.
  42: 13,
  48: 16,
  56: 13,
  76: 18,
  88: 20,
};

/**
 * The breath is a real sine, not two linear ramps.
 *
 * `withRepeat(..., -1, true)` reverses the same eased curve instead of replaying
 * it, so velocity at the turning points is zero and there is no visible tick at
 * the top and bottom of the cycle. With `Easing.inOut(Easing.sin)` the result is
 * a genuine sinusoid, which is what breathing is, and the difference is obvious
 * once you have seen the linear version tick.
 *
 * 2% amplitude over four seconds. Anything larger stops reading as breathing and
 * starts reading as a pulse animation, which is a notification, not a presence.
 */
function AvatarView({
  initial,
  uri,
  size = 40,
  tone = 'neutral',
  online = false,
  breathing = false,
  surface = 'base',
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!breathing) {
      // Cancel explicitly so the loop stops when the prop flips false, not just
      // when the effect re-runs and hits the early return without a cleanup.
      cancelAnimation(breath);
      return;
    }
    breath.value = withRepeat(
      withTiming(1, {
        duration: DURATION.breath / 2,
        // Curve from EASE_BREATHE (motion.ts) — Easing.inOut(Easing.sin) — the
        // same curve, now named so the module stays the single source of truth.
        easing: EASE_BREATHE,
      }),
      -1,
      true,
      undefined,
      // ReduceMotion.System: a scale transform must collapse under the OS
      // "reduce motion" flag. The signal (the avatar is live) is carried by the
      // presence dot; the breathing is the decorative layer. Pattern from
      // Skeleton.tsx:43 — withRepeat's 5th positional arg is reduceMotion.
      ReduceMotion.System,
    );
    // Cancel on unmount so the loop cannot outlive the component.
    return () => cancelAnimation(breath);
  }, [breathing, breath]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.02 }],
  }));

  const dot = DOT[size];
  const photo = avatarImageSource(uri, size, size, 75);
  const fill =
    tone === 'warm'
      ? theme.color.bg.accentTint
      : tone === 'positive'
        ? theme.color.bg.positive
        : // The neutral wash follows the surface for the same reason the presence
          // ring does, and it is the same bug one layer in: `bg/sunken` on a
          // `bg/sunken` bubble is an avatar that is not there, leaving a bare
          // initial floating in the middle of the row. `bg/base` makes the disc
          // read as a hole punched in the bubble, which is also what the blocked
          // chip beside it does.
          //
          // This is the third appearance of "a fill that equals its background"
          // in this codebase: bg/raised on bg/base for the message bubble, then
          // for the thread bubble, now this. The pattern is always the same, a
          // token chosen for one surface reused on another.
          surface === 'sunken'
          ? theme.color.bg.base
          : theme.color.bg.sunken;

  return (
    // Overflow-visible wrapper. The presence dot sits at the disc's bottom-right
    // corner, which is OUTSIDE the circle — and on Android a View with
    // `borderRadius` clips its overflowing children to the rounded shape, so a
    // dot rendered inside the rounded disc came out sliced in half. Keeping the
    // rounding on an inner `disc` (which still clips the photo, as intended) and
    // rendering the dot as its sibling here lets the dot paint in full.
    <Animated.View
      testID={testID}
      style={[styles.host, { width: size, height: size }, animated]}>
      <View
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
        ]}>
        {/* lineHeight is overridden alongside fontSize, not left to the token: the
            label style ships a 17pt line box, which clips a 20pt initial at the
            56pt size and does it silently. */}
        <Text
          allowFontScaling={false}
          style={[
            styles.initial,
            { fontSize: FONT[size], lineHeight: Math.round(FONT[size] * 1.25) },
          ]}>
          {initial}
        </Text>
        {/* NOT held back behind a screen transition, and that is a decision.
            W5#6 named "avatar fetches" as a deferral site, and the mechanism
            exists (`useAfterTransition` in theme/motion.ts, used by Turn's
            photo bubbles). It is wrong here: this component's fallback is the
            person's INITIALS, which mean "no photo", not "loading". Holding the
            Image back would show initials for a few frames and then swap in a
            face — a content change that reads as the wrong person, which is
            worse than the decode it would save. Turn's photos have a designed
            grey placeholder and can be deferred; an identity cannot. */}
        {photo !== null ? (
          <Image
            source={photo}
            style={[
              styles.photo,
              { width: size, height: size, borderRadius: size / 2 },
              isClayUri(uri) && clayFraming(size),
            ]}
            resizeMode="cover"
            fadeDuration={0}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      {/*
        * The dot is ALWAYS drawn now — filled green when here, a grey ring when
        * not (Amit, 2026-09-13: "grey unfilled dot instead of green dot in DP").
        *
        * Absence used to carry the "away" meaning, which is the weakest signal
        * a UI has: nothing looks identical to not-loaded-yet, and on a grid of
        * faces a member cannot tell "nobody is here" from "presence is still
        * arriving". An unfilled dot says the same thing out loud, in the same
        * place, at the same size.
        */}
      <PresenceDot size={dot} surface={surface} here={online} />
    </Animated.View>
  );
}

/**
 * Static, deliberately.
 *
 * This dot used to pulse, scale 0.86 to 1.0 and opacity 0.72 to 1.0, forever,
 * and the comment here argued that "a static dot says marked available, a
 * breathing one says someone is there". That was the problem, not the feature.
 * The dot renders a stored boolean (`is_available`); nobody is necessarily doing
 * anything. Animating it manufactures a sense of a person waiting, and in a
 * product where a lonely user spends tokens to start a conversation, that is not
 * a decorative flourish, it is a nudge built on something we do not know.
 *
 * The file also contradicted itself: AvatarView's own comment fixes the breath
 * at 2% because "anything larger stops reading as breathing and starts reading
 * as a pulse animation, which is a notification, not a presence." The dot was
 * running 14% scale and 28% opacity.
 *
 * Genuinely live activity already has an honest channel: PeerTyping, which
 * animates because someone is actually typing at that moment.
 */
function PresenceDot({
  size,
  surface,
  here,
}: {
  size: number;
  surface: 'base' | 'sunken';
  here: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const inner = size - 4;
  return (
    <View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor:
            surface === 'sunken' ? theme.color.bg.sunken : theme.color.bg.base,
        },
      ]}>
      <View
        style={[
          { width: inner, height: inner, borderRadius: inner / 2 },
          here ? styles.dot : styles.dotAway,
        ]}
      />
    </View>
  );
}

export const Avatar = memo(AvatarView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
    // Explicit: the presence dot overflows the disc at the corner and must not
    // be clipped by this wrapper.
    overflow: 'visible',
  },
  // The rounded disc. overflow:hidden clips the photo to the circle; the dot is
  // a sibling of this, so it is not clipped.
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.primary,
  },
  // No `backgroundColor` here on purpose: it is the one property that has to
  // follow the surface the avatar was placed on, so it is passed in rather than
  // being a default that is silently wrong half the time.
  photo: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    backgroundColor: t.color.state.available,
  },
  /*
   * Away: an UNFILLED ring, not a grey disc.
   *
   * A grey disc reads as a third presence state — "here", "busy", "away" — and
   * we only have two. Hollow says "the same indicator, not lit", which is the
   * relationship the two states actually have. It is also why the border is
   * `border/strong` rather than a tint of the green: nothing about away is
   * green, and a desaturated green reads as a weak yes.
   */
  dotAway: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: t.color.border.strong,
  },
});
