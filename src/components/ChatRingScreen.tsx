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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { formatClock } from '../lib/sessionClock';
import { useAcceptSessionRequest, useDeclineSessionRequest } from '../api/sessions';
import { clearConversation } from '../lib/conversations';
import {
  getRingingConversation,
  getViewingConversation,
  setRingingConversation,
} from '../lib/viewingConversation';
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

/**
 * Whether `requestId` is still the request ringing. An answer can land after
 * its own ring has run out and a newer request has started ringing, and the
 * store's clear is unconditional, so the Accept and Decline callbacks ask this
 * first rather than end a ring they were never pressed on.
 */
function stillRinging(requestId: string): boolean {
  return useStore.getState().incomingRequest?.requestId === requestId;
}

/** The server refused the Accept outright (086): nothing is left to answer. */
function acceptRefused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P0001' || code === 'P0007' || code === '42501';
}

/**
 * A different request for the same conversation is ringing now. The shade
 * entry is the conversation's, not the request's, so an answer to an older
 * request that lands late must not cancel it: that would take the newer,
 * unanswered request out of the shade (Greptile P1 on 03c9aae).
 */
function newerRequestRings(requestId: string, conversationId: string): boolean {
  const ringing = useStore.getState().incomingRequest;
  return (
    ringing !== null &&
    ringing !== undefined &&
    ringing.conversationId === conversationId &&
    ringing.requestId !== requestId
  );
}

/**
 * The ring has left, and if the chat it covered is this conversation, that
 * chat is now what the person is reading: `useViewingConversation`'s moment to
 * take the notification out of the shade, which that hook skips while the ring
 * covers it. Nothing for any other chat, or none, or an app not in use (the
 * viewing signal is clear then). Accepting from the ring opens the peer's
 * chat, and when that chat is already the screen underneath nothing mounts
 * again to do this clear.
 * https://developer.android.com/develop/ui/views/notifications/conversations#best-practices
 */
function clearIfUncovered(conversationId: string): void {
  if (getViewingConversation() === conversationId) {
    void clearConversation(conversationId);
  }
}

export function ChatRingScreen({ onOpenConversation }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const incoming = useStore(s => s.incomingRequest);
  const clearIncoming = useStore(s => s.clearIncomingRequest);
  const setNotice = useStore(s => s.setNotice);
  const accept = useAcceptSessionRequest();
  const decline = useDeclineSessionRequest();
  const [left, setLeft] = useState(CHAT_RING_SECONDS);
  /*
   * The request whose Decline is on the wire, or null. The clock does not stop
   * for it (`busy` only disables the buttons), and a ring that runs out
   * meanwhile must not take the notification with it: the provider's answer
   * has not landed, and if it fails the request is still pending with the
   * shade entry as one way back to it.
   */
  const declining = useRef<string | null>(null);

  // One clock, restarted per request. Ringing forever is how a provider learns
  // to ignore the screen.
  useEffect(() => {
    if (incoming === null) {
      return;
    }
    setLeft(CHAT_RING_SECONDS);
    const started = Date.now();
    const { conversationId, requestId } = incoming;
    /*
     * While this ring is up, a foreground push for its conversation is the
     * same event told twice, and a banner over the ring opened the chat
     * underneath it, so that push goes to the shade silently instead, with no
     * banner (`foregroundPushAction`), and is there if the provider leaves
     * before answering. Held for the ring's whole life, in use or not (see
     * `setRingingConversation` for why a departure does not drop it; a phone
     * locked mid-ring still alerts because the push decision tests `inUse`
     * first), and released only if it is still ours, `useViewingConversation`'s
     * rule, so a newer ring's claim survives an older one's cleanup.
     */
    const release = (): void => {
      if (getRingingConversation() === conversationId) {
        setRingingConversation(null);
      }
    };
    setRingingConversation(conversationId);
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const remaining = CHAT_RING_SECONDS - elapsed;
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        // The ring is off the screen from here, whenever the re-render lands.
        release();
        // Silence is not a decline: the request lives its full 24 hours and the
        // thread is still waiting in their list.
        clearIncoming();
        /*
         * A ring that runs out leaves the shade alone, watched or not.
         *
         * It used to clear the conversation's notification when the ring was
         * watched to the end, as a stale second telling of the request. But
         * the notification is the whole conversation's, and a message the
         * member sent while the opaque ring covered the chat was posted into
         * it silently and never seen (Greptile P1 on 1e845ce). The request
         * is still pending, so its entry is still true; it goes when the chat
         * is opened (`useViewingConversation`), or now if the chat the ring
         * was covering is the one on screen, since the person is looking at
         * every message in it (`clearIfUncovered`). Neither while a Decline is
         * on the wire (`declining`): that answer clears it itself if it lands.
         * https://developer.android.com/develop/ui/views/notifications/conversations#best-practices
         */
        if (declining.current === requestId) {
          return;
        }
        clearIfUncovered(conversationId);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      release();
    };
  }, [incoming, clearIncoming]);

  const onAccept = useCallback(() => {
    if (incoming === null) {
      return;
    }
    const { requestId, conversationId, peerId } = incoming;
    accept.mutate(
      { requestId, conversationId },
      {
        /*
         * On success they are in the conversation; on a refusal (Greptile P1
         * on 5cb4480) -- the request gone, answered elsewhere, expired, or not
         * this provider's (086's P0001 and P0007, and 42501) -- there is
         * nothing left to answer. Either way the ring ends, unless it already
         * ran out and another request rings now (`stillRinging`), and the chat
         * opens, so a notification the ring was covering goes when that chat
         * is on screen (`clearIfUncovered`), never one a newer request for
         * this conversation now owns (`newerRequestRings`).
         *
         * Anything else never reached the server, so the request is still
         * pending. That used to clear the notification anyway and leave the
         * provider nothing to answer it from. Now the ring stays up with its
         * buttons live again, the notification stays for after the ring, and
         * the notice says the press did not take.
         */
        onSuccess: () => finish(),
        onError: (error: unknown) => {
          if (acceptRefused(error)) {
            finish();
            return;
          }
          setNotice('Could not accept. Try again.');
        },
      },
    );
    function finish(): void {
      if (stillRinging(requestId)) {
        clearIncoming();
      }
      if (!newerRequestRings(requestId, conversationId)) {
        clearIfUncovered(conversationId);
      }
      onOpenConversation(peerId);
    }
  }, [incoming, accept, clearIncoming, onOpenConversation, setNotice]);

  const onDecline = useCallback(() => {
    if (incoming === null) {
      return;
    }
    const { requestId, conversationId } = incoming;
    declining.current = requestId;
    decline.mutate(
      { requestId, conversationId },
      {
        /*
         * Only once the server has taken it does the ring end, and its
         * notification with it: a Decline that landed is the provider having
         * seen and answered the request, which is the moment the platform
         * allows a conversation notification to be cancelled. The lock-screen
         * Decline already does the same in ChatRequestReceiver; this is the
         * in-app half. The ring is ended only if it is still this one
         * (`stillRinging`); the notification goes regardless, since the
         * answer it carried has landed, even after a ring-out left it there
         * (`declining`).
         * https://developer.android.com/develop/ui/views/notifications/conversations#best-practices
         */
        onSuccess: () => {
          if (stillRinging(requestId)) {
            clearIncoming();
          }
          if (!newerRequestRings(requestId, conversationId)) {
            void clearConversation(conversationId);
          }
        },
        /*
         * A failure is a Decline that never reached the server: the RPC
         * reports a request that is gone or already answered in its result,
         * not as an error, and only a transport or PostgREST error throws
         * (migration 082's decline_session_request). So the request is
         * still pending, and this used to clear the ring and the notification
         * regardless, leaving the provider nothing to answer it from while the
         * member waited. Now nothing is cleared: the ring stays up with both
         * buttons live again (`busy` falls back), the notification stays in the
         * shade for after the ring, and the notice says the press did not take.
         * If the ring ran out while the RPC was on the wire, there is no
         * button left to try again on, so the notice points to the thread,
         * which has its own Decline for the same request.
         * No motion of its own: the notice bar brings its own entrance.
         */
        onError: () => {
          setNotice(
            stillRinging(requestId)
              ? 'Could not decline. Try again.'
              : 'Could not decline. It is still waiting in the chat.',
          );
        },
        onSettled: () => {
          if (declining.current === requestId) {
            declining.current = null;
          }
        },
      },
    );
  }, [incoming, decline, clearIncoming, setNotice]);

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
          {`wants to chat · ${formatClock(Math.max(0, left))}`}
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
