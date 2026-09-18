import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
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
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
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
import {
  ForceLightTheme,
  ThemeProvider,
  useStyles,
  useThemeMode,
} from './src/theme/ThemeProvider';
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
import { onForegroundPush, setNotificationPolicy, startPush } from './src/lib/push';
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
import { sweepExpiredOutbox } from './src/lib/outboxStore';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import {
  useFrameWatch,
  trackQuerySlow,
  trackScreenOpened,
} from './src/lib/perfTelemetry';
import { supabase } from './src/lib/supabase';
import { applyDemoCapturePolicy } from './src/lib/demoCapture';
import { currentSession, handleAuthDeepLink, signOut } from './src/api/auth';
import {
  effectivePermissionLevel,
  FALLBACK_PERMISSIONS,
  useClientSupport,
  type PermissionsConfig,
} from './src/api/appConfig';
import { currentVersionCode, startImmediateUpdate } from './src/lib/appUpdate';
import { supportVerdict } from './src/lib/clientSupport';
import {
  getSignedInProfile,
  isFirstUser,
  needsAgeBracket,
  needsLanguagePreference,
  needsProfileSetup,
} from './src/api/profileSetup';
import type { Profile } from './src/lib/database.types';
import { CALLS_ENABLED, useIncomingCalls, type IncomingCall, endCall} from './src/api/calls';
import {
  parseVideoResolution,
  setVideoResolution,
} from './src/api/callMedia/profile';
import { keys, useConversations, useGlobalOutboxDrain, useSelfId } from './src/api/chat';
import { useRole } from './src/api/provider';
import { useStore } from './src/store/useStore';
import { PolicyGateScreen } from './src/screens/PolicyGateScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { SessionFeedbackSheet } from './src/components/SessionFeedbackSheet';
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
import { InvoicesScreen } from './src/screens/InvoicesScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';
import { SplashScreen } from './src/screens/SplashScreen';
import { TransactionHistoryScreen } from './src/screens/TransactionHistoryScreen';
import { UsageLedgerScreen } from './src/screens/UsageLedgerScreen';

initSentry();

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
/** Theme-independent, so `TabLayer` needs no `useStyles`. */
const HIDDEN_LAYER = StyleSheet.create({ hidden: { display: 'none' } });

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

  /*
   * `display` is REACT state here, not a value the animated style computes, and
   * that distinction is a device-found bug rather than a preference.
   *
   * It used to be `display: opacity.value === 0 ? 'none' : 'flex'` inside the
   * worklet. On the Favourites tab that left the top bar half-drawn: the wallet
   * chip painted and the title and the magnifier beside it did not, on a row
   * whose three children are siblings. What separates them is a background —
   * Android's view flattening (NativeViewHierarchyOptimizer) folds a View or
   * Text that draws nothing of its own into its parent, and a flattened node
   * inside a subtree whose `display` flips on the UI thread, behind React's
   * back, is not re-created when the subtree comes back. The chip has a fill,
   * so it survives as a real view; a plain Text does not.
   *
   * Driving `display` from state puts the change back through the normal
   * commit, which rebuilds the flattened children correctly. The hide is
   * delayed by the fade's own duration so it still happens only once the layer
   * is invisible, which is all the original worklet was buying.
   */
  const [laidOut, setLaidOut] = useState(active);
  useEffect(() => {
    if (active) {
      setLaidOut(true);
      return;
    }
    const timer = setTimeout(() => setLaidOut(false), FADE.duration);
    return () => clearTimeout(timer);
  }, [active]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!mounted) {
    return null;
  }
  return (
    <Animated.View
      // A fully faded tab leaves layout entirely, so its list is not measured
      // behind the active one — but the subtree stays MOUNTED, which is the
      // whole point: state, scroll position and cached queries all survive the
      // switch.
      style={[style, animated, laidOut ? null : HIDDEN_LAYER.hidden]}
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

/*
 * TanStack's default OnlineManager listens for the browser's `online`/
 * `offline` window events, which React Native never dispatches
 * (2026-09-17 audit; confirmed reading @tanstack/query-core's own source —
 * `#online = true` at construction, and the listener it registers is
 * `window.addEventListener`). Without this, the library believes the app
 * is always online, so `retry`/`refetchOnReconnect` never pause against a
 * radio that is actually dead — every mutation burns its one retry
 * against nothing, and a send fails with a generic error at the exact
 * moment a member has no signal, rather than the paused/queued state
 * TanStack's whole retry model is meant to give it.
 * https://tanstack.com/query/latest/docs/framework/react/react-native
 *
 * `networkMode` is left at its default ('online'), not set to
 * 'offlineFirst' as a first read of the TanStack doc might suggest:
 * offlineFirst exists for a service-worker/HTTP-cache layer that can
 * satisfy the FIRST attempt from a local cache before the retry-pause
 * logic engages — this app has no such layer (React Query's in-memory
 * cache is not that; see lib/outbox.ts's own note that there is no local
 * message store), so offlineFirst would only mean every query still
 * attempts once while genuinely offline and fails with a live-network
 * error, which is the exact "Check your connection" vs "the server said
 * no" confusion this codebase has already been burned by once.
 */
onlineManager.setEventListener(setOnline => {
  return NetInfo.addEventListener(state => {
    setOnline(state.isConnected === true);
  });
});

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
   *
   * `needsLanguages` (migration 072) is independent of both: it is true for a
   * member who has never answered the language step, including one who already
   * has a name and a bracket. It is what makes this phase the browser-redirect
   * path's equivalent of the inline flow's language question — see
   * `PostAuthBoot`.
   */
  | {
      phase: 'profileSetup';
      needsAge: boolean;
      needsUsername: boolean;
      needsLanguages: boolean;
    }
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
 * `profileSetup` carries age/username/language flags so the screen knows which
 * steps to render. Only `needsAge` can be true without `needsUsername` (existing
 * member who predates migration 043); the reverse is always paired.
 *
 * `needsLanguages` (migration 072) is independent of both and is the flag that
 * makes this gate the ONLY way into the member tree. `OnboardingScreen` asks the
 * language question inline for the Credential Manager path, but the
 * browser-redirect sign-in returns through `handleAuthDeepLink` and unmounts
 * that screen before it can — so before this flag, choosing the browser instead
 * of the sheet was a way to never be asked. Same question either way now: the
 * two paths differ in where it is asked, never in whether.
 */
type PostAuthBoot =
  | {
      phase: 'profileSetup';
      needsAge: boolean;
      needsUsername: boolean;
      needsLanguages: boolean;
    }
  | { phase: 'policyGate' }
  | { phase: 'permissions' }
  | { phase: 'ready' };

async function bootPhaseAfterAuth(profile: Profile | null): Promise<PostAuthBoot> {
  /*
   * A null profile is a FAILED read, not "no profile": a signed-in user always
   * has a profile row (created on signup). Before this guard, a null profile
   * evaluated every needsUsername/needsAge/needsLanguages below as false (the
   * needsX helpers treat undefined as "not needed"), so a transient failure of
   * the profiles query — while the policy RPC happened to succeed — could
   * advance a member straight to `ready`, skipping the age, username and
   * language gates. The age gate is a legal/safety gate (ADR-0043), so this must
   * fail closed. Throwing routes the main boot to its retryable error screen
   * rather than silently bypassing a gate. (2026-09-09 audit)
   */
  if (profile === null) {
    throw new Error('Could not load your profile. Check your connection and try again.');
  }
  // Non-null past the guard; the optional chaining below is defensive, not for null.
  const p = profile;
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
   * Gated independently of age and username, not chained behind them.
   *
   * A member can legitimately have a bracket and a name and still no language
   * preference — anyone who signed up before migration 072, and anyone who came
   * in through the browser redirect while only the inline flow asked. Chaining
   * this behind `needsAge` would mean the only members ever asked are the ones
   * who happen to need both, which is how the bypass existed in the first place.
   */
  const needsLanguages = firstUser && needsLanguagePreference(p);

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

  if (!onProviderPath && (needsUsername || needsAge || needsLanguages)) {
    return { phase: 'profileSetup', needsAge, needsUsername, needsLanguages };
  }

  // ADR-0020: a failed check must not pass the gate. If the RPC errors (network,
  // DB fault), throw so the boot machine shows its error/retry screen rather than
  // silently advancing to `ready` — failing open would let a member through without
  // ever seeing the policy documents.
  const { data: pending, error: policyError } = await supabase.rpc('pending_policy_acceptances');
  if (policyError) throw policyError;
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
  /*
   * Read before `boot`, because the support gate renders ahead of every boot
   * phase. Public RPC, so it resolves without a session.
   */
  const { data: clientSupport } = useClientSupport();
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  // Ref so the AppState listener always reads the current phase without being
  // in the effect's dep array — the listener is registered once for lifetime.
  const bootPhaseRef = useRef(boot.phase);
  bootPhaseRef.current = boot.phase;
  const [attempt, setAttempt] = useState(0);
  // Bounds the H6 offline-session retry below: `isAuthRetryableFetchError`
  // covers more than "NetInfo says offline" (a captive portal, the auth
  // server itself being unreachable), so a case where the network reports
  // online but the auth fetch keeps failing must not retry forever.
  const authRetryCountRef = useRef(0);
  const [route, setRoute] = useState<MemberRoute>({ name: 'home' });
  const [providerRoute, setProviderRoute] = useState<ProviderRoute>({ name: 'home' });
  /*
   * A ring announced from outside the React tree: the notification's Answer
   * intent, the body tap, or an FCM push. It is HELD here rather than routed
   * here, because which tree it belongs to depends on the role and `useRole`
   * lives in `SignedIn`. Calling `setRoute` from this effect was the defect: the
   * provider tree renders `providerRoute` and nothing else, so every notification
   * a provider answered set a route their tree does not draw.
   */
  const [pendingIncoming, setPendingIncoming] = useState<PendingIncoming | null>(null);
  const clearPendingIncoming = useCallback(() => setPendingIncoming(null), []);
  /*
   * A message notification tapped, held the same way and for the same reason
   * as `pendingIncoming` above (2026-09-17 audit): `companionchat://peer/<id>`
   * is a role-agnostic deep link, and routing it from the effect that consumes
   * it — before `useRole` (in `SignedIn`) has resolved — meant a provider's
   * tap set a member-tree route their tree does not draw, and a member's tap
   * on a cold start raced the boot effect's own `setRoute({name:'home'})` for
   * whichever finished last.
   */
  const [pendingPeer, setPendingPeer] = useState<string | null>(null);
  const clearPendingPeer = useCallback(() => setPendingPeer(null), []);
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
  // walletVisible/refillVisible and their close actions are read live via
  // useStore.getState() inside the hardware-back handler (so it never
  // re-subscribes); they are intentionally not selected here.
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
        const { session, retryableError } = await currentSession();
        if (cancelled) {
          return;
        }
        if (session === null) {
          /*
           * H6, 2026-09-17 audit: a `null` session caused by a NETWORK
           * failure (the access token expired days ago and refreshing it
           * needed a request that could not be made) is not the same fact
           * as "this member signed out" — but until `retryableError` existed,
           * both looked identical here, and a signed-in member who cold-
           * launched offline was bounced to the sign-in screen. Wait for
           * connectivity and retry the WHOLE boot sequence (the same
           * `attempt` bump every other retry path in this file already uses)
           * instead of concluding signed-out on a question we could not
           * actually answer yet.
           */
          if (retryableError && authRetryCountRef.current < 3) {
            authRetryCountRef.current += 1;
            // `subscribe` only calls back on a CHANGE (query-core's own
            // OnlineManager.setOnline) — if the network is already back by
            // the time this runs (the failure was a transient blip, not a
            // genuine offline stretch), there is no future "change" left to
            // wait for and this would hang in 'loading' forever. Bounded to
            // 3 attempts: `isAuthRetryableFetchError` covers more than
            // "NetInfo says offline" (a captive portal, the auth server
            // itself down), so "network reports online but the fetch keeps
            // failing" must not retry forever either.
            if (onlineManager.isOnline()) {
              setAttempt(n => n + 1);
              return;
            }
            const unsubscribe = onlineManager.subscribe(online => {
              if (online) {
                unsubscribe();
                if (!cancelled) setAttempt(n => n + 1);
              }
            });
            return;
          }
          setBoot({ phase: 'signedOut' });
          return;
        }
        /*
         * Every fresh boot / re-auth lands on Home, full stop.
         *
         * This used to reopen the last conversation from a persisted
         * `companion.lastProvider`, so a cold start dropped you back into a
         * thread. Removed on Amit's call (2026-09-08): "always home page after
         * restart". A restart is the one moment someone has clearly chosen to
         * leave whatever they were doing, and reopening a paid conversation
         * uninvited is the wrong default in an app that bills by the minute.
         *
         * The whole key is gone rather than just this read — a stored value
         * nobody restores is a write that only ever misleads the next reader.
         *
         * A notification tap still wins over this — but not from here. It
         * used to be checked right here via `initialNotificationPeer()`
         * (2026-09-17 audit: that path never once fired — see push.ts for
         * why — and worse, calling `setRoute` unconditionally the line above
         * raced the deep-link effect below for every REAL notification tap,
         * which arrives as `companionchat://peer/<id>`. That effect now holds
         * the tap in `pendingPeer` instead of routing directly, and
         * `SignedIn` applies it once `role` is known — the same fix already
         * in place for an incoming call's `pendingIncoming`, and for the same
         * reason: the deep link only ever knew about the member tree.
         */
        setRoute({ name: 'home' });
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

  /*
   * Re-read the profile and advance the boot machine, one decision point for
   * every gate-transition callback below.
   *
   * bootPhaseAfterAuth now THROWS on a failed profile read (a null profile is a
   * read failure, not "no profile" — see its guard, which closes a gate-bypass).
   * The four transition callbacks used to inline this three-line block with no
   * catch, so a thrown read would become an uncaught rejection. That is
   * especially dangerous for `welcomePappal`, whose onDone fires AUTOMATICALLY
   * after the animation with no button to retry — a transient failure there
   * would strand the user on a finished animation. Routing a throw to the
   * retryable error screen (the same place the boot effect's own catch goes)
   * keeps every path recoverable. (2026-09-09 audit)
   */
  const advanceBootAfterProfile = useCallback(async () => {
    try {
      const profile = await getSignedInProfile();
      const nextBoot = await bootPhaseAfterAuth(profile);
      setBoot(nextBoot);
      if (nextBoot.phase === 'ready') {
        track('app_open');
      }
    } catch (err) {
      setBoot({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Could not continue. Please try again.',
      });
    }
  }, []);

  /*
   * A `signedOut` boot message (the rare browser-redirect auth failure) surfaces
   * as a toast. Done in an effect, not inside the render branch below: a store
   * write during render is a side effect that React StrictMode double-fires and
   * that can warn about updating another component while rendering. (2026-09-10)
   */
  useEffect(() => {
    if (boot.phase === 'signedOut' && boot.message !== undefined) {
      setNotice(boot.message);
    }
  }, [boot, setNotice]);

  // Prune outbox entries too old to replay — their conversation was never
  // reopened, so per-conversation replay would never collect them. Once per
  // launch. (2026-09-10 audit)
  useEffect(() => {
    sweepExpiredOutbox();
  }, []);

  // Drain the outbox for every conversation once signed in, not only
  // whichever chat the member happens to open (X7, 2026-09-17 audit).
  useGlobalOutboxDrain(boot.phase === 'ready');


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
       * PendingIntent is not a Firebase notification event — see push.ts for why
       * that path (`getInitialNotification` / `onNotificationOpenedApp`) never
       * fired at all and was removed (2026-09-17 audit).
       *
       * `isUuid` gates it because a deep-link URL is remote input: any value
       * could arrive on this scheme, and it must not reach a query unchecked.
       * Held in `pendingPeer` rather than routed directly, for the same reason
       * `pendingIncoming` is held below: `role` is not known here, and a bare
       * `setRoute` always writes the member tree, so a provider's own tap set a
       * route their tree never draws. `SignedIn` applies it once `role`
       * resolves. A peer link that arrives pre-session is dropped rather than
       * queued (`SignedIn` never mounts to consume it), because the id belongs
       * to a session that is not the current one.
       */
      /*
       * An incoming-call deep link, checked first. `companionchat://call/<peerId>
       * ?callId=<id>&action=answer|decline&medium=voice|video` is fired by the
       * CallStyle notification's Answer/Decline PendingIntents
       * (Conversations.callActionIntent), and by a tap on the notification body,
       * which reuses the answer intent.
       *
       * `action` is HONOURED, not ignored. It used to be parsed only in this
       * comment, so Decline opened the full incoming-call screen — the loudest
       * possible response to someone saying no, and it left the caller ringing
       * until the 30s sweep called it missed rather than declined. Declining ends
       * the call from here and never navigates; `end_call` derives the word
       * server-side (callee ends a ringing call => 'declined').
       *
       * Answer still routes into the screen rather than calling answer_call here:
       * that screen owns the lease and the media, and answering without it would
       * put a connected call behind a UI that does not exist yet. It routes via
       * `pendingIncoming`, which is where the role decides which tree gets it.
       *
       * Parsed with regex, not URLSearchParams, which Hermes does not ship.
       */
      const callMatch = url.match(/^companionchat:\/\/call\/([^?]+)\?(.*)$/);
      if (callMatch) {
        const callPeer = callMatch[1] ?? '';
        const qs = callMatch[2] ?? '';
        const callId = qs.match(/callId=([^&]+)/)?.[1];
        const action = qs.match(/action=([^&]+)/)?.[1] ?? 'answer';
        // `medium` is now sent by callActionIntent. The 'voice' fallback stays for
        // a notification posted by an older build still sitting in the shade.
        const medium = (qs.match(/medium=([^&]+)/)?.[1] ?? 'voice') as 'voice' | 'video';
        if (isUuid(callPeer) && callId !== undefined && isUuid(callId)) {
          void clearCall(callId);
          if (action === 'decline') {
            void endCall(callId);
            return;
          }
          setPendingIncoming({ peerId: callPeer, callId, medium });
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
        /*
         * HELD, not routed (2026-09-17 audit) — same reason `pendingIncoming`
         * is held above rather than routed from here: `role` is not known
         * yet, and a bare `setRoute` always writes the MEMBER tree. A
         * provider's own tap on a message notification set a route their
         * tree never draws, and a member's cold-start tap raced the boot
         * effect's own `setRoute({name:'home'})` for whichever won. `SignedIn`
         * applies `pendingPeer` once `role` resolves, choosing the tree.
         */
        if (isUuid(peerId)) {
          setPendingPeer(peerId);
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

    // A backgrounded tap on a message notification used to be picked up here
    // via `onNotificationOpen` (RNFirebase's `onNotificationOpenedApp`).
    // Removed (2026-09-17 audit): that API tracks a tap on a notification FCM
    // itself rendered, and this app's messages are always data-only and
    // self-built — see push.ts. The real path is the SAME
    // `Linking.addEventListener('url', ...)` the deep-link effect above
    // already runs, since `companionchat://peer/<id>` is a normal `Linking`
    // URL event whether the app was backgrounded or cold.
    return () => {
      unsubscribeToken?.();
    };
  }, [boot.phase]);

  /*
   * FOREGROUND-RETURN PERMISSION GUARD.
   *
   * Android's permission model allows the user to revoke a permission at any
   * time via Settings while the app is backgrounded. When they return, the app
   * would be running in a state where it believes permissions are granted but
   * they are not — mic, camera, and notification access are all mandatory for
   * this product.
   *
   * Platform doc: "You must check whether you have a permission every time you
   * perform an operation that requires that permission."
   * https://developer.android.com/training/permissions/requesting#handle-denied
   *
   * The listener tracks the PREVIOUS AppState so it only fires on the
   * `background → active` transition (user returned from another app or from
   * Settings), not on `inactive → active` (lock screen, notification shade,
   * or rotation). `inactive` is a transient Android state and is not the
   * "went to Settings" moment — only `background` is.
   *
   * Registered once (empty dep array); reads `bootPhaseRef` so it always has
   * the current phase without being in the dep array and without needing to
   * re-subscribe on every boot state change.
   */
  useEffect(() => {
    let prevState = AppState.currentState;

    const sub = AppState.addEventListener('change', async (next) => {
      const prev = prevState;
      prevState = next;
      /*
       * React Native has no window-focus event, so TanStack Query cannot tell
       * that the app was backgrounded unless AppState is handed to it. Without
       * this line `refetchIntervalInBackground: false` never takes effect and
       * `refetchOnWindowFocus` never fires on either.
       * https://tanstack.com/query/latest/docs/framework/react/react-native
       */
      focusManager.setFocused(next === 'active');
      if (prev === 'background' && next === 'active' && bootPhaseRef.current === 'ready') {
        // Who is online is the one thing that goes stale while the phone is in
        // a pocket, and the directory has no realtime channel (see useProviders).
        void queryClient.invalidateQueries({ queryKey: keys.providers });
        /*
         * DO NOT re-gate over a LIVE CALL (2026-09-17 audit). `setBoot({phase:
         * 'permissions'})` renders `PermissionsScreen` INSTEAD of `SignedIn`
         * (below), unmounting whatever was on screen — and CallScreen's own
         * contract is that unmounting hangs up: "Leaving the screen ends the
         * call: an unmount hangs up on the server if the call was live."
         *
         * The gate checks three permissions (permissionsGate.ts): RECORD_AUDIO
         * and CAMERA cannot plausibly lapse mid-call — the foreground service
         * CallScreen already starts keeps that access alive by design
         * (developer.android.com/training/permissions/requesting: "If you
         * launch a foreground service while the activity is visible... your
         * app can continue to access the data until the foreground service
         * stops") — but POST_NOTIFICATIONS is a plain Settings toggle that
         * does NOT kill the process, so it can genuinely be switched off
         * mid-call and trip this exact path on the very next foreground
         * return: a paid, live call ended by a notification-permission
         * toggle that has nothing to do with the call itself.
         *
         * Deferred, not skipped: `gateSatisfied` still runs, and if it
         * fails while a call IS on screen this simply waits for the next
         * foreground return (or the call ending) rather than re-checking
         * right now. The requirement stays mandatory (ADR-0026); only the
         * timing moves.
         */
        const onCallScreen =
          routeRef.current.name === 'call' || providerRouteRef.current.name === 'call';
        if (onCallScreen) {
          return;
        }
        const statuses = await checkGate();
        if (!gateSatisfied(statuses)) {
          setBoot({ phase: 'permissions' });
        }
      }
    });

    return () => sub.remove();
   
  }, []);

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
      /*
       * NOT READY YET: hand back to Android (2026-09-17 audit).
       *
       * Everything below this line assumes `route`/`providerRoute` describe
       * where the member or provider actually is, which is only true once
       * `boot.phase === 'ready'`. On splash, sign-in, profile setup, the
       * policy gate, permissions, the update screen, or the error screen,
       * `route` still holds its very first default value, so every branch
       * below fell through to "no parent, show the exit dialog" — except
       * that dialog is only ever RENDERED in the `ready` branch of Root's own
       * return (see the JSX at the bottom of this file), so the visible
       * effect was that back did nothing on those screens, and then the
       * dialog popped up unprompted the moment `ready` was reached, because
       * `exitDialogVisible` had been sitting `true` the whole time. A member
       * on their first launch could get "Leave Pappal?" as their welcome.
       *
       * Returning `false` here does what the docblock above already claims
       * for the true root case: hands the press to Android. On these
       * screens that means the OS's own back behaviour (typically closing
       * the activity), which is correct — there is no in-app parent to pop
       * to on a screen the member has not really "entered" yet.
       */
      if (bootPhaseRef.current !== 'ready') {
        return false;
      }
      // The Recharge overlay closes before any screen pops: it sits above
      // everything (zIndex 20) and is the thing the user most recently opened, so
      // back means it first. Settings is a normal route now (not an overlay), so
      // it pops through the parent map below like every other screen.
      if (useHomeTour.getState().active) {
        useHomeTour.getState().skip();
        return true;
      }
      // Overlay state and its close actions are read from the store HERE, not
      // from the effect's deps, for the same reason the route is read via a ref:
      // otherwise toggling the wallet/refill overlay tore down and re-subscribed
      // this listener, the very re-subscription jank the ref pattern avoids, and
      // it let a chat's own back guard be outranked mid-session. (2026-09-10)
      const store = useStore.getState();
      if (store.walletVisible) {
        setNavDirection('back');
        store.closeWallet();
        return true;
      }
      if (store.refillVisible) {
        store.closeRefill();
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
          store.resetConversation();
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
  // Empty deps: the listener is registered ONCE for Root's lifetime. Route,
  // overlay state and store actions are all read live inside onBack (refs and
  // useStore.getState()), so nothing here forces a re-subscription.
  }, []);

  /*
   * The client-support gate, ahead of EVERY other phase including sign-out.
   *
   * An unsupported build must not reach sign-in, because the thing it cannot do
   * is satisfy the server's RPC contract — authenticating first only gets it
   * deeper into a tree where nothing works. See `lib/clientSupport.ts` for the
   * incident this exists for: 10109 against migrations 077-079 deadlocked with
   * no error on any layer.
   *
   * `supportVerdict` fails open on both unknowns, so this renders nothing at all
   * until the public config has actually answered with a floor above this build.
   * A dev on an older native shell, anyone offline, and every current client
   * fall straight through.
   */
  const support = supportVerdict(
    currentVersionCode(),
    clientSupport?.min_version_code ?? 0,
    // Debug builds carry versionCode 1 (gradle's default; release codes are
    // passed in at build time), which is below any floor anyone would publish.
    // Without this the first raise of the floor would lock every dev out of the
    // hot-reload device. See `supportVerdict`.
    __DEV__,
  );
  if (support.state === 'must-update') {
    return (
      <View style={styles.fatal}>
        <Text style={styles.fatalTitle} allowFontScaling>
          Time for an update
        </Text>
        <Text style={styles.fatalBody} allowFontScaling>
          {/*
            * No version numbers in the copy. "You are on 10109, you need 10110"
            * is the truth and is useless to the person reading it — there is
            * exactly one action available and the sentence should be about that.
            * The numbers are in the verdict for logs, not for the screen.
            */}
          Pappal has changed since this version. Update from the Play Store to
          keep chatting. Your conversations and tokens are safe.
        </Text>
        <View style={styles.retryWrap}>
          <Button
            label="Update"
            onPress={() => {
              /*
               * Ask Play for the immediate (blocking) flow, which is the honest
               * match for a build that genuinely cannot continue. If Play has
               * nothing to offer — sideloaded, no Play Store, or the release has
               * not reached this device's track yet — `startImmediateUpdate`
               * resolves false and we open the store listing instead, so the
               * button is never a no-op.
               */
              void (async () => {
                if (!(await startImmediateUpdate())) {
                  void Linking.openURL('market://details?id=com.companionchat').catch(() => {
                    void Linking.openURL(
                      'https://play.google.com/store/apps/details?id=com.companionchat',
                    );
                  });
                }
              })();
            }}
          />
        </View>
      </View>
    );
  }

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
     * instead of a bespoke error screen — see the effect above that shows it, so
     * this render stays free of side effects.
     */
    return (
      <ForceLightTheme>
        {/*
         * Pinned dark-content regardless of the member's real preference —
         * ForceLightTheme only reaches components that read theme through
         * context, and the status bar icon colour does not. Mounted deeper
         * than Shell's own <StatusBar>, so it wins for as long as onboarding
         * is on screen; unmounting hands control back automatically.
         */}
        <StatusBar barStyle="dark-content" translucent />
        <OnboardingScreen
          onDone={() => {
            // Splash over the re-read, same reason AuthScreen used to give:
            // keep the welcome from replaying under a live session between
            // "session set" and "boot resolved".
            setBoot({ phase: 'loading' });
            setAttempt(a => a + 1);
          }}
        />
      </ForceLightTheme>
    );
  }

  if (boot.phase === 'profileSetup') {
    return (
      <ProfileSetupScreen
        needsAge={boot.needsAge}
        needsUsername={boot.needsUsername}
        needsLanguages={boot.needsLanguages}
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
            await advanceBootAfterProfile();
          }
        }}
      />
    );
  }

  if (boot.phase === 'welcomePappal') {
    return (
      <WelcomePappalScreen
        onDone={advanceBootAfterProfile}
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
          await advanceBootAfterProfile();
        }}
      />
    );
  }

  // ADR-0026: the same reasoning as policyGate — rendered here in the boot
  // machine, not inside SignedIn, so nothing can route around it.
  if (boot.phase === 'permissions') {
    return (
      <PermissionsScreen
        onGranted={advanceBootAfterProfile}
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
        pendingIncoming={pendingIncoming}
        onIncomingHandled={clearPendingIncoming}
        pendingPeer={pendingPeer}
        onPeerHandled={clearPendingPeer}
        onSignedOut={() => setBoot({ phase: 'signedOut' })}
        /*
         * Closes a gap in the provider-intent boot skip (2026-09-17 audit).
         * While `PROVIDER_INTENT_KEY` is set, the boot effect above skips
         * `bootPhaseAfterAuth` entirely — profileSetup, policyGate AND
         * permissions — which is the documented, deliberate shape of
         * "Become a partner" (Amit, 2026-09-03: "SKIPS the member first-run
         * ... entirely"). That is correct for the DURATION of the apply
         * flow: `bootPhaseAfterAuth`'s own `onProviderPath` check only
         * skips profileSetup, so a member policy modal opening over
         * provider onboarding was the exact bug it exists to prevent.
         *
         * But the skip does not end when onboarding does. The flag clears
         * on submission and the app flips straight to the provider tree in
         * THIS SAME SESSION with `boot.phase` still 'ready' — nothing
         * re-runs `bootPhaseAfterAuth` until the NEXT cold start, so a
         * freshly-admitted provider could take a paid session having never
         * seen the policy screen, and the server's own POLICY_REQUIRED
         * check (session_cutover.sql) would refuse it with no in-app
         * screen able to resolve that refusal short of a relaunch.
         *
         * `onProviderOnboarded` re-runs the exact same check
         * `bootPhaseAfterAuth` already does on every other post-auth path,
         * the moment identity_state stops being 'none' — at which point
         * `onProviderPath` is true via that signal alone, so profileSetup
         * is (still, correctly) skipped and only policyGate/permissions
         * get the chance to apply.
         */
        onProviderOnboarded={() => {
          void (async () => {
            const profile = await getSignedInProfile().catch(() => null);
            const nextBoot = await bootPhaseAfterAuth(profile).catch(() => null);
            if (nextBoot !== null) {
              setBoot(nextBoot);
            }
          })();
        }}
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

/** A ring the app learned about outside the React tree, before the role is known. */
interface PendingIncoming {
  readonly peerId: string;
  readonly callId: string;
  readonly medium: 'voice' | 'video';
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
  pendingIncoming: PendingIncoming | null;
  onIncomingHandled: () => void;
  /** A tapped message notification's peer id, held until `role` resolves. */
  pendingPeer: string | null;
  onPeerHandled: () => void;
  onSignedOut: () => void;
  /** Re-checks policy/permission gates the moment provider onboarding
   *  completes, closing the gap the provider-intent boot skip leaves open
   *  for the rest of this session. See its call site in Root. */
  onProviderOnboarded: () => void;
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
  pendingIncoming,
  onIncomingHandled,
  pendingPeer,
  onPeerHandled,
  onSignedOut,
  onProviderOnboarded,
}: SignedInProps) {
  const styles = useStyles(makeStyles);
  const setNotice = useStore(s => s.setNotice);

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
  /*
   * Mirrors of the route props, so `onIncoming` can ask "am I on a call
   * already?" without taking the routes as dependencies. A callback that
   * changes identity on every navigation would resubscribe the incoming-call
   * channel each time, and a resubscribe is a window in which a ring is missed.
   */
  const currentRouteRef = useRef(route);
  currentRouteRef.current = route;
  const currentProviderRouteRef = useRef(providerRoute);
  currentProviderRouteRef.current = providerRoute;
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

  /*
   * The one place a ring becomes a route, whichever of the three announcements
   * carried it: the Realtime INSERT, the FCM push, or the notification's Answer
   * intent. One function because the role branch is the thing that drifted —
   * the deep link only ever knew about the member tree.
   *
   * The seen-set is not belt and braces. A call is announced twice by design
   * (Realtime AND a push), and pushing the route for the second announcement
   * remounts CallScreen, whose unmount cleanup ends the call that is already up.
   */
  const routedCallsRef = useRef<Set<string>>(new Set());
  const routeIncomingCall = useCallback(
    (peerId: string, callId: string, medium: 'voice' | 'video') => {
      if (routedCallsRef.current.has(callId)) {
        return;
      }
      routedCallsRef.current.add(callId);
      if (role === 'provider') {
        pushProvider({ name: 'call', peerId, direction: 'in', callId, medium });
      } else {
        pushRoute({ name: 'call', providerId: peerId, direction: 'in', callId, medium });
      }
    },
    [role, pushProvider, pushRoute],
  );

  // A ring, foreground: route the incoming call to the right tree's call screen.
  // Declared before the early return so the hook order is stable.
  const onIncoming = useCallback(
    (incoming: IncomingCall) => {
      /*
       * GLARE: a second ring arriving while a call is already on screen.
       *
       * This used to route unconditionally, and the consequence was worse than
       * a missed ring: pushing a call route replaces the live CallScreen, whose
       * unmount cleanup calls `endCall` on the call in progress. So an incoming
       * ring **dropped the active paid call** and started ringing the new one.
       *
       * Telegram declines the second call outright rather than disturbing the
       * first (MessagesController.java:20468, "Auto-declining call X because
       * there's already active one", sending BUSY). Same behaviour here, via
       * the existing `endCall`: the server derives `declined` for a callee
       * ending a ringing call (migration 011:1163 — it does not trust a
       * client-supplied outcome), so the caller learns immediately instead of
       * ringing out.
       *
       * Read through the refs, not `route`/`providerRoute`, so this callback
       * stays stable across navigations — the same reason `onBack` uses them.
       *
       * The callId comparison is what keeps that from eating the CALL ON SCREEN.
       * This path also receives the ring a push has already routed, and a guard
       * that only asked "is a call open" declined the open one.
       */
      const current =
        role === 'provider' ? currentProviderRouteRef.current : currentRouteRef.current;
      if (current.name === 'call') {
        if (current.callId !== incoming.callId) {
          /*
           * M23 (2026-09-17 audit): the screen already on top may be OUR OWN
           * outgoing attempt to this exact peer, still waiting on `start_call`
           * (callId null — see CallScreen.tsx's outgoing-call effect). That is
           * not a second, unrelated call to decline; it is the other half of
           * a simultaneous-dial race, and `start_call` (migration 120) is
           * about to tell that screen so via ALREADY_RINGING. Declining here
           * would end the peer's call before that dialog ever has a chance to
           * show — this realtime path is typically faster than the RPC
           * round-trip start_call is itself waiting on.
           */
          const currentPeerId =
            role === 'provider'
              ? (current as ProviderRoute & { name: 'call' }).peerId
              : (current as MemberRoute & { name: 'call' }).providerId;
          const isOwnRaceAgainstSamePeer =
            current.direction === 'out' &&
            current.callId === null &&
            currentPeerId === incoming.callerId;
          if (!isOwnRaceAgainstSamePeer) {
            void endCall(incoming.callId);
          }
        }
        return;
      }
      /*
       * The pushed CallStyle notification is cleared as the screen takes the
       * ring over, which is the only path that ever cleared it before. Not while
       * backgrounded: there the notification is the ring, and removing it would
       * leave nothing to answer.
       * https://developer.android.com/develop/ui/views/notifications/call-style
       */
      if (AppState.currentState === 'active') {
        void clearCall(incoming.callId);
      }
      routeIncomingCall(incoming.callerId, incoming.callId, incoming.medium);
    },
    [role, routeIncomingCall],
  );
  useIncomingCalls(selfId, onIncoming);

  /*
   * A ring that arrived before the role did. `useRole` resolves after the deep
   * link is consumed on a cold start, so dispatching early would send a
   * provider's answer into the member tree.
   */
  useEffect(() => {
    if (pendingIncoming === null || isPending) {
      return;
    }
    onIncomingHandled();
    routeIncomingCall(pendingIncoming.peerId, pendingIncoming.callId, pendingIncoming.medium);
  }, [pendingIncoming, isPending, onIncomingHandled, routeIncomingCall]);

  /*
   * A message notification tapped before the role was known (2026-09-17
   * audit) — exact mirror of the `pendingIncoming` effect above, and for the
   * same reason: `companionchat://peer/<id>` does not know which tree it
   * belongs to, only `role` (resolved here, not in the effect that consumed
   * the deep link) does. Routed via each tree's own chat destination shape —
   * `pushProvider({name:'chat', peerId})` is the same call
   * `onOpenConversation` uses from provider home.
   */
  useEffect(() => {
    if (pendingPeer === null || isPending) {
      return;
    }
    onPeerHandled();
    if (role === 'provider') {
      pushProvider({ name: 'chat', peerId: pendingPeer });
    } else {
      pushRoute({ name: 'chat', providerId: pendingPeer, from: 'home' });
    }
  }, [pendingPeer, isPending, onPeerHandled, role, pushProvider, pushRoute]);

  /*
   * Foreground pushes. A call rings through the same entry point as a Realtime
   * ring; a nudge becomes a notice rather than a notification over an app the
   * person is already looking at.
   */
  useEffect(
    () =>
      onForegroundPush({
        onCall: push =>
          routeIncomingCall(
            push.peerId,
            push.callId,
            push.medium === 'video' ? 'video' : 'voice',
          ),
        onEngagement: push => setNotice(push.body || push.title, 'confirm'),
      }),
    [routeIncomingCall, setNotice],
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
              key={providerRoute.callId ?? 'starting'}
              providerId={providerRoute.peerId}
              direction={providerRoute.direction}
              callId={providerRoute.callId}
              medium={providerRoute.medium}
              // Symmetry with the member tree: hanging up returns to that peer's
              // chat, not the provider home (user 2026-08-31).
              onEnd={() => popProvider({ name: 'chat', peerId: providerRoute.peerId })}
              onUpgradeToVideo={newCallId =>
                pushProvider({
                  name: 'call',
                  peerId: providerRoute.peerId,
                  direction: 'out',
                  callId: newCallId,
                  medium: 'video',
                })
              }
            />
          ) : providerRoute.name === 'chat' ? (
            <ChatScreen
              providerId={providerRoute.peerId}
              onBack={() => popProvider({ name: 'home' })}
              onOpenEarnings={() =>
                pushProvider({
                  name: 'usage',
                  from: 'chat',
                  peerId: providerRoute.peerId,
                })
              }
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
          ) : providerRoute.name === 'payout' ? (
            <ProviderBankScreen onBack={() => popProvider({ name: 'home' })} />
          ) : providerRoute.name === 'blocked' ? (
            <BlockedUsersScreen onBack={() => popProvider({ name: 'home' })} />
          ) : providerRoute.name === 'usage' ? (
            <UsageLedgerScreen
              onBack={() => {
                if (
                  providerRoute.from === 'chat' &&
                  providerRoute.peerId !== undefined
                ) {
                  popProvider({ name: 'chat', peerId: providerRoute.peerId });
                  return;
                }
                // The settings list now lives on the You tab (home), not a
                // pushed screen, so usage opened from it returns there.
                popProvider({ name: 'home' });
              }}
            />
          ) : (
            <ProviderHomeScreen
              onOpenConversation={peerId => pushProvider({ name: 'chat', peerId })}
              onOpenPayout={() => pushProvider({ name: 'payout' })}
              onOpenUsage={() => pushProvider({ name: 'usage', from: 'settings' })}
              onOpenBlocked={() => pushProvider({ name: 'blocked' })}
              onSignedOut={onSignedOut}
              onDeleted={onSignedOut}
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
          /*
           * The directory card's CTA rings straight from the list.
           *
           * `medium: 'voice'` and `callId: null` is the same shape the provider
           * detail screen pushes for its Call button — CallScreen owns
           * `start_call` and the ringing, so this is a route change and not a
           * second implementation of placing a call.
           */
          onCallProvider={id =>
            pushRoute({
              name: 'call',
              providerId: id,
              direction: 'out',
              callId: null,
              medium: 'voice',
            })
          }
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
          onInvoices={() => pushRoute({ name: 'invoices' })}
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
        route.name === 'invoices' ||
        route.name === 'usage' ? (
        // Same shape as the chat overlay: content first, then the entrance.
        <AfterPaint>
        <PushedLayer style={styles.overlay}>
          {route.name === 'call' ? (
            <AfterPaint>
              <CallScreen
                key={route.callId ?? 'starting'}
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
                onUpgradeToVideo={newCallId =>
                  setRoute({
                    name: 'call',
                    providerId: route.providerId,
                    direction: 'out',
                    callId: newCallId,
                    medium: 'video',
                  })
                }
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
                // Closes the boot-skip gap for the rest of THIS session —
                // see onProviderOnboarded's own docblock at its call site.
                onProviderOnboarded();
              }}
            />
          ) : route.name === 'applicationStatus' ? (
            <ProviderStatusScreen onBack={backToHome} onEdit={() => pushRoute({ name: 'apply', from: 'applicationStatus' })} />
          ) : route.name === 'blocked' ? (
            <BlockedUsersScreen onBack={backToHome} />
          ) : route.name === 'usage' ? (
            <UsageLedgerScreen onBack={() => popRoute({ name: 'settings' })} />
          ) : route.name === 'invoices' ? (
            // Back to Settings, the door it was opened from — the same pop as
            // its two neighbours, and the parent `memberParent` returns.
            <InvoicesScreen onBack={() => popRoute({ name: 'settings' })} />
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
  useFrameWatch();
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
