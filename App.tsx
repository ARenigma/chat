import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  DeviceEventEmitter,
  Linking,
  NativeModules,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { InitialState, NavigationState } from '@react-navigation/native';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { BLUR_SURFACE_AVAILABLE, BlurRoot } from './src/components/BlurSurface';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from './src/theme/tokens';
import {
  ForceLightTheme,
  ThemeProvider,
  useStyles,
  useThemeMode,
} from './src/theme/ThemeProvider';
import { UpdateBanner } from './src/components/UpdateBanner';
import { NoticeOverlay } from './src/components/NoticeBar';
import { assertEnv } from './src/lib/env';
import { storage } from './src/lib/storage';
import { PROVIDER_INTENT_KEY } from './src/lib/providerIntent';
import {
  onForegroundPush,
  signedInOnDevice,
  startPushWhenConfigured,
  storedAccountId,
} from './src/lib/push';
import { clearCall } from './src/lib/conversations';
import {
  clearIntents,
  enqueueIntent,
  setCallHooks,
  setIntentOwner,
} from './src/lib/intents';
import {
  isAccountLink,
  linkIsForAccount,
  parseCallUrl,
  parseChatV2Url,
  parsePeerUrl,
} from './src/lib/routes/links';
import * as Sentry from '@sentry/react-native';
import { initSentry, logEvent } from './src/lib/sentry';
import { sweepExpiredOutbox } from './src/lib/outboxStore';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import { useFrameWatch, trackQuerySlow } from './src/lib/perfTelemetry';
import { supabase } from './src/lib/supabase';
import { applyDemoCapturePolicy } from './src/lib/demoCapture';
import {
  beginSignOut,
  currentSession,
  finishPendingSignOuts,
  forgetDeadSession,
  handleAuthDeepLink,
  resumePendingSignOuts,
} from './src/api/auth';
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
import { useIncomingCalls, type IncomingCall, endCall } from './src/api/calls';
import {
  parseVideoResolution,
  setVideoResolution,
} from './src/api/callMedia/profile';
import { keys, useConversations, useGlobalOutboxDrain, useSelfId } from './src/api/chat';
import { useProviderPresenceStream } from './src/api/presenceStream';
import { useRole } from './src/api/provider';
import { resetStore, useStore } from './src/store/useStore';
import { PolicyGateScreen } from './src/screens/PolicyGateScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { checkGate, gateSatisfied } from './src/lib/permissionsGate';
import { ProfileSetupScreen } from './src/screens/ProfileSetupScreen';
import { WelcomePappalScreen } from './src/screens/WelcomePappalScreen';
import { ConfirmDialog } from './src/components/ConfirmDialog';
import { HomeTour } from './src/components/HomeTour';
import { useHomeTour } from './src/store/useHomeTour';
import { Button } from './src/components/Button';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { SplashScreen } from './src/screens/SplashScreen';
import { CHAT_RING_SECONDS } from './src/components/ChatRequestScreen';
import { chatRingDeadline } from './src/lib/chatRing';
import { setLightNavigationBars } from './src/lib/windowChrome';
import { refetchAfterDecline, useIncomingChatRequests } from './src/api/sessions';
import { usePresenceHeartbeat } from './src/hooks/usePresenceHeartbeat';
import { APPLY_INITIAL_STATE, RoutesContainer, stripForRestore } from './src/Navigation';
import { ShellStateProvider } from './src/shell/ShellStateProvider';
import type { SignedInActions } from './src/screens/routes/signedIn';

initSentry();
// Wire live call API into the intent queue. Called once at module init so
// intents.ts can busy-decline and clear notifications without importing the
// native modules directly (which break Jest). nav-migration §3.
setCallHooks({ endCall, clearCall });

const { StartupTiming } = NativeModules as {
  StartupTiming?: { reportFullyDrawn(): void };
};
const windowChrome = (
  NativeModules as {
    WindowChrome?: {
      allowBenchmarkRoutes?: boolean;
      benchmarkReadOnly?: boolean;
    };
  }
).WindowChrome;
const allowBenchmarkRoutes = windowChrome?.allowBenchmarkRoutes === true;
const benchmarkReadOnlyLaunch = windowChrome?.benchmarkReadOnly === true;

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
 * The boot machine. Everything before `ready` is a phase here, outside the
 * navigator (ADR-0016, ADR-0026: no route can reach Home around a gate); from
 * `ready` on, SignedIn mounts the react-navigation container
 * (src/Navigation.tsx, ADR-0032). The member and provider trees are two
 * navigators selected by the server-supplied role, which is the whole of
 * ADR-0002's safety argument: no member route can reach a provider screen,
 * because they are different trees rather than different branches.
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
  /*
   * The last navigator state, for the foreground permission re-gate only
   * (nav-migration §3): that gate unmounts SignedIn, and coming back through
   * it restores the stacks the member was on instead of dropping them at
   * Home. Kept with the role it belongs to. A fresh boot clears it (below),
   * which keeps "always Home after restart".
   */
  const lastNavState = useRef<{ role: 'member' | 'provider'; state: NavigationState } | null>(null);
  const regateRestore = useRef(false);
  const takeRestoreState = useCallback((): { role: 'member' | 'provider'; state: InitialState } | null => {
    if (!regateRestore.current) {
      return null;
    }
    regateRestore.current = false;
    const saved = lastNavState.current;
    if (saved === null) {
      return null;
    }
    const { state, strippedRequests } = stripForRestore(saved.state);
    // A ring that is not restored is not ringing: its claim on the store goes.
    for (const requestId of strippedRequests) {
      useStore.getState().clearIncomingRequest(requestId);
    }
    return { role: saved.role, state };
  }, []);
  const onNavState = useCallback((role: 'member' | 'provider', state: NavigationState | undefined) => {
    lastNavState.current = state === undefined ? null : { role, state };
  }, []);
  /*
   * The signed-out screen. clearIntents() drops any held deep links or rings
   * that belong to the leaving account; setIntentOwner(null) ensures any intent
   * that arrives before the next sign-in is tagged null and dropped at flush.
   * nav-migration §3.
   */
  const toSignedOut = useCallback(() => {
    clearIntents();
    setIntentOwner(null);
    setBoot({ phase: 'signedOut' });
    // Clear the Sentry user context so no further events carry the previous
    // account's id after sign-out.
    Sentry.setUser(null);
  }, []);
  /*
   * Closes a gap in the provider-intent boot skip (2026-09-17 audit).
   * While `PROVIDER_INTENT_KEY` is set, the boot effect below skips
   * `bootPhaseAfterAuth` entirely — profileSetup, policyGate AND permissions —
   * which is the documented, deliberate shape of "Become a partner" (Amit,
   * 2026-09-03: "SKIPS the member first-run ... entirely"). That is correct
   * for the DURATION of the apply flow: `bootPhaseAfterAuth`'s own
   * `onProviderPath` check only skips profileSetup, so a member policy modal
   * opening over provider onboarding was the exact bug it exists to prevent.
   *
   * But the skip does not end when onboarding does. The flag clears on
   * submission and the app flips straight to the provider tree in THIS SAME
   * SESSION with `boot.phase` still 'ready' — nothing re-runs
   * `bootPhaseAfterAuth` until the NEXT cold start, so a freshly-admitted
   * provider could take a paid session having never seen the policy screen,
   * and the server's own POLICY_REQUIRED check (session_cutover.sql) would
   * refuse it with no in-app screen able to resolve that refusal short of a
   * relaunch.
   *
   * `onProviderOnboarded` re-runs the exact same check `bootPhaseAfterAuth`
   * already does on every other post-auth path, the moment identity_state
   * stops being 'none' — at which point `onProviderPath` is true via that
   * signal alone, so profileSetup is (still, correctly) skipped and only
   * policyGate/permissions get the chance to apply. Called by the Apply route.
   */
  const onProviderOnboarded = useCallback(() => {
    void (async () => {
      const profile = await getSignedInProfile().catch(() => null);
      const nextBoot = await bootPhaseAfterAuth(profile).catch(() => null);
      if (nextBoot !== null) {
        setBoot(nextBoot);
      }
    })();
  }, []);
  const [exitDialogVisible, setExitDialogVisible] = useState(false);
  useReportFullyDrawn(boot.phase !== 'loading' && boot.phase !== 'ready');
  const setNotice = useStore(s => s.setNotice);
  /*
   * No route-enforcing effect for the provider signup any more (nav-migration
   * §3, A16/B12): SignedIn mounts the container straight into Apply from
   * `pendingProviderApply` (`initialState`), and every boot re-run that
   * remounts it re-derives the same first frame from the same flag.
   */

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

  // A fresh boot (every `attempt`) lands on Home: the saved stacks are for a
  // permission re-gate only, which does not bump `attempt`.
  useEffect(() => {
    if (!regateRestore.current) {
      lastNavState.current = null;
    }
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        assertEnv();
        // A sign-out whose server half a dead process never finished: its
        // session is already off the device, so this runs behind the boot.
        void resumePendingSignOuts();
        // Read before the session is: a refresh the server refuses makes
        // auth-js remove the stored session inside `currentSession`.
        const hadStoredSession = signedInOnDevice();
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
          /*
           * Signed out the way every other path is (`toSignedOut`), not with
           * a bare phase change. A session that was stored and has now died
           * (revoked on the server) left a notification tap or ring already
           * held for it: `consume` read MMKV at arrival, before the refresh
           * failed, and held a link `SignedIn` then opened inside whichever
           * account signed in next. And it never reached `beginSignOut`, so
           * its device half runs here: its queued sends would otherwise be
           * replayed as the next account (`forgetDeadSession`).
           */
          if (hadStoredSession) {
            void forgetDeadSession();
          }
          toSignedOut();
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
         * raced the deep-link effect below for every REAL notification tap).
         * Deep-link intents are now enqueued and held until SignedIn registers
         * an applier once the role resolves. nav-migration §3.
         */
        // Adopt any BOOT-tagged intents (cold-start taps) for this account
        // and allow the queue to flush once the navigator applier is set.
        setIntentOwner(session.user.id);
        // Attach opaque user id to all subsequent Sentry events. Only the id
        // is sent — sendDefaultPii is false and the scrubber enforces it.
        // https://docs.sentry.io/platforms/react-native/enriching-events/identify-user/
        Sentry.setUser({ id: session.user.id });
        // "Become a partner" before auth → provider onboarding, and it SKIPS the
        // member first-run (username/age/policy) entirely. Member and provider are
        // separate worlds (Amit, 2026-09-03): a provider sets up their OWN profile
        // in the provider onboarding, so a provider signup must never be routed
        // through the member first-run gates. The flag is read fresh (set in
        // OnboardingScreen) and NOT cleared here — the boot effect can run more
        // than once, and clearing on the first run let a later run fall through to
        // the member path and Home. It is cleared when the onboarding is left or
        // completed (the Apply route, src/screens/routes/MemberRoutes.tsx).
        if (storage.get(PROVIDER_INTENT_KEY) === '1') {
          // Restore the reactive flag from the persisted intent (the in-memory one
          // can be reset in the auth → boot transition) so the tour gate and the
          // route-enforcing effect below see it too.
          useStore.getState().setPendingProviderApply(true);
          if (useHomeTour.getState().active) {
            useHomeTour.getState().skip();
          }
          setBoot({ phase: 'ready' });
          track('app_open');
          return;
        }
        // ADR-0020 / 040: profile setup (+ age, 043), then policy gate, then app.
        const profile = await getSignedInProfile();
        const nextBoot = await bootPhaseAfterAuth(profile);
        setBoot(nextBoot);
        if (nextBoot.phase === 'ready') {
          track('app_open');
          logEvent('cold_start_complete', { status: 'ready' });
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
  }, [attempt, toSignedOut]);

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
  useGlobalOutboxDrain(boot.phase === 'ready' && !benchmarkReadOnlyLaunch);


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
       * A chat, call or V2 link that arrives with nobody signed in on the
       * device belongs to an account that is not here, and is dropped rather
       * than held. Held, it waited in Root's state (which survives signedOut
       * to ready) and `SignedIn` applied it inside whichever account signed in
       * next: a leftover pinned shortcut (Conversations.clearAll leaves those
       * by design) or a notification posted after the sign-out opened the
       * previous account's peer in the new one. Read at arrival, from MMKV,
       * so a cold-start tap by a signed-in person still finds the session.
       * A call link's notification is still taken down.
       */
      if (!signedInOnDevice() && isAccountLink(url)) {
        const leftoverCall = url.match(/^companionchat:\/\/call\/[^?]+\?.*callId=([^&]+)/)?.[1];
        if (leftoverCall !== undefined && isUuid(leftoverCall)) {
          void clearCall(leftoverCall);
        }
        return;
      }
      /*
       * And one for a DIFFERENT account than the one signed in (`for=`, the
       * account the push was for, migration 143). The gate above only asks
       * whether anybody is signed in; a notification posted for the previous
       * account before its sign-out finished, or its long-lived shortcut,
       * opened that account's peer here. Dropped the same way, a leftover
       * call's notification taken down with it.
       */
      if (isAccountLink(url) && !linkIsForAccount(url, storedAccountId())) {
        const otherCall = url.match(/^companionchat:\/\/call\/[^?]+\?.*callId=([^&]+)/)?.[1];
        if (otherCall !== undefined && isUuid(otherCall)) {
          void clearCall(otherCall);
        }
        return;
      }
      /*
       * Development/internal-only V2 chat seam. The parser validates the
       * complete URL and UUID as untrusted input. `allowBenchmarkRoutes` is a
       * compile-time Android build capability that is true only in `internal`;
       * release defines it false, so an explicit activity intent is rejected.
       * https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks
       */
      if (url.startsWith('companionchat://chat-v2/')) {
        const v2Peer = parseChatV2Url(
          url,
          __DEV__ || allowBenchmarkRoutes,
        );
        if (v2Peer !== null) {
          enqueueIntent({
            type: 'openChatV2',
            peerId: v2Peer,
            benchmarkReadOnly: benchmarkReadOnlyLaunch,
          });
        }
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
       * Enqueued rather than routed directly: `role` is not known at this
       * point, and `SignedIn` registers the intent applier once `useRole`
       * resolves, at which point the queue flushes to the correct tree.
       * A peer link that arrives with no stored session never gets here:
       * the gate at the top of `consume` drops it, because the id belongs to
       * an account that is not the current one. nav-migration §3.
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
       * put a connected call behind a UI that does not exist yet. It is enqueued
       * into the intent queue, which routes it once the role is known.
       *
       * Parsed with regex, not URLSearchParams, which Hermes does not ship.
       */
      const parsedCall = parseCallUrl(url);
      if (parsedCall !== null) {
        const { peerId: callPeer, callId, action, medium } = parsedCall;
        void clearCall(callId);
        if (action === 'decline') {
          void endCall(callId);
          return;
        }
        enqueueIntent({ type: 'incomingCall', peerId: callPeer, callId, medium });
        return;
      }
      if (url.startsWith('companionchat://call/')) {
        // URL matched the scheme but failed UUID validation in parseCallUrl.
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

      /*
       * HELD, not routed (2026-09-17 audit) — `role` is not known here and a
       * bare `setRoute` always writes the MEMBER tree. A provider's own tap on
       * a message notification set a route their tree never draws. Enqueued
       * so the intent queue applies it once `role` resolves. nav-migration §3.
       * parsePeerUrl strips query strings so a harness-augmented URI routes.
       */
      const parsedPeer = parsePeerUrl(url);
      if (parsedPeer !== null) {
        enqueueIntent({ type: 'openChat', peerId: parsedPeer });
        return;
      }
      if (url.startsWith('companionchat://peer/')) {
        // URL matched the scheme but failed UUID validation in parsePeerUrl.
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

  /*
   * A signed-out device that comes back online finishes any sign-out whose
   * server half failed on the network, instead of waiting for the next launch
   * or the next push. Only while nobody is signed in: a pending entry's push
   * teardown revokes this device's FCM token, which a signed-in account's
   * `startPush` waits out only at its own start.
   */
  useEffect(
    () =>
      onlineManager.subscribe(online => {
        if (online && !signedInOnDevice()) {
          void finishPendingSignOuts();
        }
      }),
    [],
  );

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
    // Push registration is best-effort. Notification permission is an opt-in:
    // denial leaves Home and chat fully usable, and startPush returns a no-op
    // unsubscribe without uploading an unusable token. The policy is read
    // first so ensurePermission() in push.ts knows whether to show the
    // blocked-settings alert on Android 13+. `startPushWhenConfigured` owns
    // the ordering against this cleanup: a sign-out while the config RPC is
    // still pending used to be followed by a start for the ended session.
    //
    // A backgrounded tap on a message notification used to be picked up here
    // via `onNotificationOpen` (RNFirebase's `onNotificationOpenedApp`).
    // Removed (2026-09-17 audit): that API tracks a tap on a notification FCM
    // itself rendered, and this app's messages are always data-only and
    // self-built — see push.ts. The real path is the SAME
    // `Linking.addEventListener('url', ...)` the deep-link effect above
    // already runs, since `companionchat://peer/<id>` is a normal `Linking`
    // URL event whether the app was backgrounded or cold.
    return startPushWhenConfigured(async () =>
      effectivePermissionLevel(await fetchPermissionsConfig(), 'notification'),
    );
  }, [boot.phase]);

  /*
   * FOREGROUND-RETURN PERMISSION GUARD.
   *
   * Android's permission model allows the user to revoke a permission at any
   * time via Settings while the app is backgrounded. When they return, the app
   * would be running in a state where it believes required permissions are
   * granted but they are not. Notification access is optional and never routes
   * the user back to this gate.
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
         * The gate checks required permissions (permissionsGate.ts):
         * RECORD_AUDIO and CAMERA cannot plausibly lapse mid-call — the foreground service
         * CallScreen already starts keeps that access alive by design
         * (developer.android.com/training/permissions/requesting: "If you
         * launch a foreground service while the activity is visible... your
         * app can continue to access the data until the foreground service
         * stops"). POST_NOTIFICATIONS is optional and therefore cannot trip
         * this path.
         *
         * Deferred, not skipped: `gateSatisfied` still runs, and if it
         * fails while a call IS on screen this simply waits for the next
         * foreground return (or the call ending) rather than re-checking
         * right now.
         */
        if (useStore.getState().activeCall !== null) {
          return;
        }
        const statuses = await checkGate();
        if (!gateSatisfied(statuses)) {
          // Coming back through the gate restores the stacks (nav §3).
          regateRestore.current = true;
          setBoot({ phase: 'permissions' });
        }
      }
    });

    return () => sub.remove();
   
  }, []);

  /**
   * The hardware and gesture back button, last in line (nav-migration §4).
   *
   * Registered once, at Root's mount, so it is consulted LAST: RN runs back
   * listeners last-registered-first, and everything that navigates is
   * registered after it. A visible RN Modal takes back before any listener
   * (`onRequestClose`); a focused tab root that is searching closes its
   * search (`useSearchBack`); the NavigationContainer pops a stack or returns
   * to the first tab (`backBehavior="initialRoute"`), and a route that must
   * not simply leave (a paid chat, a call, Apply) stops that pop with
   * `usePreventRemove`. Only what none of them wanted reaches this handler,
   * which is the root of the first tab.
   *
   * NOT READY YET: hand back to Android (2026-09-17 audit). Before `ready`
   * there is no navigator and no exit dialog on screen, and a dialog raised
   * then appeared unprompted the moment `ready` was reached.
   *
   * At the root it does NOT silently close. A lonely person about to leave is
   * exactly the moment to say "someone's still here", so back at Home asks
   * first ("Leave Pappal?"), and returning `true` keeps Android from closing
   * underneath it.
   *
   * STATED DEVIATION, predictive back. Intercepting back at the root is what
   * suppresses the system's back-to-home preview
   * (https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture,
   * https://developer.android.com/about/versions/16/behavior-changes-16); the
   * exit confirm is the owner's, so the preview is given up for it. The
   * in-app half is a separate gap: react-native-screens 4.28 animates with
   * View tweens, which predictive back does not drive
   * (https://developer.android.com/guide/fragments/animate). See MainActivity.kt.
   */
  useEffect(() => {
    const onBack = () => {
      if (bootPhaseRef.current !== 'ready') {
        return false;
      }
      setExitDialogVisible(true);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
    // Empty deps: registered ONCE for Root's lifetime, so its place in the
    // order (last consulted) never moves.
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
          /*
           * The same teardown as Settings' Sign out, not a bare `signOut()`,
           * which revoked no push registration (the push effect only runs in
           * the ready phase, so a row from an earlier session kept ringing
           * this phone) and never left this gate. Device first, and the
           * server half behind it (`beginSignOut`).
           */
          queryClient.clear();
          resetStore();
          toSignedOut();
          beginSignOut().catch(() => {
            // Best-effort, as in Settings: nothing is left on screen to tell.
          });
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
        onSignedOut={toSignedOut}
        onProviderOnboarded={onProviderOnboarded}
        takeRestoreState={takeRestoreState}
        onNavState={onNavState}
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
  onSignedOut: () => void;
  /** Re-checks policy/permission gates the moment provider onboarding
   *  completes, closing the gap the provider-intent boot skip leaves open
   *  for the rest of this session. See its definition in Root. */
  onProviderOnboarded: () => void;
  /** The stacks to restore after the permission re-gate, once, or null. */
  takeRestoreState: () => { role: 'member' | 'provider'; state: InitialState } | null;
  /** Every navigator state, for that restore. */
  onNavState: (role: 'member' | 'provider', state: NavigationState | undefined) => void;
}

/**
 * Split out because the role query needs a session, and hooks cannot be called
 * conditionally, putting `useRole` in `Root` would run it before sign-in.
 *
 * Every hook here stays ABOVE `if (isPending)` and outside the navigator, with
 * the lifetime it had before navigation step 7 (nav-migration §1, B6): the
 * incoming-call and chat-request channels, the foreground push handler, the
 * decline listener and the presence heartbeat live as long as the session,
 * not as long as any screen. The navigator itself is `RoutesContainer`, keyed
 * by role, so a role flip remounts it onto the other tree.
 */
function SignedIn({ onSignedOut, onProviderOnboarded, takeRestoreState, onNavState }: SignedInProps) {
  const setNotice = useStore(s => s.setNotice);
  const { role, isPending } = useRole();
  const { data: selfId } = useSelfId();
  const { data: conversations } = useConversations();
  useReportFullyDrawn(!isPending);

  // Read once, at mount: a re-gate's saved stacks, for the role they were saved on.
  const [restore] = useState(takeRestoreState);
  const pendingProviderApply = useStore(s => s.pendingProviderApply);
  const signedInRole: 'member' | 'provider' = role === 'provider' ? 'provider' : 'member';

  // Realtime ring: enqueue and let the intent queue apply glare + dedup.
  const onIncoming = useCallback(
    (incoming: IncomingCall) => {
      enqueueIntent({
        type: 'incomingCall',
        peerId: incoming.callerId,
        callId: incoming.callId,
        medium: incoming.medium,
      });
    },
    [],
  );
  useIncomingCalls(selfId, onIncoming);

  /*
   * In-app chat-request ring for the provider (goal item 13).
   *
   * `useIncomingChatRequests` fires when a session_request INSERT lands on the
   * Realtime channel while the provider is live. The store's first-writer-wins
   * guard prevents two overlapping rings and queues the second to ring next;
   * the provider shell turns whichever request rings into a `ChatRequest`
   * route through the intent queue (src/shell/index.tsx).
   *
   * Peer name: looked up from the already-fetched conversations list. If the
   * conversation exists the provider knows who this is; otherwise a short
   * handle derived from the initiator id is used — the same fallback
   * `member_handle()` produces server-side.
   * https://developer.android.com/develop/ui/views/notifications/conversations
   */
  const setIncomingRequest = useStore(s => s.setIncomingRequest);
  const onIncomingChatRequest = useCallback(
    (request: { requestId: string; conversationId: string; initiatorId: string; expiresAt: string; createdAt?: string }) => {
      if (role !== 'provider') return;
      const conv = (conversations ?? []).find(c => c.conversation_id === request.conversationId);
      const peerName =
        conv?.peer_display_name ??
        `Member ${request.initiatorId.replace(/-/g, '').slice(0, 4)}`;
      setIncomingRequest({
        requestId: request.requestId,
        conversationId: request.conversationId,
        peerId: request.initiatorId,
        peerName,
        // An ABSOLUTE deadline, on purpose, even for a request that queues
        // behind another ring: a queued one is promoted with only the seconds
        // it really has left, and one that ran out while waiting is skipped
        // (store.test "skips a queued request that expired while it waited").
        expiresAt: chatRingDeadline(request.expiresAt, request.createdAt, CHAT_RING_SECONDS),
        createdAt: request.createdAt,
      });
    },
    [role, conversations, setIncomingRequest],
  );
  useIncomingChatRequests(role === 'provider' ? selfId : undefined, onIncomingChatRequest);
  /*
   * The provider's presence heartbeat (migration 155): foreground, every 30 s
   * while active, offline on background. Here, above the role split, because a
   * hook cannot sit inside the role branch below. A member passes false and
   * never beats, and so does a role still loading (`undefined`), so a
   * provider starts a moment late rather than anyone else ever starting at
   * all. Sign-out does not wait for this tree to unmount: it halts the
   * heartbeat and sends the offline itself, before the session is cleared
   * (`leaveDevice` in src/api/auth.ts).
   */
  usePresenceHeartbeat(role === 'provider');
  /*
   * Members receive pushed provider-presence events via postgres_changes on
   * `provider_presence` (migration 182). The hook patches the three caches
   * that carry online/last_seen_at so the UI updates sub-second. Polls on
   * those caches are relaxed to 60 s and kept as a safety net (push-primary,
   * poll-fallback). Providers do not receive their own presence here.
   */
  useProviderPresenceStream(role === 'member');

  /*
   * A Decline pressed on a chat-request notification has landed.
   *
   * The Decline itself is not run here any more. It was: ChatRequestReceiver
   * emitted "chatRequestDecline" to this listener, which exists only while
   * this tree is mounted, and the person who gets those buttons is a member
   * whose app is usually swiped away, so the RPC never ran while the
   * notification had already been cancelled. It now runs as a headless task
   * with or without this tree (`declineFromNotification`, index.js), and this
   * only refetches what it changed when the tree happens to be up, exactly as
   * the in-app Decline does (`refetchAfterDecline`).
   */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('chatRequestDeclined', (conversationId: string) => {
      refetchAfterDecline(queryClient, conversationId);
    });
    return () => sub.remove();
  }, []);

  /*
   * Foreground pushes. A call enqueues through the intent queue (glare +
   * dedup handled there); a nudge becomes a notice over an app the person is
   * already looking at.
   */
  useEffect(
    () =>
      onForegroundPush({
        onCall: push =>
          enqueueIntent({
            type: 'incomingCall',
            peerId: push.peerId,
            callId: push.callId,
            medium: push.medium === 'video' ? 'video' : 'voice',
          }),
        onEngagement: push => setNotice(push.body || push.title, 'confirm'),
      }),
    [setNotice],
  );

  const actions = React.useMemo<SignedInActions>(
    () => ({ role: signedInRole, onSignedOut, onProviderOnboarded }),
    [signedInRole, onSignedOut, onProviderOnboarded],
  );
  const onStateChange = useCallback(
    (state: NavigationState | undefined) => onNavState(signedInRole, state),
    [onNavState, signedInRole],
  );

  // No retry handler here on purpose: the profile query owns its own retries, and
  // a button that re-runs a query React Query is already retrying would only
  // look like it did something.
  if (isPending) {
    return <SplashScreen />;
  }

  /*
   * The first frame (nav-migration §3). A re-gate restores the stacks it saved
   * for this same role. Otherwise a member mid provider-signup boots straight
   * into Apply over Home, with no push and no Home frame first (the HomeTour
   * is skipped by the boot effect). Otherwise the navigator's own initial
   * routes: Home, or Chats for a provider.
   */
  const initialState =
    restore !== null && restore.role === signedInRole
      ? restore.state
      : signedInRole === 'member' && pendingProviderApply
        ? APPLY_INITIAL_STATE
        : undefined;

  return (
    <RoutesContainer
      key={signedInRole}
      role={signedInRole}
      actions={actions}
      initialState={initialState}
      onStateChange={onStateChange}
    />
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
  // The status bar's icons follow `barStyle` below; the navigation bar's need
  // their own call, or Light shows pale icons on white (B6, 2026-09-29).
  useEffect(() => {
    setLightNavigationBars(!isDark);
  }, [isDark]);
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
      <NoticeOverlay />
    </>
  );
}

// Sentry.wrap adds touch-event breadcrumbs and finalises the TTFD epoch
// started by reactNavigationIntegration. Wrapping is safe here because
// initSentry() runs before this component mounts.
// https://docs.sentry.io/platforms/react-native/tracing/instrumentation/automatic-instrumentation/#wrap
function App() {
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
      {/*
       * The keyboard's UI-thread tracking lives here. Every screen that reads
       * the IME position (the chat dock's `KeyboardStickyView`, the forms'
       * `useImeSpace`) requires this ancestor; it sits inside the gesture root
       * so pan gestures
       * and keyboard tracking share one root. Both bars are translucent because
       * the app is edge-to-edge and applies insets itself — the provider must
       * agree or its heights disagree with what the window actually shows.
       */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      <BlurRootOrView style={fill.root}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              {/* The shell's state (minimal mode, the bar's height) sits above
                  Root, so the UpdateBanner, outside every route, rides above
                  the bottom bar (nav-migration §1). */}
              <ShellStateProvider>
                <Shell />
              </ShellStateProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </BlurRootOrView>
      </KeyboardProvider>
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

export default Sentry.wrap(App);
