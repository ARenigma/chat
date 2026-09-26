/**
 * Idle-home suggestion prompt — the "calling"-style full-screen surface that
 * appears when a member idles on Home (migration 126, HOME_SUGGESTIONS_ENABLED).
 *
 * HomeSuggestionScreen since navigation step 6: already props-driven (the
 * suggestion in, Start and Not now out), renamed for the `HomeSuggestion`
 * route it becomes in step 7. Home still mounts it over itself until then.
 *
 * Amit chose "X is calling" copy even though the provider did not initiate the
 * contact (2026-09-20). The visual is full-screen like ChatRequestScreen but uses
 * different copy and button labels (Start / Not now) to distinguish it from a
 * real incoming chat request.
 *
 * This is rendered ONLY when HOME_SUGGESTIONS_ENABLED = true. The flag is
 * compile-time so R8 dead-strips the entire component in disabled builds.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HomeSuggestion } from '../api/homeSuggestions';
import { initialOf } from '../lib/display';
import { formatClock } from '../lib/sessionClock';
import { PROMPT_DURATION_S } from '../lib/homeSuggestions';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { CallRing } from './CallRing';
import { Pressable } from './Pressable';
import { Icon } from './Icon';

interface Props {
  suggestion: HomeSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}

const RING_FACE = 88;

export function HomeSuggestionScreen({ suggestion, onAccept, onDismiss }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [secondsLeft, setSecondsLeft] = useState(PROMPT_DURATION_S);

  useEffect(() => {
    setSecondsLeft(PROMPT_DURATION_S);
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const remaining = PROMPT_DURATION_S - elapsed;
      if (remaining <= 0) {
        clearInterval(timer);
        onDismiss();
        return;
      }
      setSecondsLeft(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [suggestion.provider_id, onDismiss]);

  const busy = false;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom + TOKENS.space.xl },
      ]}
      testID="home-suggestion-prompt"
    >
      <View style={styles.head}>
        <Text allowFontScaling style={styles.kicker}>
          Incoming call
        </Text>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          allowFontScaling
          style={styles.name}
          numberOfLines={1}
        >
          {suggestion.display_name}
        </Text>
        <Text allowFontScaling style={styles.sub} testID="home-suggestion-countdown">
          {`is calling · ${formatClock(Math.max(0, secondsLeft))}`}
        </Text>
      </View>

      <CallRing size={RING_FACE} active>
        <Avatar
          initial={initialOf(suggestion.display_name)}
          uri={suggestion.avatar_url}
          size={RING_FACE}
        />
      </CallRing>

      <View style={styles.actions}>
        <ActionButton
          testID="home-suggestion-dismiss"
          glyph="close"
          label="Not now"
          tint={theme.color.text.onState}
          background={theme.color.state.danger}
          disabled={busy}
          onPress={onDismiss}
        />
        <ActionButton
          testID="home-suggestion-accept"
          glyph="chat"
          label="Start"
          tint={theme.color.text.onState}
          background={theme.color.state.available}
          disabled={busy}
          onPress={onAccept}
        />
      </View>
    </View>
  );
}

function ActionButton({
  glyph,
  label,
  tint,
  background,
  onPress,
  disabled,
  testID,
}: {
  glyph: 'close' | 'chat';
  label: string;
  tint: string;
  background: string;
  onPress: () => void;
  disabled: boolean;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.actionSlot}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={label}
        press="button"
        style={[styles.actionButton, { backgroundColor: background }]}
      >
        <Icon name={glyph} size={TOKENS.icon.xl} color={tint} />
      </Pressable>
      <Text allowFontScaling style={styles.actionLabel}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      elevation: 50,
      backgroundColor: t.color.bg.base,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.xl,
    },
    head: {
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space['4xl'],
    },
    kicker: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.tertiary,
      textTransform: 'uppercase',
    },
    name: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    sub: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: TOKENS.space['2xl'],
      paddingBottom: TOKENS.space.xl,
    },
    actionSlot: {
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    actionButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
    },
  });
