import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS } from './src/theme/tokens';
import { assertEnv } from './src/lib/env';
import { initSentry } from './src/lib/sentry';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import { currentSession, handleAuthDeepLink } from './src/api/auth';
import { useRole } from './src/api/provider';
import { useStore } from './src/store/useStore';
import { RefillSheet } from './src/screens/RefillSheet';
import { Button } from './src/components/Button';
import { ChatScreen } from './src/screens/ChatScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ProvidersScreen } from './src/screens/ProvidersScreen';
import { ProviderApplicationScreen } from './src/screens/ProviderApplicationScreen';
import { ProviderHomeScreen } from './src/screens/ProviderHomeScreen';
import { ProviderStatusScreen } from './src/screens/ProviderStatusScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';
import { SplashScreen } from './src/screens/SplashScreen';

initSentry();

const LAST_PROVIDER_KEY = 'companion.lastProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

type Boot =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

/**
 * Member routes. The provider tree is separate and selected by the server-supplied
 * role, which is the whole of ADR-0002's safety argument: no member navigation
 * path can reach a provider screen, because they are different trees rather than
 * different branches.
 */
type MemberRoute =
  | { name: 'inbox' }
  | { name: 'directory' }
  | { name: 'chat'; providerId: string }
  | { name: 'apply' }
  | { name: 'applicationStatus' };

type ProviderRoute = { name: 'home' } | { name: 'chat'; peerId: string };

/**
 * Navigation is still a single piece of state per tree, deliberately.
 *
 * Even at five member destinations this does not justify React Navigation: no
 * deep-link routing, no history stack worth persisting, no shared element
 * transitions. What it *does* now justify is two separate unions, because
 * "member screens" and "provider screens" must not be reachable from one
 * another by construction.
 */
function Root() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [route, setRoute] = useState<MemberRoute>({ name: 'inbox' });
  const [providerRoute, setProviderRoute] = useState<ProviderRoute>({ name: 'home' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const resetConversation = useStore(s => s.resetConversation);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        assertEnv();
        const session = await currentSession();
        if (cancelled) {
          return;
        }
        if (session === null) {
          setBoot({ phase: 'signedOut' });
          return;
        }
        const stored = await AsyncStorage.getItem(LAST_PROVIDER_KEY);
        if (cancelled) {
          return;
        }
        if (isUuid(stored)) {
          setRoute({ name: 'chat', providerId: stored });
        }
        setBoot({ phase: 'ready' });
        track('app_open');
      } catch (err) {
        if (!cancelled) {
          setBoot({
            phase: 'error',
            message: err instanceof Error ? err.message : 'Could not start',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /**
   * The only deep link the app handles, and now it is load-bearing rather than
   * optional: the OAuth session arrives through it. `getInitialURL` covers the
   * cold-start case where the browser hands control back to a dead process.
   */
  useEffect(() => {
    const consume = (url: string | null): void => {
      if (url === null) {
        return;
      }
      handleAuthDeepLink(url)
        .then(handled => {
          if (handled) {
            track('signed_in');
            // Everything cached belongs to the previous (absent) session.
            void queryClient.invalidateQueries();
            setBoot({ phase: 'ready' });
          }
        })
        .catch(() => setBoot({ phase: 'signedOut' }));
    };

    void Linking.getInitialURL().then(consume);
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, []);

  const openChat = useCallback((id: string) => {
    setRoute({ name: 'chat', providerId: id });
    track('conversation_opened');
    void AsyncStorage.setItem(LAST_PROVIDER_KEY, id);
  }, []);

  const leaveChat = useCallback(() => {
    setRoute({ name: 'inbox' });
    resetConversation();
    void AsyncStorage.removeItem(LAST_PROVIDER_KEY);
  }, [resetConversation]);

  const browse = useCallback(() => {
    setRoute({ name: 'directory' });
    track('directory_viewed');
  }, []);

  const backToInbox = useCallback(() => setRoute({ name: 'inbox' }), []);

  if (boot.phase === 'loading') {
    return (
      <SplashScreen
        onRetry={() => {
          setBoot({ phase: 'loading' });
          setAttempt(n => n + 1);
        }}
      />
    );
  }

  if (boot.phase === 'signedOut') {
    return <AuthScreen />;
  }

  if (boot.phase === 'error') {
    return (
      <View style={styles.fatal}>
        <Text style={styles.fatalTitle} allowFontScaling>
          Could not start
        </Text>
        <Text style={styles.fatalBody} allowFontScaling>
          {boot.message}
        </Text>
        <View style={styles.retryWrap}>
          <Button
            label="Try again"
            onPress={() => {
              setBoot({ phase: 'loading' });
              setAttempt(n => n + 1);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <SignedIn
      route={route}
      providerRoute={providerRoute}
      openChat={openChat}
      leaveChat={leaveChat}
      browse={browse}
      backToInbox={backToInbox}
      setRoute={setRoute}
      setProviderRoute={setProviderRoute}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      onSignedOut={() => setBoot({ phase: 'signedOut' })}
    />
  );
}

interface SignedInProps {
  route: MemberRoute;
  providerRoute: ProviderRoute;
  openChat: (id: string) => void;
  leaveChat: () => void;
  browse: () => void;
  backToInbox: () => void;
  setRoute: (r: MemberRoute) => void;
  setProviderRoute: (r: ProviderRoute) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  onSignedOut: () => void;
}

/**
 * Split out because the role query needs a session, and hooks cannot be called
 * conditionally — putting `useRole` in `Root` would run it before sign-in.
 */
function SignedIn({
  route,
  providerRoute,
  openChat,
  leaveChat,
  browse,
  backToInbox,
  setRoute,
  setProviderRoute,
  settingsOpen,
  setSettingsOpen,
  onSignedOut,
}: SignedInProps) {
  const { role, isPending } = useRole();

  // No retry handler here on purpose: the profile query owns its own retries, and
  // a button that re-runs a query React Query is already retrying would only
  // look like it did something.
  if (isPending) {
    return <SplashScreen />;
  }

  // The provider tree. Selected by the server, never by a client flag.
  if (role === 'provider') {
    return (
      <View style={styles.host}>
        {providerRoute.name === 'chat' ? (
          <ChatScreen
            providerId={providerRoute.peerId}
            onBack={() => setProviderRoute({ name: 'home' })}
          />
        ) : (
          <ProviderHomeScreen
            onOpenConversation={peerId => setProviderRoute({ name: 'chat', peerId })}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
        <SettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onDeleted={() => {
            setSettingsOpen(false);
            onSignedOut();
          }}
          onSignedOut={onSignedOut}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      {route.name === 'chat' ? (
        <ChatScreen providerId={route.providerId} onBack={leaveChat} />
      ) : route.name === 'directory' ? (
        <ProvidersScreen
          onSelect={openChat}
          onBack={backToInbox}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : route.name === 'apply' ? (
        <ProviderApplicationScreen
          onBack={backToInbox}
          onSubmitted={() => setRoute({ name: 'applicationStatus' })}
        />
      ) : route.name === 'applicationStatus' ? (
        <ProviderStatusScreen
          onBack={backToInbox}
          onEdit={() => setRoute({ name: 'apply' })}
        />
      ) : (
        <InboxScreen
          onOpenConversation={openChat}
          onBrowse={browse}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      <RefillSheet />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDeleted={() => {
          setSettingsOpen(false);
          onSignedOut();
        }}
        onSignedOut={onSignedOut}
        onApply={() => {
          setSettingsOpen(false);
          setRoute({ name: 'apply' });
        }}
        onApplicationStatus={() => {
          setSettingsOpen(false);
          setRoute({ name: 'applicationStatus' });
        }}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* Light-first palette, so dark status bar content. No backgroundColor:
            unsupported once edge-to-edge is on (Android 15+). */}
        <StatusBar barStyle="dark-content" translucent />
        <Root />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  blank: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  fatal: {
    flex: 1,
    gap: TOKENS.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: TOKENS.space.lg,
    backgroundColor: TOKENS.color.bg.base,
  },
  fatalTitle: {
    ...TOKENS.typography.displayLarge,
    color: TOKENS.color.text.primary,
  },
  fatalBody: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
    textAlign: 'center',
  },
  retryWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: TOKENS.space['2xl'],
  },
});
