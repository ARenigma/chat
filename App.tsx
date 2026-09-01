import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from './src/theme/tokens';
import { ThemeProvider, useStyles, useThemeMode } from './src/theme/ThemeProvider';
import { DURATION, fadeSwapFast } from './src/theme/motion';
import { AfterPaint } from './src/components/AfterPaint';
import { UpdateBanner } from './src/components/UpdateBanner';
import { BLOOM_CONTENT_MS } from './src/lib/bloom';
import { assertEnv } from './src/lib/env';
import { storage } from './src/lib/storage';
import { initialNotificationPeer, onNotificationOpen, startPush } from './src/lib/push';
import { clearCall } from './src/lib/conversations';
import {
  memberParent,
  providerParent,
  type ChatDoor,
  type MemberRoute,
  type ProviderRoute,
} from './src/lib/routes';
import { initSentry } from './src/lib/sentry';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import {
  startFrameWatch,
  trackQuerySlow,
  trackScreenOpened,
} from './src/lib/perfTelemetry';
import { supabase } from './src/lib/supabase';
import { currentSession, handleAuthDeepLink } from './src/api/auth';
import {
  effectivePermissionLevel,
  FALLBACK_PERMISSIONS,
  type PermissionsConfig,
} from './src/api/appConfig';
import {
  getSignedInProfile,
  isFirstUser,
  needsAgeBracket,
  needsProfileSetup,
} from './src/api/profileSetup';
import type { Profile } from './src/lib/database.types';
import { CALLS_ENABLED, useIncomingCalls, type IncomingCall } from './src/api/calls';
import { useConversations, useSelfId } from './src/api/chat';
import { useRole } from './src/api/provider';
import { useStore } from './src/store/useStore';
import { PolicyGateScreen } from './src/screens/PolicyGateScreen';
import { ProfileSetupScreen } from './src/screens/ProfileSetupScreen';
import { WelcomePappalScreen } from './src/screens/WelcomePappalScreen';
import { RechargeScreen, RechargeWalletPage } from './src/screens/RechargeScreen';
import { ConfirmDialog } from './src/components/ConfirmDialog';
import { HomeTour } from './src/components/HomeTour';
import { useHomeTour } from './src/store/useHomeTour';
import { Button } from './src/components/Button';
import { FloatingToolbar } from './src/components/FloatingToolbar';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ProviderDetailScreen } from './src/screens/ProviderDetailScreen';
import { CallScreen } from './src/screens/CallScreen';
import { ProviderApplicationScreen } from './src/screens/ProviderApplicationScreen';
import { ProviderHomeScreen } from './src/screens/ProviderHomeScreen';
import { ProviderStatusScreen } from './src/screens/ProviderStatusScreen';
import { BlockedUsersScreen } from './src/screens/BlockedUsersScreen';
import { CallsScreen } from './src/screens/CallsScreen';
import { FavouritesScreen } from './src/screens/FavouritesScreen';
import { ChatsListScreen } from './src/screens/ChatsListScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';
import { SplashScreen } from './src/screens/SplashScreen';
import { TransactionHistoryScreen } from './src/screens/TransactionHistoryScreen';

initSentry();

const LAST_PROVIDER_KEY = 'companion.lastProvider';
const { StartupTiming } = NativeModules as {
  StartupTiming?: { reportFullyDrawn(): void };
};

/**
 * Report TTFD only after a data-backed screen is committed and the JS thread
 * is idle. The extra animation frame prevents an early call from collapsing
 * TTFD into Android's automatic TTID measurement.
 * https://developer.android.com/topic/performance/vitals/launch-time
 *
 * `InteractionManager` is deprecated (RN warns on first access and will remove
 * it). Idle scheduling is the sanctioned replacement and also keeps LogBox from
 * covering the welcome Continue control in __DEV__.
 */
function useReportFullyDrawn(usable: boolean): void {
  useEffect(() => {
    if (!usable || Platform.OS !== 'android') {
      return;
    }
    let frame: number | undefined;
    const idle = requestIdleCallback(() => {
      frame = requestAnimationFrame(() => StartupTiming?.reportFullyDrawn());
    });
    return () => {
      cancelIdleCallback(idle);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [usable]);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

const queryStarted = new Map<string, number>();
queryClient.getQueryCache().subscribe(event => {
  const q = 'query' in event ? event.query : undefined;
  if (q === undefined) return;
  if (q.state.fetchStatus === 'fetching' && !queryStarted.has(q.queryHash)) {
    queryStarted.set(q.queryHash, Date.now());
    return;
  }
  const started = queryStarted.get(q.queryHash);
  if (q.state.fetchStatus === 'idle' && started !== undefined) {
    queryStarted.delete(q.queryHash);
    const kind = String(q.queryKey[0] ?? 'q');
    trackQuerySlow(kind, Date.now() - started, q.state.dataUpdateCount > 1 ? 'hit' : 'miss');
  }
});

type Boot =
  | { phase: 'loading' }
  | { phase: 'signedOut'; message?: string }
  /**
   * First-run member profile: username + clay avatar. Migration 040.
   * A member is first-run only while their wallet balance is exactly zero.
   * `needsAge` is true when the member has not yet declared an age band
   * (migration 043). `needsUsername` is true for the standard first-run case.
   * Both can be true (new user via browser redirect); only `needsAge` can be
   * true alone (existing user who predates migration 043).
   */
  | { phase: 'profileSetup'; needsAge: boolean; needsUsername: boolean }
  /**
   * Brief welcome animation after profile setup completes.
   */
  | { phase: 'welcomePappal' }
  /**
   * ADR-0020: pending_policy_acceptances() returned at least one row.
   * The user must accept before entering the app. Cannot be bypassed by deep
   * links — the boot machine must pass through policyGate before reaching ready.
   * Migration 027.
   */
  | { phase: 'policyGate' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

async function fetchPermissionsConfig(): Promise<PermissionsConfig> {
  const { data, error } = await supabase.rpc('get_public_config', {
    p_domain: 'permissions',
  });
  if (error || data == null) {
    return FALLBACK_PERMISSIONS;
  }
  return { ...FALLBACK_PERMISSIONS, ...(data as Partial<PermissionsConfig>) };
}

/**
 * Phases entered after a session is confirmed (excludes welcome — set explicitly).
 *
 * `profileSetup` carries age/username flags so the screen knows which steps to
 * render. Only `needsAge` can be true without `needsUsername` (existing member
 * who predates migration 043); the reverse is always paired.
 */
type PostAuthBoot =
  | { phase: 'profileSetup'; needsAge: boolean; needsUsername: boolean }
  | { phase: 'policyGate' }
  | { phase: 'ready' };

async function bootPhaseAfterAuth(profile: Profile | null): Promise<PostAuthBoot> {
  const p = profile ?? undefined;
  /*
   * Product identity rule: a new member is defined by an empty wallet, not by
   * nullable profile-migration fields. Existing funded accounts can predate
   * profile_completed_at / age_bracket; sending them through first-run setup
   * after an upgrade is a regression.
   */
  const firstUser = isFirstUser(p);
  const needsUsername = firstUser && needsProfileSetup(p);
  const needsAge = firstUser && needsAgeBracket(p);

  if (needsUsername || needsAge) {
    return { phase: 'profileSetup', needsAge, needsUsername };
  }

  const { data: pending } = await supabase.rpc('pending_policy_acceptances');
  if (Array.isArray(pending) && pending.length > 0) {
    return { phase: 'policyGate' };
  }
  return { phase: 'ready' };
}

async function requestAndroidPermission(
  permission: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
  title: string,
  message: string,
  level: 'optional' | 'required',
): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  const result = await PermissionsAndroid.request(permission, {
    title,
    message,
    buttonPositive: 'Allow',
  });
  if (
    level === 'required' &&
    result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
  ) {
    Alert.alert(
      title,
      `${message} Open Settings to enable it.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ],
    );
  }
}

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
  const [exitDialogVisible, setExitDialogVisible] = useState(false);
  useReportFullyDrawn(boot.phase !== 'loading' && boot.phase !== 'ready');
  // Refs so the BackHandler closure reads the current route without being in its
  // dep array — adding route/providerRoute caused the listener to tear down and
  // re-add itself on every navigation, producing a measurable re-subscription
  // jank on Android on every setRoute call.
  const routeRef = useRef(route);
  routeRef.current = route;
  const providerRouteRef = useRef(providerRoute);
  providerRouteRef.current = providerRoute;
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const resetConversation = useStore(s => s.resetConversation);
  const refillVisible = useStore(s => s.refillVisible);
  const closeRefill = useStore(s => s.closeRefill);
  const walletVisible = useStore(s => s.walletVisible);
  const closeWallet = useStore(s => s.closeWallet);
  const pendingProviderApply = useStore(s => s.pendingProviderApply);
  const setPendingProviderApply = useStore(s => s.setPendingProviderApply);

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
        // ADR-0020 / 040: profile setup (+ age, 043), then policy gate, then app.
        const profile = await getSignedInProfile();
        const nextBoot = await bootPhaseAfterAuth(profile);
        setBoot(nextBoot);
        if (nextBoot.phase === 'ready') {
          track('app_open');
        }
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
   * After sign-in completes, check whether the member tapped "Become a partner"
   * before authenticating and, if so, route directly to the application screen.
   *
   * The flag is set in OnboardingScreen before triggering Google sign-in; this
   * effect fires once the boot transitions to `ready` (session confirmed) and the
   * member tree is about to mount. Clearing the flag here prevents a stale
   * redirect on subsequent cold starts.
   */
  useEffect(() => {
    if (boot.phase === 'ready' && pendingProviderApply) {
      setRoute({ name: 'apply' });
      setPendingProviderApply(false);
    }
  }, [boot.phase, pendingProviderApply, setPendingProviderApply]);

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
      /*
       * An incoming-call deep link, checked first. `companionchat://call/<peerId>
       * ?callId=<id>&action=answer|decline` is fired by the CallStyle
       * notification's Answer/Decline PendingIntents (Conversations.callActionIntent).
       * Both open the in-app incoming-call screen, which owns the answer_call /
       * end_call RPCs with the user's session; the notification only rings and
       * wakes. The notification is cleared here since the app now has the call.
       * Parsed with regex, not URLSearchParams, which Hermes does not ship.
       */
      const callMatch = url.match(/^companionchat:\/\/call\/([^?]+)\?(.*)$/);
      if (callMatch) {
        const callPeer = callMatch[1] ?? '';
        const qs = callMatch[2] ?? '';
        const callId = qs.match(/callId=([^&]+)/)?.[1];
        // Bug fix: was hardcoded 'voice', dropped video for notification-driven answers (android-audit.md 2026-08-29)
        const medium = (qs.match(/medium=([^&]+)/)?.[1] ?? 'voice') as 'voice' | 'video';
        if (isUuid(callPeer) && callId !== undefined && isUuid(callId)) {
          void clearCall(callId);
          setRoute({ name: 'call', providerId: callPeer, direction: 'in', callId, medium });
        }
        return;
      }

      const peer = url.match(/^companionchat:\/\/peer\/(.+)$/)?.[1];
      if (peer !== undefined) {
        if (isUuid(peer)) {
          setRoute({ name: 'chat', providerId: peer, from: 'home' });
        }
        return;
      }
      handleAuthDeepLink(url)
        .then(async result => {
          if (result.status === 'signedIn') {
            track('signed_in');
            // Everything cached belongs to the previous (absent) session.
            void queryClient.invalidateQueries();
            const profile = await getSignedInProfile();
            const nextBoot = await bootPhaseAfterAuth(profile);
            setBoot(nextBoot);
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

    // Prime runtime permissions once per sign-in so the first call, voice note,
    // or video does not hit a missing-grant crash. These MUST run strictly one at
    // a time: Android silently drops a permission request while another dialog is
    // already pending, so `startPush()` (POST_NOTIFICATIONS) is awaited before the
    // mic request, and mic before camera. Requesting them concurrently made the
    // OS return the later two as denied without ever showing a dialog.
    // Fire-and-forget for boot: a denial just means the event-time guards in
    // callSession / recorder / composer remain the fallback for that feature.
    void (async () => {
      try {
        const permissions = await fetchPermissionsConfig();
        const notificationLevel = effectivePermissionLevel(
          permissions,
          'notification',
        );
        const micLevel = effectivePermissionLevel(permissions, 'microphone');
        const cameraLevel = effectivePermissionLevel(permissions, 'camera');

        if (notificationLevel !== 'optional') {
          unsubscribeToken = await startPush();
        } else {
          try {
            unsubscribeToken = await startPush();
          } catch {
            // Optional for internal builds — boot continues without notifications.
          }
        }

        if (Platform.OS !== 'android') {
          return;
        }

        if (micLevel === 'required') {
          await requestAndroidPermission(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            'Microphone',
            'Pappal needs your mic for calls and voice notes.',
            micLevel,
          );
        }
        if (cameraLevel === 'required') {
          await requestAndroidPermission(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            'Camera',
            'Pappal needs your camera for video calls.',
            cameraLevel,
          );
        }
        if (
          notificationLevel === 'required' &&
          Platform.Version >= 33
        ) {
          await requestAndroidPermission(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            'Notifications',
            'Pappal sends message alerts when someone replies.',
            notificationLevel,
          );
        }
      } catch {
        // Permission priming is best-effort; failures here do not affect boot.
      }
    })();

    const unsubscribeOpen = onNotificationOpen(peerId => {
      setRoute({ name: 'chat', providerId: peerId, from: 'home' });
    });
    return () => {
      unsubscribeToken?.();
      unsubscribeOpen();
    };
  }, [boot.phase]);

  const openChat = useCallback((id: string, from: ChatDoor = 'home') => {
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
      // The Recharge overlay closes before any screen pops: it sits above
      // everything (zIndex 20) and is the thing the user most recently opened, so
      // back means it first. Settings is a normal route now (not an overlay), so
      // it pops through the parent map below like every other screen.
      if (useHomeTour.getState().active) {
        useHomeTour.getState().skip();
        return true;
      }
      if (walletVisible) {
        closeWallet();
        return true;
      }
      if (refillVisible) {
        closeRefill();
        return true;
      }
      // Read from refs so that route changes do NOT cause the listener to tear
      // down and re-subscribe on every navigation (which produced a measurable
      // jank spike on Android with each setRoute call). Local names shadow the
      // outer state values intentionally — all reads here must go through refs.
      // eslint-disable-next-line @typescript-eslint/no-shadow
      const route = routeRef.current;
      // eslint-disable-next-line @typescript-eslint/no-shadow
      const providerRoute = providerRouteRef.current;
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
      /*
       * At the root, do NOT silently close. A lonely person about to leave is
       * exactly the moment to say "someone's still here", so back at Home asks
       * first. This is the seam the retention experience plugs into later (an AI
       * companion clip inviting them to stay / try a call); for now it is an
       * honest native confirm, and returning `true` keeps the gesture handled so
       * Android does not close underneath it.
       */
      setExitDialogVisible(true);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  // route and providerRoute are intentionally omitted: they are read via refs
  // inside onBack so the listener is stable across navigations.
  }, [walletVisible, closeWallet, refillVisible, closeRefill, resetConversation]);

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

  if (boot.phase === 'profileSetup') {
    return (
      <ProfileSetupScreen
        needsAge={boot.needsAge}
        needsUsername={boot.needsUsername}
        onDone={async () => {
          if (boot.needsUsername) {
            /*
             * Full first-run: profile is now complete. Show the welcome
             * animation, which re-runs bootPhaseAfterAuth after it plays.
             */
            setBoot({ phase: 'welcomePappal' });
          } else {
            /*
             * Age-only gate (existing member who predates migration 043):
             * re-run the boot check so policy gate / ready follows correctly.
             * No welcome animation — they have already seen it.
             */
            const profile = await getSignedInProfile();
            const nextBoot = await bootPhaseAfterAuth(profile);
            setBoot(nextBoot);
            if (nextBoot.phase === 'ready') {
              track('app_open');
            }
          }
        }}
      />
    );
  }

  if (boot.phase === 'welcomePappal') {
    return (
      <WelcomePappalScreen
        onDone={async () => {
          const profile = await getSignedInProfile();
          const nextBoot = await bootPhaseAfterAuth(profile);
          setBoot(nextBoot);
          if (nextBoot.phase === 'ready') {
            track('app_open');
          }
        }}
      />
    );
  }

  // ADR-0020: gate cannot be bypassed — rendered here in the boot machine
  // rather than inside SignedIn so deep links cannot route around it.
  if (boot.phase === 'policyGate') {
    return (
      <PolicyGateScreen
        onAccepted={() => setBoot({ phase: 'ready' })}
      />
    );
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
    <>
      <SignedIn
        route={route}
        providerRoute={providerRoute}
        openChat={openChat}
        openProvider={openProvider}
        leaveChat={leaveChat}
        backToHome={backToHome}
        setRoute={setRoute}
        setProviderRoute={setProviderRoute}
        onSignedOut={() => setBoot({ phase: 'signedOut' })}
      />
      <ConfirmDialog
        visible={exitDialogVisible}
        testID="app-exit-dialog"
        title="Leave Pappal?"
        body="Someone is around to talk whenever you are. You can pick up right where you left off."
        cancelLabel="Stay"
        confirmLabel="Leave"
        destructive
        onCancel={() => setExitDialogVisible(false)}
        onConfirm={() => BackHandler.exitApp()}
      />
    </>
  );
}

interface SignedInProps {
  route: MemberRoute;
  providerRoute: ProviderRoute;
  /** `from` names the door, so back returns where the member actually came from. */
  openChat: (id: string, from?: ChatDoor) => void;
  openProvider: (id: string) => void;
  leaveChat: () => void;
  backToHome: () => void;
  setRoute: (r: MemberRoute) => void;
  setProviderRoute: (r: ProviderRoute) => void;
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
  onSignedOut,
}: SignedInProps) {
  const styles = useStyles(makeStyles);
  const { role, isPending } = useRole();
  const { data: selfId } = useSelfId();
  const { data: conversations } = useConversations();
  // Total unread across all conversations for the home tab badge.
  const totalUnread = (conversations ?? []).reduce((sum, c) => {
    const count = c.i_am_member
      ? Number(c.unread_count_member)
      : Number(c.unread_count_provider);
    return sum + count;
  }, 0);
  useReportFullyDrawn(!isPending);
  useEffect(() => {
    trackScreenOpened(role === 'provider' ? providerRoute.name : route.name);
  }, [role, route.name, providerRoute.name]);

  // A ring, foreground: route the incoming call to the right tree's call screen.
  // Declared before the early return so the hook order is stable.
  const onIncoming = useCallback(
    (incoming: IncomingCall) => {
      if (role === 'provider') {
        setProviderRoute({ name: 'call', peerId: incoming.callerId, direction: 'in', callId: incoming.callId, medium: incoming.medium });
      } else {
        setRoute({ name: 'call', providerId: incoming.callerId, direction: 'in', callId: incoming.callId, medium: incoming.medium });
      }
    },
    [role, setRoute, setProviderRoute],
  );
  useIncomingCalls(selfId, onIncoming);

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
        {providerRoute.name === 'call' ? (
          <CallScreen
            providerId={providerRoute.peerId}
            direction={providerRoute.direction}
            callId={providerRoute.callId}
            medium={providerRoute.medium}
            // Symmetry with the member tree: hanging up returns to that peer's
            // chat, not the provider home (user 2026-08-31).
            onEnd={() => setProviderRoute({ name: 'chat', peerId: providerRoute.peerId })}
          />
        ) : providerRoute.name === 'chat' ? (
          <ChatScreen
            providerId={providerRoute.peerId}
            onBack={() => setProviderRoute({ name: 'home' })}
            onStartCall={channel =>
              setProviderRoute({
                name: 'call',
                peerId: providerRoute.peerId,
                direction: 'out',
                callId: null,
                medium: channel === 'video' ? 'video' : 'voice',
              })
            }
          />
        ) : providerRoute.name === 'settings' ? (
          <SettingsSheet
            onBack={() => setProviderRoute({ name: 'home' })}
            onDeleted={() => {
              setProviderRoute({ name: 'home' });
              onSignedOut();
            }}
            onSignedOut={onSignedOut}
          />
        ) : (
          <ProviderHomeScreen
            onOpenConversation={peerId => setProviderRoute({ name: 'chat', peerId })}
            onOpenSettings={() => setProviderRoute({ name: 'settings' })}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.host}>
      {/* The content area, above the docked nav. Home stays mounted underneath,
        * always; the Settings tab and the pushed screens are absolute layers that
        * fill THIS view (not the whole host), so they end at the nav's top edge
        * and the fixed bar never has to move or be overlapped. Returning to Home
        * never remounts its lists or replays entry animations — the native
        * back-stack behaviour a single swapped-in screen threw away. */}
      <View style={styles.content}>
      {/* Settings is a docked nav tab, so Home no longer opens it. */}
      <HomeScreen
        onOpenConversation={openChat}
        onOpenProvider={openProvider}
        onSeeAllChats={() => setRoute({ name: 'chatsList' })}
      />

      {/* Favourites is a top-level tab: the people this member has hearted. */}
      {route.name === 'favourites' ? (
        <Animated.View style={styles.tabLayer} entering={fadeSwapFast} exiting={FadeOut.duration(DURATION.fast)}>
          <AfterPaint>
            <FavouritesScreen onOpenProvider={openProvider} />
          </AfterPaint>
        </Animated.View>
      ) : null}

      {/* Calls is a top-level tab (empty state for now). A real destination so
          the nav's Calls icon does something on tap rather than reading as dead. */}
      {route.name === 'calls' ? (
        <Animated.View style={styles.tabLayer} entering={fadeSwapFast} exiting={FadeOut.duration(DURATION.fast)}>
          <AfterPaint>
            <CallsScreen />
          </AfterPaint>
        </Animated.View>
      ) : null}

      {/* Settings is a top-level tab: its own layer filling the content area
          (which ends at the docked nav's top edge), not inside the pushed overlay
          that the nav does not survive. */}
      {route.name === 'settings' ? (
        // A tab switch, not a push: a quick cross-fade rather than a slide, so
        // Home↔Settings does not read as a sideways jump.
        <Animated.View style={styles.tabLayer} entering={fadeSwapFast} exiting={FadeOut.duration(DURATION.fast)}>
          <AfterPaint>
            <SettingsSheet
              onBack={backToHome}
              // A fixed bottom-nav tab on the member tree: the Home tab is the way
              // back, so no app-bar back action (WhatsApp's model).
              showBack={false}
              onDeleted={() => {
                backToHome();
                onSignedOut();
              }}
              onSignedOut={onSignedOut}
              onApply={() => setRoute({ name: 'apply' })}
              onApplicationStatus={() => setRoute({ name: 'applicationStatus' })}
              onBlocked={() => setRoute({ name: 'blocked' })}
              onTransactions={() => setRoute({ name: 'transactions' })}
            />
          </AfterPaint>
        </Animated.View>
      ) : null}

      {/* Opaque cover rendered at zIndex 9 — above the always-mounted Home (no
          zIndex) and below the sliding overlay (zIndex 10) — so the slide
          reveals this neutral surface instead of the Home feed.  Not animated:
          it must be instant to black out Home before the overlay arrives.
          pointerEvents="none" keeps all touches falling through to the overlay. */}
      {route.name !== 'home' &&
      route.name !== 'settings' &&
      route.name !== 'calls' &&
      route.name !== 'favourites' ? (
        <View style={styles.coverHome} pointerEvents="none" />
      ) : null}

      {route.name === 'chatsList' ||
      (route.name === 'chat' && route.from === 'chatsList') ? (
        // Full-screen Chats modal. Stays mounted under a chat opened from here
        // so back returns to this list, not Home (docs/flows.md).
        <Animated.View
          style={styles.overlay}
          entering={SlideInRight.duration(160)}
          exiting={SlideOutRight.duration(150)}>
          <ChatsListScreen
            onBack={backToHome}
            onOpenConversation={id => openChat(id, 'chatsList')}
          />
        </Animated.View>
      ) : null}

      {route.name === 'chat' ? (
        <Animated.View
          style={[styles.overlay, route.from === 'chatsList' && styles.overlayStack]}
          entering={SlideInRight.duration(160)}
          exiting={SlideOutRight.duration(150)}>
          <AfterPaint>
            <ChatScreen
              providerId={route.providerId}
              onBack={leaveChat}
              onOpenProfile={openProvider}
              onStartCall={channel =>
                setRoute({ name: 'call', providerId: route.providerId, direction: 'out', callId: null, medium: channel === 'video' ? 'video' : 'voice' })
              }
            />
          </AfterPaint>
        </Animated.View>
      ) : route.name === 'call' ||
        route.name === 'providerDetail' ||
        route.name === 'apply' ||
        route.name === 'applicationStatus' ||
        route.name === 'blocked' ||
        route.name === 'transactions' ? (
        <Animated.View
          style={styles.overlay}
          entering={SlideInRight.duration(160)}
          exiting={SlideOutRight.duration(150)}>
          {route.name === 'call' ? (
            <AfterPaint>
              <CallScreen
                providerId={route.providerId}
                direction={route.direction}
                callId={route.callId}
                medium={route.medium}
                // Ending a call lands on that peer's chat, not Home: a call is a
                // moment inside a conversation, so hanging up returns to the
                // conversation it belongs to (user 2026-08-31). Covers both the
                // outgoing call (started from the chat) and an answered incoming
                // ring, which should also drop the member into that SP's thread.
                onEnd={() => openChat(route.providerId)}
              />
            </AfterPaint>
          ) : route.name === 'providerDetail' ? (
            <AfterPaint>
              <ProviderDetailScreen
                providerId={route.providerId}
                onBack={backToHome}
                onOpenChat={id => openChat(id, 'detail')}
                onStartCall={(id, channel) =>
                  setRoute({
                    name: 'call',
                    providerId: id,
                    direction: 'out',
                    callId: null,
                    medium: channel === 'video' ? 'video' : 'voice',
                  })
                }
              />
            </AfterPaint>
          ) : route.name === 'apply' ? (
            <ProviderApplicationScreen
              onBack={backToHome}
              onSubmitted={() => setRoute({ name: 'applicationStatus' })}
            />
          ) : route.name === 'applicationStatus' ? (
            <ProviderStatusScreen onBack={backToHome} onEdit={() => setRoute({ name: 'apply' })} />
          ) : route.name === 'blocked' ? (
            <BlockedUsersScreen onBack={backToHome} />
          ) : (
            <TransactionHistoryScreen onBack={() => setRoute({ name: 'settings' })} />
          )}
        </Animated.View>
      ) : null}
      </View>

      {/*
        * The docked bottom bar (WhatsApp/iMessage): in the layout flow BELOW the
        * content area, taking its own height, so nothing scrolls under it and a
        * list row can never steal a tab's tap. Home and Settings are the two
        * top-level tabs, so it renders on both and its active pill follows the
        * route; on chat/call/detail and the other pushed screens it is simply not
        * rendered, giving them the full height. Calls stay gated (`CALLS_ENABLED`).
        */}
      {route.name === 'home' ||
      route.name === 'settings' ||
      route.name === 'calls' ||
      route.name === 'favourites' ? (
        <FloatingToolbar
          active={
            route.name === 'settings'
              ? 'settings'
              : route.name === 'calls'
                ? 'call'
                : route.name === 'favourites'
                  ? 'favourites'
                  : 'home'
          }
          callEnabled={CALLS_ENABLED}
          homeBadgeCount={totalUnread}
          onSelect={key => {
            if (key === 'home') {
              setRoute({ name: 'home' });
            } else if (key === 'settings') {
              setRoute({ name: 'settings' });
            } else if (key === 'call') {
              setRoute({ name: 'calls' });
            } else if (key === 'favourites') {
              setRoute({ name: 'favourites' });
            }
          }}
        />
      ) : null}
      <RechargeWalletPage />
      <RechargeScreen />
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
      <HomeTour />
    </>
  );
}

export default function App() {
  useEffect(() => startFrameWatch(), []);
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
  // The content area above the docked nav. flex:1 so it takes all the space the
  // bar leaves, and position relative so the Settings tab and pushed-screen
  // overlays (absolute) fill THIS, ending at the bar's top edge rather than
  // under it. This is what makes the fixed bar not shift or get overlapped.
  content: {
    flex: 1,
    position: 'relative',
  },
  // Instant, non-animated cover that sits between the always-mounted Home
  // (no zIndex) and the sliding overlay (zIndex 10).  Its purpose is to
  // prevent the Home feed from being visible UNDER the arriving slide during
  // the 240ms entrance — zIndex 9 means it paints over Home but the overlay
  // paints over it.  pointerEvents="none" is set on the element so all touches
  // pass straight through to the overlay above.
  coverHome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg.base,
    zIndex: 9,
  },
  // Opaque cover for a pushed screen, above the always-mounted Home and below
  // the Recharge overlay (zIndex 20). Its zIndex 10 is also what hides the fixed
  // nav (no zIndex) on pushed screens, which is the whole point of the split.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg.base,
    zIndex: 10,
  },
  // Chat opened from the Chats modal sits above that list so the list
  // remains mounted underneath.
  overlayStack: {
    zIndex: 11,
  },
  // A top-level tab (Settings) covering Home. Deliberately NO zIndex: it paints
  // over Home by document order, and the nav — rendered after it, also without a
  // zIndex — paints over it, so the fixed bar stays visible on the tab. Giving
  // this or the nav a zIndex is what broke the nav's touch handling on Android.
  tabLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
