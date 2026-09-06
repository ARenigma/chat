import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  NativeModules,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BLUR_SURFACE_AVAILABLE, BlurRoot } from './src/components/BlurSurface';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from './src/theme/tokens';
import { ThemeProvider, useStyles, useThemeMode } from './src/theme/ThemeProvider';
import {
  revealHome,
  screenOut,
  setNavDirection,
  transitioning,
  useHomeRevealStyle,
  useScreenEnter,
} from './src/theme/motion';
import { AfterPaint } from './src/components/AfterPaint';
import { UpdateBanner } from './src/components/UpdateBanner';
import { assertEnv } from './src/lib/env';
import { storage } from './src/lib/storage';
import { PROVIDER_INTENT_KEY } from './src/lib/providerIntent';
import { consumeBack } from './src/lib/backGuard';
import { initialNotificationPeer, onNotificationOpen, setNotificationPolicy, startPush } from './src/lib/push';
import { clearCall } from './src/lib/conversations';
import {
  memberParent,
  providerParent,
  transitionFor,
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
import { applyDemoCapturePolicy } from './src/lib/demoCapture';
import { currentSession, handleAuthDeepLink, signOut } from './src/api/auth';
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
import {
  parseVideoResolution,
  setVideoResolution,
} from './src/api/callMedia/profile';
import { useConversations, useSelfId } from './src/api/chat';
import { useIncomingChatRequests } from './src/api/sessions';
import { useRole } from './src/api/provider';
import { useStore } from './src/store/useStore';
import { PolicyGateScreen } from './src/screens/PolicyGateScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { SessionFeedbackSheet } from './src/components/SessionFeedbackSheet';
import { ChatRingScreen } from './src/components/ChatRingScreen';
import { checkGate, gateSatisfied } from './src/lib/permissionsGate';
import { ProfileSetupScreen } from './src/screens/ProfileSetupScreen';
import { WelcomePappalScreen } from './src/screens/WelcomePappalScreen';
import { RechargeScreen, RechargeWalletPage } from './src/screens/RechargeScreen';
import { ConfirmDialog } from './src/components/ConfirmDialog';
import { HomeTour } from './src/components/HomeTour';
import { useHomeTour } from './src/store/useHomeTour';
import { Button } from './src/components/Button';
import { FloatingToolbar, type ToolbarKey } from './src/components/FloatingToolbar';
import { ChatScreen } from './src/screens/ChatScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ProviderDetailScreen } from './src/screens/ProviderDetailScreen';
import { CallScreen } from './src/screens/CallScreen';
import { ProviderApplicationScreen } from './src/screens/ProviderApplicationScreen';
import { ProviderHomeScreen } from './src/screens/ProviderHomeScreen';
import { ProviderStatusScreen } from './src/screens/ProviderStatusScreen';
import { ProviderBankScreen } from './src/screens/ProviderBankScreen';
import { BlockedUsersScreen } from './src/screens/BlockedUsersScreen';
import { CallsScreen } from './src/screens/CallsScreen';
import { FavouritesScreen } from './src/screens/FavouritesScreen';
import { ChatsListScreen } from './src/screens/ChatsListScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';
import { SplashScreen } from './src/screens/SplashScreen';
import { TransactionHistoryScreen } from './src/screens/TransactionHistoryScreen';
import { UsageLedgerScreen } from './src/screens/UsageLedgerScreen';

initSentry();

const LAST_PROVIDER_KEY = 'companion.lastProvider';

/**
 * A pushed screen's layer: enters on the M3 forward/back transition, leaves on
 * its mirror. The entrance is effect-driven (`useScreenEnter`) because the
 * `entering` layout animation does not run on this mount path — see motion.ts.
 * One component so every push in both trees moves identically.
 *
 * `renderToHardwareTextureAndroid` is ON while the push animates and OFF the
 * moment it settles. It was deliberately absent until its own recorded
 * precondition was met, and it now is.
 *
 * The prop promotes the view to a GPU texture, so the compositor handles the
 * translate and the fade with a matrix multiply instead of re-drawing children
 * every frame. It must be toggled rather than left on: a permanent texture for
 * a full-screen view at 1080p is ~8MB of GPU memory held while nothing moves.
 *
 * THE MEASUREMENT THAT UNLOCKED IT (S22, 60Hz, release build, six push/pop
 * cycles each, `scripts/framestats.mjs`):
 *
 *              within budget   p50      p95      p99     over 2 budgets
 *   ours           44.2%     17.85ms  37.91ms  50.79ms        11
 *   Telegram       97.5%      7.55ms  14.45ms  23.97ms         0
 *
 * and on plain scrolling the two are near-identical (p95 28.19 vs 28.82, p99
 * 42.33 vs 42.39), so the transition was the entire felt gap. That is the
 * "push/pop frames exceed budget" evidence this note asked for.
 *
 * Telegram sets LAYER_TYPE_HARDWARE for the same reason before its swipe-back
 * (ActionBarLayout.java:1404) — the gesture needs zero-redraw compositing.
 *
 * The toggle is driven from `transitioning`, which `useScreenEnter` raises when
 * the animation starts and lowers in the fade's completion callback, with
 * `finished` checked so an interrupted animation still releases the texture.
 * `useAnimatedProps` applies it on the UI thread, so promotion happens on the
 * same thread as the animation rather than a JS round-trip behind it.
 * https://reactnative.dev/docs/view-style-props#rendertohardwaretextureandroid
 */
function PushedLayer({
  style,
  children,
  testID,
}: {
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}) {
  const enter = useScreenEnter();
  const textureWhileMoving = useAnimatedProps(() => ({
    renderToHardwareTextureAndroid: transitioning.value,
  }));
  return (
    <Animated.View
      testID={testID}
      animatedProps={textureWhileMoving}
      style={[style, enter.style]}
      onLayout={enter.onLayout}
      exiting={screenOut}>
      {children}
    </Animated.View>
  );
}
/**
 * The tab cross-fade. M3 fade-through timing, spelled once here rather than as a
 * raw `.duration()` at the call site (see the App.tsx transition-builder gate).
 */
const FADE = { duration: TOKENS.motion.duration.fast } as const;

/**
 * A top-level tab's layer, mounted once and then kept alive.
 *
 * The tabs used to mount on entry and unmount on exit, each wrapped in
 * `AfterPaint` and carrying `entering`/`exiting` layout animations. That cost a
 * tab switch twice over (Amit, 2026-09-04: "slow and janky", both a delay before
 * anything happened AND a stutter during the fade):
 *
 *   1. The delay was the remount — the whole screen tree, its queries and its
 *      list rebuilt on every visit, plus `AfterPaint`'s deliberate one-frame
 *      hold before any of it was even asked to render.
 *   2. The stutter was the layout animation. Reanimated's `entering`/`exiting`
 *      run on mount/unmount of the whole subtree, so the fade competed with the
 *      very work it was trying to cover.
 *
 * So: mount lazily (nothing is built until first visited), then never unmount,
 * and cross-fade `opacity` on a shared value instead — a GPU-only property that
 * costs nothing to animate and needs no layout pass. `display: 'none'` when
 * fully hidden keeps an inactive tab out of layout entirely; `pointerEvents`
 * stops an invisible layer eating touches mid-fade.
 */
function TabLayer({
  active,
  style,
  children,
}: {
  active: boolean;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  // Mount on first activation and stay mounted. An unvisited tab costs nothing.
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active) {
      setMounted(true);
    }
  }, [active]);

  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, FADE);
  }, [active, opacity]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    // A fully faded tab leaves layout entirely, so its list is not measured
    // behind the active one — but the subtree stays MOUNTED, which is the whole
    // point: state, scroll position and cached queries all survive the switch.
    display: opacity.value === 0 ? ('none' as const) : ('flex' as const),
  }));

  if (!mounted) {
    return null;
  }
  return (
    <Animated.View
      style={[style, animated]}
      // Touches are refused the moment the tab stops being active, not when the
      // fade ends, so a half-faded layer cannot swallow a tap.
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
      {children}
    </Animated.View>
  );
}

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
  /**
   * ADR-0026: microphone, camera and (Android 13+) notifications, asked for
   * on one explained screen before Home rather than as three bare dialogs over
   * it. Sits after policyGate and before ready in the same boot machine, so no
   * route can reach Home around it.
   */
  | { phase: 'permissions' }
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
  | { phase: 'permissions' }
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

  /*
   * The member first-run must never open on the provider path.
   *
   * Member and provider are separate worlds (Amit, 2026-09-03): a provider sets
   * up their OWN profile in provider onboarding and must not be asked for a
   * member username, age bracket or member policy on the way.
   *
   * The trap is that a provider MID-onboarding is indistinguishable from a
   * brand-new member by the flags above - `role` is still 'member' and
   * `profile_completed_at` is still null right up until
   * `complete_provider_onboarding` succeeds, and their wallet is empty - so
   * `needsUsername` is true for them. Seen on a device 2026-09-05: the member
   * profile modal opened over provider onboarding.
   *
   * This check lives HERE, not at the call sites. It used to be an early return
   * in the boot effect only, while `bootPhaseAfterAuth` is called from four
   * places - so three of them routed a provider into the member first-run. One
   * decision point is the whole point: a caller cannot forget a rule it does
   * not have to know.
   *
   * Two signals, because either alone has a hole. `identity_state` is the
   * durable server-side one (migration 054: "THE single signal both the app and
   * complete_provider_onboarding read") and survives a reinstall; the persisted
   * intent covers someone who tapped "Become a partner" and has not reached the
   * PAN step yet, whose `identity_state` is still 'none'.
   */
  const onProviderPath =
    storage.get(PROVIDER_INTENT_KEY) === '1' ||
    (p?.identity_state !== undefined && p.identity_state !== 'none');

  if (!onProviderPath && (needsUsername || needsAge)) {
    return { phase: 'profileSetup', needsAge, needsUsername };
  }

  const { data: pending } = await supabase.rpc('pending_policy_acceptances');
  if (Array.isArray(pending) && pending.length > 0) {
    return { phase: 'policyGate' };
  }
  // ADR-0026: policies first (they are a legal gate), then the device. A
  // check, never a request — the screen does the asking, with the reasons.
  if (!gateSatisfied(await checkGate())) {
    return { phase: 'permissions' };
  }
  return { phase: 'ready' };
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
  const resetConversation = useStore(s => s.resetConversation);
  const setNotice = useStore(s => s.setNotice);
  const refillVisible = useStore(s => s.refillVisible);
  const closeRefill = useStore(s => s.closeRefill);
  const walletVisible = useStore(s => s.walletVisible);
  const closeWallet = useStore(s => s.closeWallet);
  const pendingProviderApply = useStore(s => s.pendingProviderApply);


  // While the provider-signup intent is set, KEEP the route on the onboarding
  // screen. The boot machine bumps `attempt` several times (auth listener,
  // onDone, permission grants), and each re-run resets the route to Home before
  // the flag can steer it; enforcing it here, on every render, wins over those
  // one-off resets. The flag is cleared when the onboarding is left or completed,
  // which lets the route move again.
  useEffect(() => {
    if (boot.phase === 'ready' && pendingProviderApply && route.name !== 'apply') {
      if (useHomeTour.getState().active) {
        useHomeTour.getState().skip();
      }
      setRoute({ name: 'apply', from: 'home' });
    }
  }, [boot.phase, pendingProviderApply, route.name]);

  /**
   * Demo-capture policy: lifted for @example.test accounts in the `internal`
   * build, blocked everywhere else. Both gates (build variant + account) are
   * enforced independently in the native layer — this just drives the auth
   * signal. See src/lib/demoCapture.ts and WindowChromeModule.kt.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyDemoCapturePolicy(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

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
        // Every fresh boot / re-auth lands on Home. A stored conversation or a
        // notification tap below may override this, but a stale route must not
        // survive: signing out from Settings and back in was dropping the user
        // on Settings instead of Home.
        setRoute({ name: 'home' });
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
        // "Become a partner" before auth → provider onboarding, and it SKIPS the
        // member first-run (username/age/policy) entirely. Member and provider are
        // separate worlds (Amit, 2026-09-03): a provider sets up their OWN profile
        // in the provider onboarding, so a provider signup must never be routed
        // through the member first-run gates. The flag is read fresh (set in
        // OnboardingScreen) and NOT cleared here — the boot effect can run more
        // than once, and clearing on the first run let a later run fall through to
        // the member path and Home. It is cleared when the onboarding is left or
        // completed (see the apply route below).
        if (storage.get(PROVIDER_INTENT_KEY) === '1') {
          // Restore the reactive flag from the persisted intent (the in-memory one
          // can be reset in the auth → boot transition) so the tour gate and the
          // route-enforcing effect below see it too.
          useStore.getState().setPendingProviderApply(true);
          if (useHomeTour.getState().active) {
            useHomeTour.getState().skip();
          }
          setBoot({ phase: 'ready' });
          setRoute({ name: 'apply', from: 'home' });
          track('app_open');
          return;
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

      /*
       * Harness-only capture profile. `companionchat://call-sim?resolution=hd|fhd`
       * is opened by scripts/call-sim.mjs before each matrix arm so the three
       * media adapters share one resolution without a rebuild. Production never
       * emits this URI.
       */
      const callSim = url.match(/^companionchat:\/\/call-sim(?:\?(.*))?$/);
      if (callSim) {
        const resolution = parseVideoResolution(
          (callSim[1] ?? '').match(/resolution=([^&]+)/)?.[1],
        );
        if (resolution) setVideoResolution(resolution);
        return;
      }

      const peer = url.match(/^companionchat:\/\/peer\/(.+)$/)?.[1];
      if (peer !== undefined) {
        // Query strings are ignored for routing; strip so a harness-augmented
        // peer URI still opens the chat.
        const peerId = peer.split('?')[0] ?? peer;
        if (isUuid(peerId)) {
          setRoute({ name: 'chat', providerId: peerId, from: 'home' });
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

    // Push registration. The permissions themselves were granted on the
    // PermissionsScreen before this phase (ADR-0026) — until 2026-09-06 this
    // effect fired three bare system dialogs over Home, one after another —
    // so `startPush()` finds POST_NOTIFICATIONS already granted and only
    // fetches and uploads the token. The policy still decides whether a
    // permanent denial found later (revoked in Settings) shows the alert.
    void (async () => {
      try {
        const permissions = await fetchPermissionsConfig();
        const notificationLevel = effectivePermissionLevel(
          permissions,
          'notification',
        );

        // Propagate the effective policy so ensurePermission() in push.ts
        // knows whether to show the blocked-settings alert on Android 13+.
        setNotificationPolicy(notificationLevel);

        if (notificationLevel !== 'optional') {
          unsubscribeToken = await startPush();
        } else {
          try {
            unsubscribeToken = await startPush();
          } catch {
            // Optional for internal builds — boot continues without notifications.
          }
        }

      } catch {
        // Push registration is best-effort; failures here do not affect boot.
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

  /*
   * Every navigation declares its direction before it changes the route.
   *
   * `navDirection` (a shared value in motion.ts) is read by `screenIn`/
   * `screenOut` at the moment those builders run — which for the leaving screen
   * is at unmount, after its props are gone — so a push and a pop cannot be told
   * apart from the route alone. `pushRoute` goes deeper (slide from the right),
   * `popRoute` returns (slide from the left). Tab switches use the top-level
   * fade, which ignores direction, so they can go through either.
   */
  const pushRoute = useCallback((next: MemberRoute) => {
    setNavDirection('forward');
    setRoute(next);
  }, []);
  const popRoute = useCallback((next: MemberRoute) => {
    setNavDirection('back');
    if (next.name === 'home') {
      revealHome();
    }
    setRoute(next);
  }, []);

  const openChat = useCallback(
    (id: string, from: ChatDoor = 'home') => {
      pushRoute({ name: 'chat', providerId: id, from });
      track('conversation_opened');
      storage.set(LAST_PROVIDER_KEY, id);
    },
    [pushRoute],
  );

  const openProvider = useCallback(
    (id: string, from: 'home' | 'favourites' | 'chat' = 'home') => {
      pushRoute({ name: 'providerDetail', providerId: id, from });
      track('directory_viewed');
    },
    [pushRoute],
  );

  // Back from a chat honours the door it was opened from (Home or a profile),
  // matching the hardware-back handler rather than always dumping to Home.
  const leaveChat = useCallback(() => {
    setNavDirection('back');
    const current = routeRef.current;
    const next: MemberRoute =
      current.name === 'chat' ? (memberParent(current) ?? { name: 'home' }) : { name: 'home' };
    if (next.name === 'home') {
      revealHome();
    }
    setRoute(next);
    resetConversation();
    storage.remove(LAST_PROVIDER_KEY);
  }, [resetConversation]);

  const backToHome = useCallback(() => popRoute({ name: 'home' }), [popRoute]);

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
        setNavDirection('back');
        closeWallet();
        return true;
      }
      if (refillVisible) {
        closeRefill();
        return true;
      }
      // Below the overlays, above any route pop: a screen with something to
      // protect (a live paid session, a call) holds a guard and takes the press
      // to its own dialog. This is the ONLY hardware-back subscription that
      // decides navigation; screens no longer subscribe themselves, because RN
      // fires subscriptions last-registered-first and this effect re-subscribes
      // whenever the Recharge overlay toggles — so a chat's own listener could
      // be outranked by this one and the chat popped out from under a paid
      // session (src/lib/backGuard.ts).
      if (consumeBack()) {
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
        // A hardware/gesture back is always a pop, so the leaving screen slides
        // off to the right and its parent enters from the left. Home's slide is
        // kicked here, before the route changes, while the overlay still covers it.
        setNavDirection('back');
        if (parent.name === 'home') {
          revealHome();
        }
        setRoute(parent);
        return true;
      }
      const providerBack = providerParent(providerRoute);
      if (providerBack !== null) {
        setNavDirection('back');
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
     * Welcome IS sign-in — there is no separate AuthScreen to hand off to.
     *
     * There used to be a second page here ("Someone's here to listen" / Google
     * / phone) that a returning user landed on after signing out, which read as
     * a redundant, disconnected screen bolted onto the welcome flow (Amit,
     * 2026-09-03: "sign out still takes me to this redundant page ... remove
     * this from app and wire welcome screen"). OnboardingScreen already owns
     * the whole sign-in — welcome, choose-a-way-in, phone/OTP, Google, and
     * Become a partner — so every path back to `signedOut` renders it, with no
     * `welcomeSeen` branch deciding between it and AuthScreen.
     *
     * A `boot.message` (the rare browser-redirect auth failure) has nowhere
     * dedicated to show anymore, so it surfaces as the ordinary toast notice
     * instead of a bespoke error screen.
     */
    if (boot.message !== undefined) {
      setNotice(boot.message);
    }
    return (
      <OnboardingScreen
        onDone={() => {
          // Splash over the re-read, same reason AuthScreen used to give:
          // keep the welcome from replaying under a live session between
          // "session set" and "boot resolved".
          setBoot({ phase: 'loading' });
          setAttempt(a => a + 1);
        }}
      />
    );
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
        onAccepted={async () => {
          // Not straight to ready: the boot machine decides what comes after
          // policies (ADR-0026 puts the permissions gate there).
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

  // ADR-0026: the same reasoning as policyGate — rendered here in the boot
  // machine, not inside SignedIn, so nothing can route around it.
  if (boot.phase === 'permissions') {
    return (
      <PermissionsScreen
        onGranted={async () => {
          const profile = await getSignedInProfile();
          const nextBoot = await bootPhaseAfterAuth(profile);
          setBoot(nextBoot);
          if (nextBoot.phase === 'ready') {
            track('app_open');
          }
        }}
        onSignOut={() => {
          void signOut();
        }}
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
  openProvider: (id: string, from?: 'home' | 'favourites' | 'chat') => void;
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

  /*
   * Stable, so `memo(FloatingToolbarView)` can actually hold.
   *
   * It was an inline arrow at the call site, which is a new function identity on
   * every render of Root - so the memo compared unequal every time and the whole
   * toolbar re-rendered on any state change anywhere above it, including every
   * keystroke that moves a store value. The memo was there; the prop defeated it.
   */
  const onSelectTab = useCallback((key: 'home' | 'settings' | 'call' | 'favourites') => {
    if (key === 'home') {
      setRoute({ name: 'home' });
    } else if (key === 'settings') {
      setRoute({ name: 'settings' });
    } else if (key === 'call') {
      setRoute({ name: 'calls' });
    } else if (key === 'favourites') {
      setRoute({ name: 'favourites' });
    }
    // `setRoute` is a useState setter, so React guarantees a stable identity and
    // this list never actually changes - it is declared because a dependency
    // that is stable BY ARGUMENT is one edit away from not being.
  }, [setRoute]);

  /*
   * Which tab the bar highlights. It STICKS while the bar is hidden.
   *
   * Now that the bar is never unmounted, a pushed screen would otherwise flip
   * `active` to a fallback and back again — animating the indicator's spring and
   * fade on a bar nobody can see, twice per push/pop. Holding the last real tab
   * means the prop simply does not change while pushed, so the memo holds and
   * the indicator never moves.
   *
   * Written during render on purpose: this is derived, idempotent, and must not
   * lag the route by a frame the way an effect would. `tabFor` is null exactly
   * when `transitionFor(route)` is 'push', so the ref only ever takes a real
   * destination.
   */
  const tabFor: ToolbarKey | null =
    route.name === 'home'
      ? 'home'
      : route.name === 'settings'
        ? 'settings'
        : route.name === 'calls'
          ? 'call'
          : route.name === 'favourites'
            ? 'favourites'
            : null;
  const lastTabRef = useRef<ToolbarKey>('home');
  if (tabFor !== null) {
    lastTabRef.current = tabFor;
  }
  const activeTab = lastTabRef.current;
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

  /*
   * The in-render navigations declare direction the same way Root's do (see the
   * `pushRoute`/`popRoute` note there): `setNavDirection` before the setter, so
   * `screenIn`/`screenOut` know whether this is a push or a pop. Root's own
   * `openChat`/`leaveChat`/`backToHome` (passed in) already carry direction;
   * these cover the pushes and pops wired directly into child screens here.
   */
  const pushRoute = useCallback(
    (next: MemberRoute) => {
      setNavDirection('forward');
      setRoute(next);
    },
    [setRoute],
  );
  const popRoute = useCallback(
    (next: MemberRoute) => {
      setNavDirection('back');
      if (next.name === 'home') {
        revealHome();
      }
      setRoute(next);
    },
    [setRoute],
  );
  const pushProvider = useCallback(
    (next: ProviderRoute) => {
      setNavDirection('forward');
      setProviderRoute(next);
    },
    [setProviderRoute],
  );
  const popProvider = useCallback(
    (next: ProviderRoute) => {
      setNavDirection('back');
      setProviderRoute(next);
    },
    [setProviderRoute],
  );

  // Home's slide-in on a pop is driven from the pop itself (motion.ts `revealHome`).
  const homeLayer = useHomeRevealStyle();

  // A ring, foreground: route the incoming call to the right tree's call screen.
  // Declared before the early return so the hook order is stable.
  const onIncoming = useCallback(
    (incoming: IncomingCall) => {
      if (role === 'provider') {
        pushProvider({ name: 'call', peerId: incoming.callerId, direction: 'in', callId: incoming.callId, medium: incoming.medium });
      } else {
        pushRoute({ name: 'call', providerId: incoming.callerId, direction: 'in', callId: incoming.callId, medium: incoming.medium });
      }
    },
    [role, pushRoute, pushProvider],
  );
  useIncomingCalls(selfId, onIncoming);

  /*
   * A chat request rings too (goal item 13). Only in the provider tree: a
   * member never receives one, and subscribing them to a filter that can never
   * match is a socket for nothing.
   *
   * The member has no directory row, so the name is the same pseudonymous
   * fallback ProviderHomeScreen uses for a thread — never a real name we do not
   * have and would not publish.
   */
  const setIncomingRequest = useStore(s => s.setIncomingRequest);
  const onIncomingRequest = useCallback(
    (request: { requestId: string; conversationId: string; initiatorId: string }) => {
      const known = (conversations ?? []).find(c => c.peer_id === request.initiatorId);
      setIncomingRequest({
        requestId: request.requestId,
        conversationId: request.conversationId,
        peerId: request.initiatorId,
        peerName: known?.peer_display_name ?? `Member ${request.initiatorId.slice(0, 4)}`,
      });
    },
    [conversations, setIncomingRequest],
  );
  useIncomingChatRequests(role === 'provider' ? selfId : undefined, onIncomingRequest);

  /** Where accepting a ring lands: the provider tree's own chat route. */
  const openProviderConversation = useCallback(
    (peerId: string) => pushProvider({ name: 'chat', peerId }),
    [pushProvider],
  );

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
        {/* One screen at a time, keyed on the route so a change remounts and the
          * M3 push/pop plays: the leaving screen slides off on `screenOut`, the
          * arriving one enters on `screenIn`, direction from `navDirection`. The
          * provider tree used to hard-cut between these. */}
        <PushedLayer key={providerRoute.name} style={styles.fill}>
          {providerRoute.name === 'call' ? (
            <CallScreen
              providerId={providerRoute.peerId}
              direction={providerRoute.direction}
              callId={providerRoute.callId}
              medium={providerRoute.medium}
              // Symmetry with the member tree: hanging up returns to that peer's
              // chat, not the provider home (user 2026-08-31).
              onEnd={() => popProvider({ name: 'chat', peerId: providerRoute.peerId })}
            />
          ) : providerRoute.name === 'chat' ? (
            <ChatScreen
              providerId={providerRoute.peerId}
              onBack={() => popProvider({ name: 'home' })}
              onStartCall={channel =>
                pushProvider({
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
              onBack={() => popProvider({ name: 'home' })}
              onDeleted={() => {
                popProvider({ name: 'home' });
                onSignedOut();
              }}
              onSignedOut={onSignedOut}
              onUsage={() => pushProvider({ name: 'usage' })}
            />
          ) : providerRoute.name === 'payout' ? (
            <ProviderBankScreen onBack={() => popProvider({ name: 'home' })} />
          ) : providerRoute.name === 'usage' ? (
            <UsageLedgerScreen onBack={() => popProvider({ name: 'settings' })} />
          ) : (
            <ProviderHomeScreen
              onOpenConversation={peerId => pushProvider({ name: 'chat', peerId })}
              onOpenSettings={() => pushProvider({ name: 'settings' })}
              onOpenPayout={() => pushProvider({ name: 'payout' })}
            />
          )}
        </PushedLayer>
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
      {/* Settings is a docked nav tab, so Home no longer opens it. The wrapper
          carries Home's slide-in on a pop (see `homeShift`). */}
      <Animated.View style={[styles.fill, homeLayer]}>
        <HomeScreen
          onOpenConversation={openChat}
          onOpenProvider={openProvider}
          onSeeAllChats={() => pushRoute({ name: 'chatsList' })}
        />
      </Animated.View>

      {/* Favourites is a top-level tab: the people this member has hearted. */}
      <TabLayer active={route.name === 'favourites'} style={styles.tabLayer}>
        <FavouritesScreen onOpenProvider={id => openProvider(id, 'favourites')} />
      </TabLayer>

      {/* Calls is a top-level tab (empty state for now). A real destination so
          the nav's Calls icon does something on tap rather than reading as dead. */}
      <TabLayer active={route.name === 'calls'} style={styles.tabLayer}>
        <CallsScreen />
      </TabLayer>

      {/* Settings is a top-level tab: its own layer filling the content area
          (which ends at the docked nav's top edge), not inside the pushed overlay
          that the nav does not survive. A tab switch, not a push: the M3
          top-level pattern (a fade, no slide) so Home↔Settings does not read as
          a sideways jump. */}
      <TabLayer active={route.name === 'settings'} style={styles.tabLayer}>
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
          onBlocked={() => pushRoute({ name: 'blocked' })}
          onTransactions={() => pushRoute({ name: 'transactions' })}
          onUsage={() => pushRoute({ name: 'usage' })}
        />
      </TabLayer>

      {/* No opaque cover between Home and the pushed overlays any more.
          There used to be an instant white `coverHome` at zIndex 9 so a
          full-width slide would reveal a neutral surface rather than the feed.
          With the M3 fade-through (a 24dp slide under a fade) the cover was the
          transition's worst enemy: it snapped Home to white in one frame, the
          overlay then faded in white-on-white — invisible — and the deferred
          content popped in un-animated. Frame-stepped on device 2026-09-02:
          Home → pure white → chat. The overlay's own opaque surface fading in
          over the visible Home IS the pattern; nothing needs to hide Home. */}

      {route.name === 'chatsList' ||
      (route.name === 'chat' && route.from === 'chatsList') ? (
        // Full-screen Chats modal. Stays mounted under a chat opened from here
        // so back returns to this list, not Home (docs/flows.md).
        <PushedLayer style={styles.overlay}>
          <ChatsListScreen
            onBack={backToHome}
            onOpenConversation={id => openChat(id, 'chatsList')}
          />
        </PushedLayer>
      ) : null}

      {route.name === 'chat' ? (
        /*
         * `AfterPaint` OUTSIDE the animated overlay, not inside it.
         *
         * Inside, the container began its fade+slide as an empty white box and
         * the screen's content mounted one frame later, un-animated, into a
         * container already most of the way through its entrance. Outside, the
         * heavy commit lands first and the entrance starts on the frame the
         * content is actually there — one frame of latency the eye cannot see,
         * in exchange for an animation that animates the screen rather than a
         * blank. Reanimated runs `exiting` for the topmost animated view of a
         * removed subtree, so the pop still plays when AfterPaint unmounts.
         */
        <AfterPaint>
          <PushedLayer style={[styles.overlay, route.from === 'chatsList' && styles.overlayStack]}>
            <ChatScreen
              providerId={route.providerId}
              onBack={leaveChat}
              onOpenProfile={id => openProvider(id, 'chat')}
              onStartCall={channel =>
                pushRoute({ name: 'call', providerId: route.providerId, direction: 'out', callId: null, medium: channel === 'video' ? 'video' : 'voice' })
              }
            />
          </PushedLayer>
        </AfterPaint>
      ) : route.name === 'call' ||
        route.name === 'providerDetail' ||
        route.name === 'apply' ||
        route.name === 'applicationStatus' ||
        route.name === 'blocked' ||
        route.name === 'transactions' ||
        route.name === 'usage' ? (
        // Same shape as the chat overlay: content first, then the entrance.
        <AfterPaint>
        <PushedLayer style={styles.overlay}>
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
                  pushRoute({
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
              // Leaving onboarding clears the provider-signup intent so a later
              // boot does not re-route back into it.
              onBack={() => {
                storage.remove(PROVIDER_INTENT_KEY);
                useStore.getState().setPendingProviderApply(false);
                backToHome();
              }}
              // Auto-approve: completing onboarding flips role → 'provider', which
              // re-renders into the provider tree (= provider home). The refetch is
              // the belt-and-suspenders that guarantees the flip if the screen's own
              // invalidate has not landed yet. No more applicationStatus.
              onSubmitted={() => {
                storage.remove(PROVIDER_INTENT_KEY);
                useStore.getState().setPendingProviderApply(false);
                void queryClient.invalidateQueries();
              }}
            />
          ) : route.name === 'applicationStatus' ? (
            <ProviderStatusScreen onBack={backToHome} onEdit={() => pushRoute({ name: 'apply', from: 'applicationStatus' })} />
          ) : route.name === 'blocked' ? (
            <BlockedUsersScreen onBack={backToHome} />
          ) : route.name === 'usage' ? (
            <UsageLedgerScreen onBack={() => popRoute({ name: 'settings' })} />
          ) : (
            <TransactionHistoryScreen onBack={() => popRoute({ name: 'settings' })} />
          )}
        </PushedLayer>
        </AfterPaint>
      ) : null}
      </View>

      {/*
        * The docked bottom bar (WhatsApp/iMessage). It is `position: 'absolute'`
        * over the content area, NOT in the layout flow — the two tab screens pad
        * their own scroll content by `NAV_BAR_HEIGHT` so no full-width row sits
        * under it and steals a tab's tap. Calls stay gated (`CALLS_ENABLED`).
        *
        * ALWAYS RENDERED, and hidden on pushed screens rather than unmounted.
        * The conditional it replaces rebuilt a native RenderEffect blur surface
        * and eight animated children on every push and every pop, inside the
        * frame that was already animating the transition. Because the bar takes
        * no layout, keeping it mounted costs nothing; `display: none` keeps it
        * out of drawing too. See the note in FloatingToolbar itself.
        *
        * Visibility comes from `transitionFor`, not a hand-written list of route
        * names: it is an exhaustive switch, so a new route has to say which kind
        * it is or fail typecheck. 'root' and 'tab' are the destinations the bar
        * navigates between; 'push' is everything deeper.
        */}
      <FloatingToolbar
        active={activeTab}
        visible={transitionFor(route) !== 'push'}
        callEnabled={CALLS_ENABLED}
        homeBadgeCount={totalUnread}
        onSelect={onSelectTab}
      />
      <RechargeWalletPage />
      <RechargeScreen />
      {/* One feedback sheet for the whole app: a session can end in a chat or
          in a call started from a provider's page, and the sheet has to outlive
          whichever screen noticed (goal item 14). It renders nothing until the
          store holds a session to rate. */}
      <SessionFeedbackSheet />
      {/* The chat ring, above every screen and both nav bars (goal item 13).
          Renders nothing unless a request is live, and only a provider ever
          receives one. `openConversation` is the provider tree's own opener,
          so accepting lands them in the thread. */}
      <ChatRingScreen onOpenConversation={openProviderConversation} />
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
      {/*
       * The blur root, wrapping everything a `Frost` can appear inside.
       *
       * A `BlurSurface` paints a region of ITS ROOT's blurred RenderNode, so it
       * needs an ancestor that owns that node — the same relationship the
       * reference has between `SizeNotifierFrameLayout` and the bars inside it.
       * At the app root rather than per screen because Frost is used by the nav
       * bar, the chat header and the composer dock, which do not share a screen
       * ancestor.
       *
       * It costs nothing on a screen with no frosted bar: the root skips its
       * recording entirely while no surface is asking for a blur, and records at
       * most once per frame otherwise (see BlurPackage.kt).
       */}
      <BlurRootOrView style={fill.root}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <Shell />
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </BlurRootOrView>
    </GestureHandlerRootView>
  );
}

/**
 * `BlurRoot` when the native view is in this binary, a plain View otherwise.
 *
 * An OTA JS update can land on an APK built before `BlurPackage.kt` existed;
 * mounting an unregistered native component there is a red screen, not a
 * degraded blur. `Frost` makes the same check on its own side and paints a solid
 * plate, so the pair degrade together.
 */
function BlurRootOrView({
  style,
  children,
}: {
  style: ViewStyle;
  children: React.ReactNode;
}) {
  if (!BLUR_SURFACE_AVAILABLE) {
    return <View style={style}>{children}</View>;
  }
  return <BlurRoot style={style}>{children}</BlurRoot>;
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
