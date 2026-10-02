/**
 * The member tree's route adapters (nav-migration §1, §2).
 *
 * Each is a thin component: it takes the route's props, renders
 * `Layout.Screen` (minimal shell where the bar must go), and translates params
 * and `navigation` into the screen's existing callback props. The screens stay
 * navigation-agnostic; the graph lives in these files and in Navigation.tsx.
 *
 * Forward navigation goes through `useNavigationDeduped` (a double tap pushes
 * once); a pop is the route's own `navigation.goBack()`, which is also what
 * hardware back does, because Up and Back are identical within an app
 * (https://developer.android.com/guide/navigation/principles). Programmatic
 * removals are `removeSelf`, targeted and never deduped.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useIsFocused, useNavigationState, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';

import * as Layout from '../../components/Layout';
import { HomeSuggestionScreen } from '../../components/HomeSuggestionScreen';
import { HomeScreen } from '../HomeScreen';
import { FavouritesScreen } from '../FavouritesScreen';
import { CallsScreen } from '../CallsScreen';
import { AppearanceScreen } from '../AppearanceScreen';
import { SettingsSheet } from '../SettingsSheet';
import { ChatsListScreen } from '../ChatsListScreen';
import { ProviderDetailScreen } from '../ProviderDetailScreen';
import { WalletScreen } from '../RechargeScreen';
import { ProviderApplicationScreen, type ApplyGuard } from '../ProviderApplicationScreen';
import { ProviderStatusScreen } from '../ProviderStatusScreen';
import { BlockedUsersScreen } from '../BlockedUsersScreen';
import { UsageLedgerScreen } from '../UsageLedgerScreen';
import { InvoicesScreen } from '../InvoicesScreen';
import { TransactionHistoryScreen } from '../TransactionHistoryScreen';
import { useDismissKeyboardOnBlur } from '../../hooks/useDismissKeyboardOnBlur';
import { useNavigationDeduped } from '../../hooks/useNavigationDeduped';
import { useOpenChat } from '../../hooks/useOpenChat';
import { removeSelf, startCall } from '../../lib/routes/actions';
import type { AllNavigatorParams } from '../../lib/routes/types';
import { PROVIDER_INTENT_KEY } from '../../lib/providerIntent';
import { storage } from '../../lib/storage';
import { track } from '../../lib/telemetry';
import { useStore } from '../../store/useStore';
import { useHomeSuggestionPrompt } from '../../store/useHomeSuggestionPrompt';
import { useSignedInActions } from './signedIn';

type RouteProps<Name extends keyof AllNavigatorParams> = NativeStackScreenProps<AllNavigatorParams, Name>;

/** Opens a profile sheet over the focused screen. */
function useOpenProvider(): (providerId: string) => void {
  const nav = useNavigationDeduped();
  return useCallback(
    (providerId: string) => {
      track('directory_viewed');
      nav.push('ProviderDetail', { providerId });
    },
    [nav],
  );
}

// ---------------------------------------------------------------------------
// Tab roots
// ---------------------------------------------------------------------------

export function HomeRoute({ navigation }: RouteProps<'Home'>) {
  const nav = useNavigationDeduped();
  const focused = useIsFocused();
  const hasActiveCall = useStore(s => s.activeCall !== null);
  const openChat = useOpenChat();
  const openSuggestionChat = useOpenChat('suggestionAccept');
  const onOpenProvider = useOpenProvider();
  useDismissKeyboardOnBlur();

  /*
   * The idle prompt is its own route over Home (nav-migration §2). Home's
   * campaign keeps running while that route covers it, so the campaign counts
   * Home as shown when either is focused; it is pushed only from a focused
   * Home, so a cold start into [Home, Chat] opens nothing over the chat.
   */
  const suggestionOnTop = useNavigationState(
    s => s.routes[s.index ?? s.routes.length - 1]?.name === 'HomeSuggestion',
  );
  const prompt = useHomeSuggestionPrompt(s => s.prompt);
  const promptId = prompt?.suggestion.provider_id ?? null;
  useEffect(() => {
    if (promptId !== null && focused) {
      nav.push('HomeSuggestion', { suggestionId: promptId });
    }
  }, [promptId, focused, nav]);
  const onSuggestionChat = useCallback(
    (providerId: string) => {
      const source = navigation.getState().routes.find(r => r.name === 'HomeSuggestion')?.key;
      openSuggestionChat(providerId, source);
    },
    [navigation, openSuggestionChat],
  );

  return (
    <Layout.Screen>
      <HomeScreen
        onOpenConversation={openChat}
        onOpenProvider={onOpenProvider}
        // The directory card's CTA rings straight from the list: the same
        // shape the profile's Call button places (CallScreen owns start_call).
        onCallProvider={id => startCall(id, 'voice')}
        onSeeAllChats={() => nav.push('ChatsList')}
        hasActiveCall={hasActiveCall}
        focused={focused}
        campaignFocused={focused || suggestionOnTop}
        onSuggestionChat={onSuggestionChat}
      />
    </Layout.Screen>
  );
}

export function FavouritesRoute() {
  const focused = useIsFocused();
  const onOpenProvider = useOpenProvider();
  useDismissKeyboardOnBlur();
  return (
    <Layout.Screen>
      <FavouritesScreen onOpenProvider={onOpenProvider} focused={focused} />
    </Layout.Screen>
  );
}

export function CallsRoute() {
  return (
    <Layout.Screen>
      <CallsScreen />
    </Layout.Screen>
  );
}

export function YouRoute() {
  const nav = useNavigationDeduped();
  const { onSignedOut } = useSignedInActions();
  useDismissKeyboardOnBlur();
  return (
    <Layout.Screen>
      <SettingsSheet
        // Deleting or signing out sets the boot phase to signedOut, which
        // unmounts the whole container: there is nothing to pop first.
        onDeleted={onSignedOut}
        onSignedOut={onSignedOut}
        onBlocked={() => nav.push('Blocked')}
        onTransactions={() => nav.push('Transactions')}
        onInvoices={() => nav.push('Invoices')}
        onUsage={() => nav.push('Usage')}
        onAppearance={() => nav.push('AppearanceSettings')}
      />
    </Layout.Screen>
  );
}

// ---------------------------------------------------------------------------
// Pushed screens
// ---------------------------------------------------------------------------

export function ChatsListRoute({ navigation }: RouteProps<'ChatsList'>) {
  const openChat = useOpenChat();
  return (
    <Layout.Screen>
      <ChatsListScreen onBack={() => navigation.goBack()} onOpenConversation={openChat} />
    </Layout.Screen>
  );
}

/**
 * The provider profile, a tall native sheet (owner 2026-09-26, ADR-0032).
 * Chat and Call from here take the sheet's place (`fromSheet`, and the
 * `replace` form of `startCall`), so back from the chat returns to where the
 * profile was opened from, and the sheet is never re-presented under a pop.
 * An existing chat with this provider is returned to instead (one chat per
 * peer), which pops the sheet with it when it sits above that chat.
 */
export function ProviderDetailRoute({ navigation, route }: RouteProps<'ProviderDetail'>) {
  const openChat = useOpenChat('fromSheet');
  const onOpenChat = useCallback(
    (providerId: string) => openChat(providerId, route.key),
    [openChat, route.key],
  );
  const onStartCall = useCallback(
    (providerId: string, channel: 'audio' | 'video') =>
      startCall(providerId, channel === 'video' ? 'video' : 'voice', {
        source: route.key,
        target: navigation.getState().key,
      }),
    [navigation, route.key],
  );
  return (
    <Layout.Screen sheet minimalShell>
      <ProviderDetailScreen
        sheet
        providerId={route.params.providerId}
        onBack={() => navigation.goBack()}
        onOpenChat={onOpenChat}
        onStartCall={onStartCall}
      />
    </Layout.Screen>
  );
}

/**
 * The same provider profile as a FULL PAGE, pushed from inside a chat (Amit,
 * 2026-09-27: "tapping chat header inside chat screen should open full page
 * for profile not sheet"). The sheet is for discovery (Home, search, cards);
 * from a conversation the profile is a place you go and come back from, so
 * it is an ordinary push and back returns to the chat. Chat from here takes
 * the one-chat-per-peer path, which pops back to the conversation underneath
 * rather than opening a second copy.
 */
export function ProviderProfileRoute({ navigation, route }: RouteProps<'ProviderProfile'>) {
  const openChat = useOpenChat();
  const onOpenChat = useCallback(
    (providerId: string) => openChat(providerId, route.key),
    [openChat, route.key],
  );
  const onStartCall = useCallback(
    (providerId: string, channel: 'audio' | 'video') =>
      startCall(providerId, channel === 'video' ? 'video' : 'voice'),
    [],
  );
  return (
    <Layout.Screen minimalShell>
      <ProviderDetailScreen
        providerId={route.params.providerId}
        onBack={() => navigation.goBack()}
        onOpenChat={onOpenChat}
        onStartCall={onStartCall}
      />
    </Layout.Screen>
  );
}

/** The wallet page, a tall native sheet (owner 2026-09-26, ADR-0032). */
export function WalletRoute({ navigation }: RouteProps<'Wallet'>) {
  return (
    <Layout.Screen sheet minimalShell>
      <WalletScreen sheet onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

/** Leaving the application clears the provider-signup intent. */
function clearProviderIntent(): void {
  storage.remove(PROVIDER_INTENT_KEY);
  useStore.getState().setPendingProviderApply(false);
}

/**
 * Provider onboarding. Back does exactly what the phase's header arrow does
 * (nav-migration §4, 3c; Up and Back identical): `checking`/`confirm` back to
 * the form, `profile` back to verify, `done` stays (the role has flipped and
 * "Go to my home" is the way out). In `verify` the pop proceeds, and every
 * removal clears the provider intent so a later boot does not route back in.
 * Submitting flips the role, which remounts the container on the provider
 * tree: no removal happens then.
 */
export function ApplyRoute({ navigation }: RouteProps<'Apply'>) {
  const { onProviderOnboarded } = useSignedInActions();
  const queryClient = useQueryClient();
  const guardRef = useRef<ApplyGuard | null>(null);
  const [phase, setPhase] = React.useState<ApplyGuard['phase']>('verify');
  const onGuard = useCallback((guard: ApplyGuard) => {
    guardRef.current = guard;
    setPhase(guard.phase);
  }, []);
  useDismissKeyboardOnBlur();

  usePreventRemove(phase !== 'verify', () => {
    guardRef.current?.backStep();
  });
  useEffect(() => navigation.addListener('beforeRemove', clearProviderIntent), [navigation]);

  return (
    <Layout.Screen minimalShell>
      <ProviderApplicationScreen
        onBack={() => navigation.goBack()}
        onSubmitted={() => {
          clearProviderIntent();
          void queryClient.invalidateQueries();
          // Closes the boot-skip gap for the rest of this session (App.tsx).
          onProviderOnboarded();
        }}
        onGuard={onGuard}
      />
    </Layout.Screen>
  );
}

export function ApplicationStatusRoute({ navigation }: RouteProps<'ApplicationStatus'>) {
  const nav = useNavigationDeduped();
  return (
    <Layout.Screen>
      <ProviderStatusScreen
        onBack={() => navigation.goBack()}
        onEdit={() => nav.push('Apply', { from: 'applicationStatus' })}
      />
    </Layout.Screen>
  );
}

export function BlockedRoute({ navigation }: RouteProps<'Blocked'>) {
  return (
    <Layout.Screen>
      <BlockedUsersScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

export function UsageRoute({ navigation }: RouteProps<'Usage'>) {
  return (
    <Layout.Screen>
      <UsageLedgerScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

export function InvoicesRoute({ navigation }: RouteProps<'Invoices'>) {
  return (
    <Layout.Screen>
      <InvoicesScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

export function TransactionsRoute({ navigation }: RouteProps<'Transactions'>) {
  return (
    <Layout.Screen>
      <TransactionHistoryScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}

/**
 * The idle-home prompt (nav-migration §2). It shows whatever prompt Home's
 * campaign has up; "Not now" moves the campaign on (the next prompt shows in
 * place), Start opens the chat in this route's place, and the route removes
 * itself once the campaign has no prompt. Hardware back is "Not now".
 */
export function HomeSuggestionRoute({ navigation, route }: RouteProps<'HomeSuggestion'>) {
  const prompt = useHomeSuggestionPrompt(s => s.prompt);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  // Start replaces this route with the chat: that removal is not a "Not now".
  const accepted = useRef(false);

  useEffect(() => {
    if (prompt === null) {
      removeSelf(route.key, navigation.getState().key);
    }
  }, [prompt, navigation, route.key]);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        // Removed while a prompt is still up: back, not Start or the campaign.
        if (!accepted.current) {
          promptRef.current?.onDismiss();
        }
      }),
    [navigation],
  );

  return (
    <Layout.Screen minimalShell>
      {prompt === null ? null : (
        <HomeSuggestionScreen
          suggestion={prompt.suggestion}
          onAccept={() => {
            accepted.current = true;
            prompt.onAccept();
          }}
          onDismiss={prompt.onDismiss}
        />
      )}
    </Layout.Screen>
  );
}

export function AppearanceRoute({ navigation }: RouteProps<'AppearanceSettings'>) {
  return (
    <Layout.Screen>
      <AppearanceScreen onBack={() => navigation.goBack()} />
    </Layout.Screen>
  );
}
