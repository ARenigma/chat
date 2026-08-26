import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION } from '../theme/motion';

/**
 * 40 replaces 42, and that is a platform number rather than a rounder one: iOS
 * Messages and Contacts both use 40 in a list row, so the two lists in this app
 * agree with the platform instead of with each other by a couple of points.
 * `ROW_SEPARATOR_INSET` derives from it, which is the point of exporting
 * `ROW_AVATAR`.
 */
type Size = 26 | 30 | 34 | 40 | 48 | 56;

interface Props {
  initial: string;
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

const FONT: Record<Size, number> = { 26: 11, 30: 12, 34: 13, 40: 15, 48: 18, 56: 20 };

/**
 * The presence dot's outer diameter, ring included. The green circle is this
 * minus the 4pt the ring costs.
 *
 * A map rather than the `size <= 30 ? 10 : 13` it replaces, because 48 broke the
 * two-branch version: Figma measures a 12pt circle on a 48pt avatar, which is 16
 * here, and 13 was neither the old answer nor the new one. Every other value is
 * exactly what the ternary produced, so nothing but 48 moves.
 */
const DOT: Record<Size, number> = { 26: 10, 30: 10, 34: 13, 40: 13, 48: 16, 56: 13 };

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
      return;
    }
    breath.value = withRepeat(
      withTiming(1, {
        duration: DURATION.breath / 2,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [breathing, breath]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.02 }],
  }));

  const dot = DOT[size];
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
    <Animated.View
      testID={testID}
      style={[
        styles.host,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
        animated,
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
      {online ? <PresenceDot size={dot} surface={surface} /> : null}
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
}: {
  size: number;
  surface: 'base' | 'sunken';
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
      <View style={[{ width: inner, height: inner, borderRadius: inner / 2 }, styles.dot]} />
    </View>
  );
}

export const Avatar = memo(AvatarView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.primary,
  },
  // No `backgroundColor` here on purpose: it is the one property that has to
  // follow the surface the avatar was placed on, so it is passed in rather than
  // being a default that is silently wrong half the time.
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
});
