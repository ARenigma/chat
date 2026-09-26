/**
 * The `Chat` and `ChatV2` routes, both trees: the chat's single exit.
 *
 * Removal is guarded here, not in the screen (nav-migration §4, 3a;
 * https://reactnavigation.org/docs/preventing-going-back). The guard is on
 * while a paid session is live or a reply strip is open, and it tells the ways
 * a chat can be left apart:
 * - hardware back is the NavigationContainer's GO_BACK, which carries no
 *   `source`; nothing else in the app dispatches one (a contract pin forbids
 *   `navigationRef.goBack()`). It clears an open reply first; the header
 *   arrow never does, and leaves even with a reply open;
 * - an unpaid removal proceeds at once, dropping the draft (an intentional
 *   exit, as the arrow's `leaveChat` does);
 * - a paid removal keeps its own action (`pendingExit`) and opens the leave
 *   dialog; confirming ends the session, asks for the review, and `exit`
 *   replays that one action. `leaving` lets that confirmed exit through the
 *   guard exactly once (A1).
 *
 * Hooks that died with the old tree's unmount die when the chat stops being
 * live (`useChatLive`, ruling 9); the blur cleanup in the screen closes its
 * Modals, the IME and voice playback when it is covered (A4).
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect, useIsFocused, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import * as Layout from '../../components/Layout';
import { ChatScreenV2, type ChatV2Guard } from '../../chat-v2/ChatScreenV2';
import { useDismissKeyboardOnBlur } from '../../hooks/useDismissKeyboardOnBlur';
import { useNavigationDeduped } from '../../hooks/useNavigationDeduped';
import { setFocusedChat } from '../../lib/routes/focusedChat';
import { startCall } from '../../lib/routes/actions';
import type { AllNavigatorParams } from '../../lib/routes/types';
import { useChatLive } from '../../lib/routes/useChatLive';
import { useStore } from '../../store/useStore';
import { useSignedInActions } from './signedIn';

type Props =
  | NativeStackScreenProps<AllNavigatorParams, 'Chat'>
  | NativeStackScreenProps<AllNavigatorParams, 'ChatV2'>;

export function ChatRoute({ navigation, route }: Props) {
  const { role } = useSignedInActions();
  const { peerId } = route.params;
  const benchmarkReadOnly =
    route.name === 'ChatV2' ? (route.params as AllNavigatorParams['ChatV2']).benchmarkReadOnly : false;
  const live = useChatLive();
  const focused = useIsFocused();
  const nav = useNavigationDeduped();
  const resetConversation = useStore(s => s.resetConversation);
  useDismissKeyboardOnBlur();

  // The screen publishes what the guard reads; a ref, because the guard's
  // callback runs outside render and must see the latest.
  const guardRef = useRef<ChatV2Guard | null>(null);
  const [guard, setGuard] = React.useState<ChatV2Guard | null>(null);
  const onGuard = useCallback((next: ChatV2Guard) => {
    guardRef.current = next;
    setGuard(next);
  }, []);

  const leaving = useRef(false);
  const pendingExit = useRef<(() => void) | null>(null);

  // Every exit, confirmed or not, comes through here: the screen's `onBack`
  // (`leaveChat` after an unpaid arrow or a confirmed leave dialog).
  const exit = useCallback(() => {
    leaving.current = true;
    const go = pendingExit.current ?? (() => navigation.goBack());
    pendingExit.current = null;
    go();
  }, [navigation]);

  const sessionActive = guard?.sessionActive === true;
  const replyActive = guard?.replyActive === true;
  usePreventRemove(sessionActive || replyActive, ({ data }) => {
    const current = guardRef.current;
    if (leaving.current || current === null) {
      navigation.dispatch(data.action);
      return;
    }
    const hardwareBack = data.action.type === 'GO_BACK' && data.action.source === undefined;
    if (hardwareBack && current.replyActive) {
      current.clearReply();
      return;
    }
    if (!current.sessionActive) {
      current.purgeDraft();
      leaving.current = true;
      navigation.dispatch(data.action);
      return;
    }
    // A programmatic replace or pop keeps its own action for after the confirm.
    pendingExit.current = () => navigation.dispatch(data.action);
    current.openLeave('leave');
  });

  // A leave dialog closed without leaving drops the exit it was holding.
  const leaveVisible = guard?.leaveVisible === true;
  useEffect(() => {
    if (!leaveVisible && !leaving.current) {
      pendingExit.current = null;
    }
  }, [leaveVisible]);

  /*
   * Focused, this chat is the one an intent would walk away from (a tab
   * switch keeps it mounted, so no removal fires): it answers `requestAway`
   * with the same dialog, and proceeds once the paid session is ended.
   * `leaving` resets on focus, so a chat left by a tab switch and returned to
   * is guarded again.
   */
  useFocusEffect(
    useCallback(() => {
      leaving.current = false;
      return setFocusedChat({
        peerId,
        requestAway: proceed => {
          const current = guardRef.current;
          if (current === null || !current.sessionActive) {
            proceed();
            return;
          }
          pendingExit.current = proceed;
          current.openLeave('leave');
        },
      });
    }, [peerId]),
  );

  // Peer activity is keyed by conversation; the one this chat showed is reset
  // when the chat is gone (nav-migration §5).
  const conversationRef = useRef<string | undefined>(undefined);
  conversationRef.current = guard?.conversationId;
  useEffect(
    () => () => {
      if (conversationRef.current !== undefined) {
        resetConversation(conversationRef.current);
      }
    },
    [resetConversation],
  );

  const onStartCall = useCallback(
    (channel: 'audio' | 'video') => startCall(peerId, channel === 'video' ? 'video' : 'voice'),
    [peerId],
  );
  const onOpenProfile = useCallback(
    // Full page from inside a chat, never the discovery sheet (Amit, 2026-09-27).
    (id: string) => nav.push('ProviderProfile', { providerId: id }),
    [nav],
  );
  const onOpenEarnings = useCallback(() => nav.push('Usage'), [nav]);

  return (
    <Layout.Screen minimalShell>
      <ChatScreenV2
        providerId={peerId}
        benchmarkReadOnly={benchmarkReadOnly}
        onBack={exit}
        onStartCall={benchmarkReadOnly ? undefined : onStartCall}
        // The member tree's peer has a profile; the provider tree's is a
        // member, whose identity block opens the safety sheet instead.
        onOpenProfile={role === 'member' && route.name === 'Chat' ? onOpenProfile : undefined}
        onOpenEarnings={role === 'provider' ? onOpenEarnings : undefined}
        live={live}
        focused={focused}
        onGuard={onGuard}
      />
    </Layout.Screen>
  );
}
