/**
 * The provider tree's route adapters (nav-migration §1, §2): the same thin
 * shape as MemberRoutes.tsx. The three tab roots are the screens step 6 split
 * out of ProviderHomeScreen; each carries the push gate, which covers the tab
 * while notifications are off, as it covered ProviderHome.
 */

import React, { useCallback, useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import * as Layout from '../../components/Layout';
import { ChatRequestScreen } from '../../components/ChatRequestScreen';
import { ProviderPushGate } from '../../components/ProviderPushGate';
import { ProviderChatsScreen } from '../ProviderChatsScreen';
import { ProviderSavedScreen } from '../ProviderSavedScreen';
import { ProviderYouScreen } from '../ProviderYouScreen';
import { ProviderBankScreen } from '../ProviderBankScreen';
import { useDismissKeyboardOnBlur } from '../../hooks/useDismissKeyboardOnBlur';
import { useNavigationDeduped } from '../../hooks/useNavigationDeduped';
import { useOpenChat } from '../../hooks/useOpenChat';
import { removeSelf } from '../../lib/routes/actions';
import type { AllNavigatorParams } from '../../lib/routes/types';
import { useStore } from '../../store/useStore';
import { useSignedInActions } from './signedIn';

type RouteProps<Name extends keyof AllNavigatorParams> = NativeStackScreenProps<AllNavigatorParams, Name>;

export function ChatsRoute() {
  const openChat = useOpenChat();
  return (
    <Layout.Screen>
      <ProviderPushGate />
      <ProviderChatsScreen onOpenConversation={openChat} />
    </Layout.Screen>
  );
}

export function SavedRoute() {
  const openChat = useOpenChat();
  return (
    <Layout.Screen>
      <ProviderPushGate />
      <ProviderSavedScreen onOpenConversation={openChat} />
    </Layout.Screen>
  );
}

export function ProviderYouRoute() {
  const nav = useNavigationDeduped();
  const { onSignedOut } = useSignedInActions();
  useDismissKeyboardOnBlur();
  return (
    <Layout.Screen>
      <ProviderPushGate />
      <ProviderYouScreen
        onOpenPayout={() => nav.push('Payout')}
        onOpenUsage={() => nav.push('Usage')}
        onOpenBlocked={() => nav.push('Blocked')}
        onSignedOut={onSignedOut}
        onDeleted={onSignedOut}
      />
    </Layout.Screen>
  );
}

export function PayoutRoute({ navigation }: RouteProps<'Payout'>) {
  return (
    <Layout.Screen>
      <ProviderBankScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

/**
 * The chat-request ring, pushed over whatever the provider was on (it was an
 * overlay at zIndex 40). It rings the store's request only while that is
 * still this route's `requestId`; once the request is answered, runs out or
 * is withdrawn, the store moves on and the route removes itself. Accept opens
 * the chat in this route's place. Hardware back leaves the ring without
 * declining (the request stays pending in the thread), and every removal
 * clears the ring's claim on the store, owner-checked by id.
 *
 * Watched only while focused: a covered ring (a call pushed over it) holds
 * its clock and its ringing claim, as `held` already did under a call.
 */
export function ChatRequestRoute({ navigation, route }: RouteProps<'ChatRequest'>) {
  const { requestId } = route.params;
  const request = useStore(s =>
    s.incomingRequest?.requestId === requestId ? s.incomingRequest : null,
  );
  const focused = useIsFocused();
  const openAccepted = useOpenChat('requestAccept');

  useEffect(() => {
    if (request === null) {
      removeSelf(route.key, navigation.getState().key);
    }
  }, [request, navigation, route.key]);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        useStore.getState().clearIncomingRequest(requestId);
      }),
    [navigation, requestId],
  );

  /*
   * Where an accepted request goes: its chat, in the ring's place, except
   * over a call. The ring is held while a call is up (intents hold it; a
   * covered ring is `held`), but an Accept pressed before a call was routed
   * can land after it, and opening the chat then would pop or bury the live
   * call. The chat is in the list, and the notice says so.
   */
  const onOpenConversation = useCallback(
    (peerId: string) => {
      if (useStore.getState().activeCall !== null) {
        useStore.getState().setNotice('Accepted. The chat is waiting in your list.', 'confirm');
        removeSelf(route.key, navigation.getState().key);
        return;
      }
      openAccepted(peerId, route.key);
    },
    [openAccepted, route.key, navigation],
  );

  return (
    <Layout.Screen minimalShell>
      <ChatRequestScreen request={request} onOpenConversation={onOpenConversation} held={!focused} />
    </Layout.Screen>
  );
}
