import React, { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CallRecord } from '../api/chat';
import { Icon, ICON_SCALE } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { chatV2CallModel, type ChatV2CallPermissions } from './cells';

/**
 * Android's minimum touch target, and the reason this row has a `minHeight` at
 * all: the pill inside it is caption-sized, so without a floor the tappable
 * area would be about 28dp tall.
 * https://developer.android.com/develop/ui/views/touch-and-input/accessibility-touch-target
 */
const ROW_MIN_HEIGHT = 48;

interface Props {
  call: CallRecord;
  permissions: ChatV2CallPermissions;
  onCallBack: (medium: 'voice' | 'video') => void;
}

/**
 * A call in the transcript, as one line.
 *
 * Connected-and-ended is a muted log line, non-tappable. Missed, declined or
 * failed is the loud entry: danger tint, and the WHOLE row calls back — but
 * only when a call of that medium can actually start right now, so the tap
 * never dead-ends. Every one of those decisions is `chatV2CallModel`'s, and
 * asserted as values; this file only paints the answer.
 *
 * The "Tap to call back" caption V1 printed under the label is gone. It
 * explained an affordance the row already has, and it made the row two
 * different heights depending on whether calling happened to be switched on.
 * It survives where it is actually needed — in the accessibility label, read to
 * the people who cannot see that the row is pressable.
 */
function ChatCallRowV2View({ call, permissions, onCallBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const model = chatV2CallModel(call, permissions);
  // A call is a session, so it takes the session row's green (Amit,
  // 2026-10-03: "have it just like chat session"); a missed one stays danger.
  const tint =
    model.tone === 'danger'
      ? theme.color.state.danger
      : theme.color.text.available;

  const callBack = useCallback(() => {
    onCallBack(model.medium);
  }, [model.medium, onCallBack]);

  const body = (
    <View style={styles.pill}>
      {/* A call that connected was a session, so it carries the session
          heart, as a chat session's row does (Amit, 2026-10-03). One that
          never connected keeps its glyph, in danger ink. */}
      {model.tone === 'danger' ? (
        <Icon name={model.icon} size={TOKENS.icon.xs} color={tint} />
      ) : (
        <Text allowFontScaling={false} style={styles.emoji}>
          🧡
        </Text>
      )}
      <Text
        testID="chat-v2-call"
        allowFontScaling
        numberOfLines={1}
        style={[
          styles.label,
          model.tone === 'danger' ? styles.labelDanger : null,
        ]}
      >
        {model.label}
      </Text>
    </View>
  );

  if (!model.tappable) {
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={model.accessibilityLabel}
      >
        {body}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        testID="chat-v2-call-back"
        accessibilityRole="button"
        accessibilityLabel={model.accessibilityLabel}
        press="none"
        highlight="dim"
        style={styles.target}
        onPress={callBack}
      >
        {body}
      </Pressable>
    </View>
  );
}

export const ChatCallRowV2 = memo(ChatCallRowV2View);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      width: '100%',
      minHeight: ROW_MIN_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: TOKENS.space['2xs'],
    },
    target: {
      minHeight: ROW_MIN_HEIGHT,
      justifyContent: 'center',
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
    },
    // The label sits on `bg/raised`, a known background, rather than on the
    // patterned wallpaper — which is what the contrast figures are measured on.
    // The same card as SystemMessageRow, so the two read as one kind of row.
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.raised,
    },
    // Same box as SystemMessageRow's emoji, so the two hearts match.
    emoji: {
      fontSize: Math.round(TOKENS.icon.xs * ICON_SCALE),
      lineHeight: Math.round(TOKENS.icon.xs * ICON_SCALE * 1.2),
    },
    label: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.available,
    },
    // 7.25:1 light / 6.14:1 dark on bg/sunken.
    labelDanger: {
      color: t.color.state.danger,
    },
  });
