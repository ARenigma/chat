import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from './src/theme/tokens';
import { ThemeProvider, useStyles, useThemeMode } from './src/theme/ThemeProvider';
import { UpdateBanner } from './src/components/UpdateBanner';
import { BLOOM_CONTENT_MS } from './src/lib/bloom';
import { assertEnv } from './src/lib/env';
import { migrateLegacyStorage, storage } from './src/lib/storage';
import { initialNotificationPeer, onNotificationOpen, startPush } from './src/lib/push';
import {
  memberParent,
  providerParent,
  type MemberRoute,
  type ProviderRoute,
} from './src/lib/routes';
import { initSentry } from './src/lib/sentry';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import { currentSession, handleAuthDeepLink } from './src/api/auth';
import { CALLS_ENABLED } from './src/api/calls';
import { useRole } from './src/api/provider';
import { useStore } from './src/store/useStore';
import { RefillSheet } from './src/screens/RefillSheet';
import { Button } from './src/components/Button';
import { FloatingToolbar } from './src/components/FloatingToolbar';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ProviderDetailScreen } from './src/screens/ProviderDetailScreen';
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
  const [route, setRoute] = useState<MemberRoute>({ name: 'home' });
  const [providerRoute, setProviderRoute] = useState<ProviderRoute>({ name: 'home' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const resetConversation = useStore(s => s.resetConversation);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        assertEnv();
        // One-time move of anything the previous AsyncStorage build left behind,
        // before the session is read, otherwise the first boot after the switch
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
          setRoute({ name: 'chat', providerId: stored, from: 'home' });
        }
        // A notification tap outranks the remembered conversation: it is the
        // more recent, more explicit statement of what this person opened the
        // app to do.
        const tapped = await initialNotificationPeer();
        if (tapped !== null) {
          setRoute({ name: 'chat', providerId: tapped, from: 'home' });
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
      /*
       * A conversation deep link, checked before the auth handler.
       *
       * `companionchat://peer/<id>` is what a tapped conversation notification
       * fires once the push payload is data-only — see `Conversations.peerIntent`
       * on the native side. It arrives here through `Linking` rather than through
       * Firebase's notification-open handler, because a self-built notification's
       * PendingIntent is not a Firebase notification event.
       *
       * `isUuid` gates it because a deep-link URL is remote input: any value
       * could arrive on this scheme, and it must not reach a query unchecked —
       * the same guard `openedPeerId` applies on the Firebase path. Routing only
       * happens once signed in; a peer link that lands pre-session is dropped
       * rather than queued, because the id belongs to a session that is not the
       * current one.
       */
      const peer = url.match(/^companionchat:\/\/peer\/(.+)$/)?.[1];
      if (peer !== undefined) {
        if (isUuid(peer)) {
          setRoute({ name: 'chat', providerId: peer, from: 'home' });
        }
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
      setRoute({ name: 'chat', providerId: peerId, from: 'home' });
    });
    return () => {
      unsubscribeToken?.();
      unsubscribeOpen();
    };
  }, [boot.phase]);

  const openChat = useCallback((id: string, from: 'home' | 'detail' = 'home') => {
    setRoute({ name: 'chat', providerId: id, from });
    track('conversation_opened');
    storage.set(LAST_PROVIDER_KEY, id);
  }, []);

  const openProvider = useCallback((id: string) => {
    setRoute({ name: 'providerDetail', providerId: id });
    track('directory_viewed');
  }, []);

  // Back from a chat honours the door it was opened from (Home or a profile),
  // matching the hardware-back handler rather than always dumping to Home.
  const leaveChat = useCallback(() => {
    setRoute(prev =>
      prev.name === 'chat' ? (memberParent(prev) ?? { name: 'home' }) : { name: 'home' },
    );
    resetConversation();
    storage.remove(LAST_PROVIDER_KEY);
  }, [resetConversation]);

  const backToHome = useCallback(() => setRoute({ name: 'home' }), []);

  /**
   * The hardware and gesture back button.
   *
   * Order matters and is the whole design: a sheet closes before a screen pops,
   * because a sheet is the thing most recently opened and therefore the thing the
   * user means. Returning `false` hands the gesture to Android, which closes the
   * app; that only happens at a root, where trapping back would leave no way out
   * but the task switcher.
   */
  useEffect(() => {
    const onBack = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      const parent = memberParent(route);
      if (parent !== null) {
        if (route.name === 'chat') {
          resetConversation();
          storage.remove(LAST_PROVIDER_KEY);
        }
        setRoute(parent);
        return true;
      }
      const providerBack = providerParent(providerRoute);
      if (providerBack !== null) {
        setProviderRoute(providerBack);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [route, providerRoute, settingsOpen, resetConversation]);

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
    /*
     * The welcome screen sits in front of sign-in rather than replacing it.
     *
     * It exists to be FELT: the field draining upward and the 1.2s hold are the
     * whole point of it, and neither can be judged from a still. It is skipped
     * once somebody has seen it, and skipped entirely when an error brought them
     * back here, because an atmospheric entry in front of "that code was wrong"
     * is the wrong tone and an extra two seconds between a user and their retry.
     */
    if (!welcomeSeen && boot.message === undefined) {
      /*
       * The whole onboarding, not just a welcome screen.
       *
       * It owns sign-in now, so reaching `onDone` means a session already
       * exists and this branch will not be taken again. The old split — a
       * welcome screen that handed off to a separate AuthScreen — is what the
       * Fuse translation replaced, because a hand-off between two screens is
       * exactly the seam the reference does not have.
       *
       * `onDone` does two things, and the second is load-bearing. The browser
       * path never reaches here — its deep-link handler sets `boot: 'ready'`
       * and this screen unmounts first. But the Credential Manager path returns
       * a session synchronously without any deep link, so nothing else re-reads
       * it: `setWelcomeSeen(true)` alone would leave `boot` on `signedOut` and
       * drop the user onto `AuthScreen` with a live session behind it — the
       * exact "signed in but stuck on the sign-in screen" bug. Bumping `attempt`
       * re-runs the boot effect, which reads the now-present session and lands
       * on `ready`. `welcomeSeen` guards the rare case where the re-read finds
       * no session: AuthScreen, not a replayed welcome animation.
       */
      return (
        <OnboardingScreen
          onDone={() => {
            setWelcomeSeen(true);
            setAttempt(a => a + 1);
          }}
        />
      );
    }
    /*
     * Arriving from the welcome screen, sign-in fades up rather than cutting in.
     *
     * The source gives both halves of the swap the same transition —
     * `.opacity.combined(with: .offset(y: 20))` — so the field is never
     * interrupted by something appearing at full strength on top of it. Without
     * this the 1.2s of moving colour ends in a hard cut, which throws away the
     * part the pause was buying.
     *
     * Only on that path: reaching sign-in with a `boot.message` means an error
     * sent somebody back, and an entrance animation in front of "that code was
     * wrong" is the wrong tone.
     */
    if (welcomeSeen && boot.message === undefined) {
      return (
        <Animated.View
          style={styles.fill}
          entering={FadeIn.duration(BLOOM_CONTENT_MS)}>
          <AuthScreen />
        </Animated.View>
      );
    }
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
            label="Try Again"
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
      openProvider={openProvider}
      leaveChat={leaveChat}
      backToHome={backToHome}
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
  /** `from` names the door, so back returns where the member actually came from. */
  openChat: (id: string, from?: 'home' | 'detail') => void;
  openProvider: (id: string) => void;
  leaveChat: () => void;
  backToHome: () => void;
  setRoute: (r: MemberRoute) => void;
  setProviderRoute: (r: ProviderRoute) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  onSignedOut: () => void;
}

/**
 * Split out because the role query needs a session, and hooks cannot be called
 * conditionally, putting `useRole` in `Root` would run it before sign-in.
 */
function SignedIn({
  route,
  providerRoute,
  openChat,
  openProvider,
  leaveChat,
  backToHome,
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
      ) : route.name === 'providerDetail' ? (
        <ProviderDetailScreen
          providerId={route.providerId}
          onBack={backToHome}
          // Opened from a profile, so back from the chat returns to the profile.
          onOpenChat={id => openChat(id, 'detail')}
          onStartCall={id => openChat(id, 'detail')}
        />
      ) : route.name === 'apply' ? (
        <ProviderApplicationScreen
          onBack={backToHome}
          onSubmitted={() => setRoute({ name: 'applicationStatus' })}
        />
      ) : route.name === 'applicationStatus' ? (
        <ProviderStatusScreen
          onBack={backToHome}
          onEdit={() => setRoute({ name: 'apply' })}
        />
      ) : (
        <HomeScreen
          onOpenConversation={openChat}
          onOpenProvider={openProvider}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {/*
        * The floating toolbar renders on Home and nowhere else.
        *
        * Chat, providerDetail, apply and applicationStatus are pushed screens: they
        * are somewhere you go and come back from, and leaving the toolbar under them
        * would offer a sideways exit out of a half-finished thing. iOS hides the tab
        * bar on a push for the same reason.
        *
        * Calls are gated (`CALLS_ENABLED`); the Call tab is dimmed until they ship.
        * Settings opens the sheet rather than being a destination in the tree.
        */}
      {route.name === 'home' ? (
        <FloatingToolbar
          active="home"
          callEnabled={CALLS_ENABLED}
          onSelect={key => {
            if (key === 'settings') {
              setSettingsOpen(true);
            }
          }}
        />
      ) : null}
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
 * status bar is simply blank. No `backgroundColor`, unsupported from Android 15.
 */
function Shell() {
  const { isDark } = useThemeMode();
  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent />
      <Root />
      {/* Outside Root on purpose. A downloaded update has to survive every route
          change and both the signed-in and signed-out trees, the one thing
          worse than not prompting is prompting and then losing it when the user
          navigates. */}
      <UpdateBanner />
    </>
  );
}

export default function App() {
  return (
    /**
     * GestureHandlerRootView has to be the outermost view, not a wrapper inside
     * a screen: on Android it installs the touch interceptor that lets a pan
     * compete with the scroll views above it. Without it at the root, the sheet
     * drag silently does nothing, the gesture is created, recognised by nobody,
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
  fill: {
    flex: 1,
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
