import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from './src/theme/tokens';
import { ThemeProvider, useStyles, useThemeMode } from './src/theme/ThemeProvider';
import { assertEnv } from './src/lib/env';
import { migrateLegacyStorage, storage } from './src/lib/storage';
import { initialNotificationPeer, onNotificationOpen, startPush } from './src/lib/push';
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
  | { phase: 'signedOut'; message?: string }
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
  const styles = useStyles(makeStyles);
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
        // One-time move of anything the previous AsyncStorage build left behind,
        // before the session is read — otherwise the first boot after the switch
        // signs everybody out.
        await migrateLegacyStorage();
        const session = await currentSession();
        if (cancelled) {
          return;
        }
        if (session === null) {
          setBoot({ phase: 'signedOut' });
          return;
        }
        // Synchronous, so the first frame can already be the right screen.
        const stored = storage.get(LAST_PROVIDER_KEY);
        if (isUuid(stored)) {
          setRoute({ name: 'chat', providerId: stored });
        }
        // A notification tap outranks the remembered conversation: it is the
        // more recent, more explicit statement of what this person opened the
        // app to do.
        const tapped = await initialNotificationPeer();
        if (tapped !== null) {
          setRoute({ name: 'chat', providerId: tapped });
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
        .then(result => {
          if (result.status === 'signedIn') {
            track('signed_in');
            // Everything cached belongs to the previous (absent) session.
            void queryClient.invalidateQueries();
            setBoot({ phase: 'ready' });
          } else if (result.status === 'failed') {
            // Back to the auth screen *with the reason*. Advancing here was the
            // bug that produced a permanent spinner.
            setBoot({ phase: 'signedOut', message: result.message });
          }
        })
        .catch(() =>
          setBoot({
            phase: 'signedOut',
            message: 'Could not finish signing in. Please try again.',
          }),
        );
    };

    void Linking.getInitialURL().then(consume);
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, []);

  /**
   * Push is started only once there is a session, and stopped when it ends.
   *
   * Registering before sign-in would upload a token with no user to attach it
   * to, and leaving the refresh listener running across a sign-out would
   * re-register the next account's device against a dead session.
   */
  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    let unsubscribeToken: (() => void) | undefined;
    void startPush().then(unsub => {
      unsubscribeToken = unsub;
    });
    const unsubscribeOpen = onNotificationOpen(peerId => {
      setRoute({ name: 'chat', providerId: peerId });
    });
    return () => {
      unsubscribeToken?.();
      unsubscribeOpen();
    };
  }, [boot.phase]);

  const openChat = useCallback((id: string) => {
    setRoute({ name: 'chat', providerId: id });
    track('conversation_opened');
    storage.set(LAST_PROVIDER_KEY, id);
  }, []);

  const leaveChat = useCallback(() => {
    setRoute({ name: 'inbox' });
    resetConversation();
    storage.remove(LAST_PROVIDER_KEY);
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
    return <AuthScreen initialError={boot.message} />;
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
  const styles = useStyles(makeStyles);
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

/**
 * Inside the provider, so the status bar can follow the theme.
 *
 * Android draws the clock and battery over our background once edge-to-edge is
 * on, so this is not cosmetic: with light content on a light background the
 * status bar is simply blank. No `backgroundColor` — unsupported from Android 15.
 */
function Shell() {
  const { isDark } = useThemeMode();
  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent />
      <Root />
    </>
  );
}

export default function App() {
  return (
    /**
     * GestureHandlerRootView has to be the outermost view, not a wrapper inside
     * a screen: on Android it installs the touch interceptor that lets a pan
     * compete with the scroll views above it. Without it at the root, the sheet
     * drag silently does nothing — the gesture is created, recognised by nobody,
     * and there is no warning.
     */
    <GestureHandlerRootView style={fill.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The one stylesheet that cannot be theme-aware: it belongs to the component
 * that *installs* the provider, so there is no theme to read yet. It carries no
 * colour, which is why that is fine.
 */
const fill = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: t.color.bg.base,
  },
  blank: {
    flex: 1,
    backgroundColor: t.color.bg.base,
  },
  fatal: {
    flex: 1,
    gap: TOKENS.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: TOKENS.space.lg,
    backgroundColor: t.color.bg.base,
  },
  fatalTitle: {
    ...TOKENS.typography.displayLarge,
    color: t.color.text.primary,
  },
  fatalBody: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
    textAlign: 'center',
  },
  retryWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: TOKENS.space['2xl'],
  },
});
