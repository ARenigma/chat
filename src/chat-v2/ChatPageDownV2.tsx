import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { springTo } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

/** Visual size. `Pressable`'s own `size` guarantees the 48dp target. */
const CONTROL = 40;

interface Props {
  visible: boolean;
  /** Peer rows that arrived while the member was reading history. */
  unreadBelow: number;
  onPress: () => void;
  testID?: string;
}

/**
 * Jump back to the newest message.
 *
 * MOTION, stated per RULE 6. Frequency: occasional — it appears when somebody
 * scrolls up through history, not on every keystroke, so it is in the standard
 * tier rather than the near-imperceptible one. Purpose: state indication (there
 * is something below you) and preventing a jarring change (a control that hard
 * cuts in over the transcript reads as a glitch). Properties: `opacity`,
 * `scale` and `translateY` only — all free, no Yoga pass. Thread: a shared
 * value and `useAnimatedStyle`, so a scroll that crosses the threshold
 * repeatedly costs no React render.
 *
 * It stays MOUNTED and animates instead of unmounting, which is the difference
 * between a spring that retargets and an entrance that restarts: scrolling
 * across the threshold is exactly the rapidly-toggled case where a keyframed
 * entrance replays from zero. `pointerEvents` follows `visible`, so an
 * invisible control cannot take a tap.
 *
 * `springTo` carries `ReduceMotion.System`, so under the OS setting it lands on
 * the final value rather than travelling — the movement goes, the state change
 * stays.
 */
function ChatPageDownV2View({ visible, unreadBelow, onPress, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const shown = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    shown.set(springTo(visible ? 1 : 0, 'snap'));
  }, [shown, visible]);

  const animated = useAnimatedStyle(() => {
    const t = shown.get();
    return {
      opacity: t,
      // Never from `scale(0)`: nothing in the real world appears from nothing.
      transform: [{ translateY: (1 - t) * 8 }, { scale: 0.9 + 0.1 * t }],
    };
  });

  return (
    <Animated.View
      style={[styles.host, animated]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {visible ? (
        <View
          testID="chat-v2-page-down-visible"
          style={styles.visibleMarker}
          pointerEvents="none"
          accessible={false}
        />
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={
          unreadBelow > 0
            ? `Jump to latest, ${unreadBelow} new`
            : 'Jump to latest'
        }
        press="chip"
        size={48}
        shape="circle"
        style={styles.control}
        onPress={onPress}
      >
        {/*
         * `arrowUp`, turned over. The icon set is generated from
         * `design/icons.json` and has no down arrow; adding one means
         * regenerating the font (RULE 4) AND choosing which arrow the brand
         * uses, which is a creative decision and not one to make silently
         * mid-feature. A 180° rotation of the glyph already in the set is the
         * same shape, exactly.
         */}
        <View style={styles.flip}>
          <Icon
            name="arrowUp"
            size={TOKENS.icon.md}
            color={theme.color.text.secondary}
          />
        </View>
      </Pressable>
      {unreadBelow > 0 ? (
        <View
          testID="chat-v2-page-down-badge"
          style={styles.badge}
          pointerEvents="none"
        >
          <Text allowFontScaling={false} style={styles.badgeLabel}>
            {unreadBelow > 99 ? '99+' : String(unreadBelow)}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

export const ChatPageDownV2 = memo(ChatPageDownV2View);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    host: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    visibleMarker: {
      position: 'absolute',
      width: 1,
      height: 1,
    },
    control: {
      width: CONTROL,
      height: CONTROL,
      alignItems: 'center',
      justifyContent: 'center',
      // Icon-only control: borderless (circular) ink, not the rectangular kind
      // the touch box would otherwise clip the state layer to.
      // https://developer.android.com/training/material/animations
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      elevation: 3,
    },
    flip: {
      transform: [{ rotate: '180deg' }],
    },
    // Sits on the control's top edge, the way an unread count sits on a tab
    // icon, so the glyph underneath keeps saying what the control does.
    badge: {
      position: 'absolute',
      top: -TOKENS.space['2xs'],
      minWidth: 18,
      height: 18,
      paddingHorizontal: TOKENS.space['2xs'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentStrong,
    },
    badgeLabel: {
      ...TOKENS.typography.numeralSmall,
      fontSize: 11,
      lineHeight: 14,
      color: t.color.text.onAccent,
    },
  });
