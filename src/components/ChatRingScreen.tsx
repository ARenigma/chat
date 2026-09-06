/**
 * A chat request, ringing.
 *
 * Goal item 13 (Amit, 2026-09-05): "chat request like call ring, full screen
 * incoming". A member's first message creates a `session_requests` row that the
 * provider previously learned about as an unread badge — the same weight as any
 * other message, for the one event that is somebody waiting to be answered.
 *
 * Scope, stated. This is the IN-APP half: a full-screen accept/decline surface
 * that mirrors CallScreen's incoming phase. The out-of-app half is unchanged
 * and deliberately so — a chat request already sends the ordinary conversation
 * notification with the member's message, and this project decided on
 * 2026-08-27 that even a real CALL rings as a heads-up CallStyle notification
 * rather than a full-screen takeover (index.js:59). Making chat louder than
 * calls on the lock screen would invert that.
 *
 * Rings for 30 seconds, "like a call" (Amit, 2026-09-06). The REQUEST stays
 * pending its full 24 hours after that; only the ring stops, so a provider who
 * missed it still has the thread waiting. Nothing is declined by silence.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { formatClock } from '../lib/sessionClock';
import { useAcceptSessionRequest, useDeclineSessionRequest } from '../api/sessions';
import { useStore } from '../store/useStore';
import { Avatar } from './Avatar';
import { CallRing } from './CallRing';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

/** How long the ring lasts. A call's own window (send-call ttl '30s'). */
export const CHAT_RING_SECONDS = 30;

/** The largest face the Avatar scale defines. */
const RING_FACE = 88;

interface Props {
  /** Where to go when the provider accepts. */
  onOpenConversation: (peerId: string) => void;
}

export function ChatRingScreen({ onOpenConversation }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const incoming = useStore(s => s.incomingRequest);
  const clearIncoming = useStore(s => s.clearIncomingRequest);
  const accept = useAcceptSessionRequest();
  const decline = useDeclineSessionRequest();
  const [left, setLeft] = useState(CHAT_RING_SECONDS);

  // One clock, restarted per request. Ringing forever is how a provider learns
  // to ignore the screen.
  useEffect(() => {
    if (incoming === null) {
      return;
    }
    setLeft(CHAT_RING_SECONDS);
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const remaining = CHAT_RING_SECONDS - elapsed;
      setLeft(remaining);
      if (remaining <= 0) {
        // Silence is not a decline: the request lives its full 24 hours and the
        // thread is still waiting in their list.
        clearIncoming();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [incoming, clearIncoming]);

  const onAccept = useCallback(() => {
    if (incoming === null) {
      return;
    }
    const peerId = incoming.peerId;
    accept.mutate(
      { requestId: incoming.requestId, conversationId: incoming.conversationId },
      {
        // Either way the ring is over: on success they are in the conversation,
        // and on failure (expired, withdrawn) there is nothing left to answer.
        onSettled: () => {
          clearIncoming();
          onOpenConversation(peerId);
        },
      },
    );
  }, [incoming, accept, clearIncoming, onOpenConversation]);

  const onDecline = useCallback(() => {
    if (incoming === null) {
      return;
    }
    decline.mutate(
      { requestId: incoming.requestId, conversationId: incoming.conversationId },
      { onSettled: clearIncoming },
    );
  }, [incoming, decline, clearIncoming]);

  if (incoming === null) {
    return null;
  }

  const busy = accept.isPending || decline.isPending;

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + TOKENS.space.xl }]}
      testID="chat-ring">
      <View style={styles.head}>
        <Text allowFontScaling style={styles.kicker}>
          Chat request
        </Text>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          allowFontScaling
          style={styles.name}>
          {incoming.peerName}
        </Text>
        <Text allowFontScaling style={styles.sub} testID="chat-ring-countdown">
          {`wants to talk · ${formatClock(Math.max(0, left))}`}
        </Text>
      </View>

      {/* 88 is the largest face the Avatar scale defines, and CallScreen's
          incoming state uses the same one — a ring that is bigger than the app's
          own largest avatar would be a one-off size to maintain forever. */}
      <CallRing size={RING_FACE} active>
        <Avatar initial={initialOf(incoming.peerName)} size={RING_FACE} />
      </CallRing>

      <View style={styles.actions}>
        <RingAction
          testID="chat-ring-decline"
          glyph="close"
          label="Decline"
          tint={theme.color.text.onAccent}
          background={theme.color.state.danger}
          disabled={busy}
          onPress={onDecline}
        />
        <RingAction
          testID="chat-ring-accept"
          glyph="chat"
          label="Accept"
          tint={theme.color.text.onAccent}
          background={theme.color.state.available}
          disabled={busy}
          onPress={onAccept}
        />
      </View>
    </View>
  );
}

function RingAction({
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
        style={[styles.actionButton, { backgroundColor: background }]}>
        <Icon name={glyph} size={30} color={tint} />
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
      // Above every screen and both nav bars: an incoming ring is not a layer
      // in the stack, it is the thing that is happening.
      zIndex: 40,
      elevation: 40,
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
      color: t.color.text.secondary,
      textTransform: 'uppercase',
    },
    name: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    sub: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    actions: {
      flexDirection: 'row',
      gap: TOKENS.space['4xl'],
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
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
  });
