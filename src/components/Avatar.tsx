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

type Size = 26 | 30 | 34 | 42 | 56;

interface Props {
  initial: string;
  size?: Size;
  /**
   * `warm` applies the coral wash. It marks *your* side of things — the mark on
   * the empty state, the person you are already talking to — never a provider in
   * the directory, where washing one avatar coral would read as a recommendation
   * nobody made.
   */
  tone?: 'neutral' | 'warm' | 'positive';
  online?: boolean;
  /** Slow breathing scale, so the mark reads as present rather than static. */
  breathing?: boolean;
  testID?: string;
}

const FONT: Record<Size, number> = { 26: 11, 30: 12, 34: 13, 42: 15, 56: 20 };

/**
 * The breath is a real sine, not two linear ramps.
 *
 * `withRepeat(..., -1, true)` reverses the same eased curve instead of replaying
 * it, so velocity at the turning points is zero and there is no visible tick at
 * the top and bottom of the cycle. With `Easing.inOut(Easing.sin)` the result is
 * a genuine sinusoid — which is what breathing is, and the difference is obvious
 * once you have seen the linear version tick.
 *
 * 2% amplitude over four seconds. Anything larger stops reading as breathing and
 * starts reading as a pulse animation, which is a notification, not a presence.
 */
function AvatarView({
  initial,
  size = 42,
  tone = 'neutral',
  online = false,
  breathing = false,
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

  const dot = size <= 30 ? 10 : 13;
  const fill =
    tone === 'warm'
      ? theme.color.bg.accentTint
      : tone === 'positive'
        ? theme.color.bg.positive
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
      {online ? <PresenceDot size={dot} /> : null}
    </Animated.View>
  );
}

/**
 * Static, deliberately.
 *
 * This dot used to pulse — scale 0.86 to 1.0 and opacity 0.72 to 1.0, forever —
 * and the comment here argued that "a static dot says marked available, a
 * breathing one says someone is there". That was the problem, not the feature.
 * The dot renders a stored boolean (`is_available`); nobody is necessarily doing
 * anything. Animating it manufactures a sense of a person waiting, and in a
 * product where a lonely user spends tokens to start a conversation, that is not
 * a decorative flourish — it is a nudge built on something we do not know.
 *
 * The file also contradicted itself: AvatarView's own comment fixes the breath
 * at 2% because "anything larger stops reading as breathing and starts reading
 * as a pulse animation, which is a notification, not a presence." The dot was
 * running 14% scale and 28% opacity.
 *
 * Genuinely live activity already has an honest channel: PeerTyping, which
 * animates because someone is actually typing at that moment.
 */
function PresenceDot({ size }: { size: number }) {
  const styles = useStyles(makeStyles);
  const inner = size - 4;
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
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
  ring: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.base,
  },
  dot: {
    backgroundColor: t.color.state.available,
  },
});
