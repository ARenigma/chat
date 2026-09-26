/**
 * The band between the header and the transcript: what this session costs, how
 * much of it is left, and the one control that does something about it.
 *
 * At most one of the two money surfaces is ever up — `chatV2SessionBand`
 * decides which, and the rules are asserted there as values. This file only
 * draws them, plus the persistent "they know you are here" line, which is a
 * STATE of the conversation rather than an event and so is a bar rather than a
 * four-second notice.
 *
 * No keyboard component and no domain hook: the band sits above the keyboard
 * hierarchy and takes everything as props, so the screen keeps its single
 * layout authority.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { formatClock } from '../lib/sessionClock';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

interface Props {
  /** True when a real push went out to an away peer. Server-gated. */
  peerNotified: boolean;
  displayName: string;
  /** `chatV2SessionBand`'s answers, both of which cannot be true at once. */
  showExtend: boolean;
  showRecharge: boolean;
  /** Seconds left, from the server's snapshot aged locally. */
  remaining: number | null;
  onRecharge: () => void;
  onDismissExtend: () => void;
}

export function ChatSessionBarV2({
  peerNotified,
  displayName,
  showExtend,
  showRecharge,
  remaining,
  onRecharge,
  onDismissExtend,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  return (
    <>
      {peerNotified ? (
        <View style={styles.notifiedBar} testID="chat-v2-peer-notified">
          <Text allowFontScaling style={styles.notifiedText}>
            {`${displayName} knows you are here.`}
          </Text>
        </View>
      ) : null}

      {showRecharge ? (
        <View style={[styles.talkBar, styles.talkBarLow]}>
          <View style={styles.talkDot} />
          {/*
           * ONE time display and no branch to choose it: the bar exists only
           * while the countdown is running, so this is always the ticking
           * m:ss. `allowFontScaling={false}` on purpose — a monospaced clock
           * that grows with the system font pushes Recharge off a 360dp bar,
           * and this is the one string read at a glance rather than read.
           */}
          <Text
            allowFontScaling={false}
            testID="chat-v2-session-timer"
            style={styles.talkTimer}
          >
            {formatClock(remaining ?? 0)}
          </Text>
          <Text allowFontScaling style={styles.talkText}>
            left
          </Text>
          {/* Recharge, not End: End is in the header, live for the whole
              session rather than only its last five minutes. */}
          <Pressable
            onPress={onRecharge}
            testID="chat-v2-recharge"
            accessibilityLabel="Recharge"
            press="chip"
            style={styles.talkRecharge}
          >
            <Text allowFontScaling style={styles.talkRechargeLabel}>
              Recharge
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showExtend ? (
        <View style={styles.extendCard}>
          {/* The card carries the countdown because it OWNS this band while it
              is up, and the recharge bar — the only other place the numerals
              appear — is hidden for exactly as long. Asking "need more time?"
              without printing the answer is the worst of both. */}
          <View style={styles.extendCardContent}>
            <View style={styles.extendCardHeadline}>
              <Text
                allowFontScaling={false}
                testID="chat-v2-extend-timer"
                style={styles.extendCardTimer}
              >
                {formatClock(remaining ?? 0)}
              </Text>
              <Text allowFontScaling style={styles.extendCardTitle}>
                left
              </Text>
            </View>
            <Text allowFontScaling style={styles.extendCardSubtitle}>
              Extend this match to keep talking
            </Text>
          </View>
          <Pressable
            onPress={onRecharge}
            testID="chat-v2-extend-refill"
            accessibilityLabel="Extend talk time"
            press="chip"
            style={styles.extendCardButton}
          >
            <Text allowFontScaling style={styles.extendCardButtonLabel}>
              Extend
            </Text>
          </Pressable>
          <Pressable
            onPress={onDismissExtend}
            testID="chat-v2-extend-dismiss"
            accessibilityLabel="Dismiss extend card"
            press="none"
            highlight="dim"
            size={28}
            // Circle, not the square touch box: this box sets no radius, so a
            // `dim` fill would paint a solid 28dp square behind a 12pt glyph.
            shape="circle"
            style={styles.extendCardClose}
          >
            <Icon
              name="close"
              size={TOKENS.icon.xs}
              color={theme.color.text.secondary}
            />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    notifiedBar: {
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
      backgroundColor: t.color.bg.sunken,
    },
    notifiedText: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    talkBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
    },
    // Scarcity keeps its coral wash: it is the same signal the balance pill and
    // the recharge banner use, and the one thing here worth a tint.
    talkBarLow: {
      backgroundColor: t.color.bg.accentTint,
    },
    // text/accent, not bg/accent: the wash is step 900 in dark (2026-09-27)
    // and step 500 on it is 2.87:1, under the 3:1 non-text floor
    // (developer.android.com/guide/topics/ui/accessibility/apps). text/accent
    // is 500 in light (4.46:1 on the step-50 wash, unchanged) and 300 in dark
    // (6.16:1). Registered in scripts/check-contrast.mjs.
    talkDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.color.text.accent,
    },
    talkTimer: {
      ...TOKENS.typography.numeralMedium,
      color: t.color.text.primary,
      minWidth: 42,
    },
    talkText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      flex: 1,
    },
    talkRecharge: {
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentStrong,
    },
    talkRechargeLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
    },
    extendCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.accentTint,
    },
    extendCardContent: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    extendCardHeadline: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: TOKENS.space['2xs'],
    },
    extendCardTimer: {
      ...TOKENS.typography.numeralMedium,
      color: t.color.text.primary,
    },
    extendCardTitle: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    extendCardSubtitle: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    extendCardButton: {
      paddingHorizontal: TOKENS.space.md,
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentStrong,
    },
    extendCardButtonLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
    },
    extendCardClose: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
