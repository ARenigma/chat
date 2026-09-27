/**
 * The two story routes (nav-migration §2's thin adapter shape).
 *
 * StoryViewer is registered in BOTH trees: members watch listed providers,
 * a provider watches their own. StoryCreate is in the provider tree only, so
 * no member route can reach it by construction (ADR-0002's rule for trees).
 *
 * Both hide the bottom bar (`minimalShell`): the viewer is full-screen, and
 * the create flow ends in a single Post button that the bar would crowd.
 */
import React, { useCallback } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import * as Layout from '../../components/Layout';
import { useOpenChat } from '../../hooks/useOpenChat';
import type { AllNavigatorParams } from '../../lib/routes/types';
import { StoryCreateScreen } from '../StoryCreateScreen';
import { StoryViewerScreen } from '../StoryViewerScreen';

type RouteProps<Name extends keyof AllNavigatorParams> = NativeStackScreenProps<AllNavigatorParams, Name>;

export function StoryViewerRoute({ navigation, route }: RouteProps<'StoryViewer'>) {
  const openChat = useOpenChat();
  const onClose = useCallback(() => {
    if (navigation.isFocused() && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);
  // The paid chat, in the viewer's place: back from the chat returns to where
  // the stories were opened, not to a story that has moved on.
  const onOpenChat = useCallback(
    (peerId: string) => {
      navigation.goBack();
      openChat(peerId);
    },
    [navigation, openChat],
  );
  return (
    <Layout.Screen minimalShell>
      <StoryViewerScreen
        providerIds={route.params.providerIds}
        startProviderId={route.params.startProviderId}
        onClose={onClose}
        onOpenChat={onOpenChat}
      />
    </Layout.Screen>
  );
}

export function StoryCreateRoute({ navigation }: RouteProps<'StoryCreate'>) {
  const back = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);
  return (
    <Layout.Screen minimalShell>
      <StoryCreateScreen onBack={back} onPosted={back} />
    </Layout.Screen>
  );
}
