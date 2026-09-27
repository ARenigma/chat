/**
 * The signed-in navigator: a bottom-tab navigator at the root, one native
 * stack per tab, and every pushed screen registered in every tab stack of its
 * role (Bluesky `commonScreens`). Boot phases stay outside it, in App.tsx's
 * Root (ADR-0016, ADR-0026). ADR-0032 records the decision and the
 * deviations; nav-migration §1 is the tree.
 *
 * Structure, not a menu: the role is chosen by the server (ADR-0002), and the
 * two trees are two navigators, so no member route can reach a provider
 * screen by construction. The container is keyed by role in App.tsx, so a role
 * flip (provider onboarding submitted) remounts it onto the other tree.
 *
 * STATED DEVIATIONS (ADR-0032), each deliberate:
 * - No NativeTabs: Bluesky's structure with its custom bar (owner decision).
 * - Tab switches do not animate (bottom-tabs' default `animation: 'none'`):
 *   tabs are peers, and a 100+/day action gets no motion (animate-expo step 1).
 * - Stack push/pop is the platform default; under reduced motion it is a fade
 *   (animate-expo step 9), where Bluesky keeps the slide.
 * - REVERSAL of the plan's ruling 14 (owner, 2026-09-26): ProviderDetail (the
 *   provider profile) and Wallet are native form sheets, `presentation:
 *   'formSheet'`, tall, swipe down to dismiss, with the sheet radius. Apply
 *   and ChatRequest stay pushed. On Android the form sheet is Material
 *   BottomSheetBehavior inside the stack (react-native-screens
 *   ScreenStackFragment), and three of its documented Android limits shape
 *   the code (https://reactnavigation.org/docs/native-stack-navigator#presentation):
 *     * `sheetGrabberVisible` is iOS-only, so the body draws the M3 handle
 *       itself (`Layout.Screen sheet`);
 *     * a ScrollView in the sheet needs `nestedScrollEnabled` so the sheet
 *       can tell a scroll from a drag down (both screens' `sheet` prop);
 *     * nested stacks and native headers are not supported inside a sheet:
 *       neither sheet has either.
 *   Chat and Call opened from the profile sheet REPLACE it rather than push
 *   over it (`fromSheet` in actions.ts): a card pushed over an Android form
 *   sheet detaches the sheet, and the pop re-attaches it through its enter
 *   animator, so the sheet would slide up again behind the chat's pop.
 * - The bottom bar's press is 0.90 over 100ms (owner), past animate-expo's 3%
 *   ceiling; its hide/show spring is ~120ms, under Bluesky's ~240ms.
 * - Predictive back is a documented gap (MainActivity.kt, the Root back
 *   listener in App.tsx): screens 4.28 animates with View tweens, and the
 *   exit confirm at the root intercepts back by the owner's choice.
 *
 * NOT set, and why: `freezeOnBlur`/`enableFreeze` (ruling 7, covered screens
 * gate their own work), `gestureEnabled`/`fullScreenGestureEnabled` (Android
 * no-ops), `statusBar*`/`navigationBar*` (App.tsx's StatusBar is the only
 * owner), `orientation` (no portrait lock), `getId` (screens #4382; one chat
 * per peer is `resolveOpenChat`'s job), `linking` (Root's Linking effect is
 * the only consumer of links, ruling 4).
 *
 * adapted from bluesky-social/social-app src/Navigation.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  CommonActions,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  useIsFocused,
  type InitialState,
  type NavigationState,
  type Theme as NavTheme,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useReducedMotion } from 'react-native-reanimated';

import { CALLS_TAB_ENABLED } from './config';
import { setIntentApplier, type NavIntent } from './lib/intents';
import { trackScreenOpened } from './lib/perfTelemetry';
import {
  chatTabOf,
  currentRoot,
  focusedStackKey,
  focusedTab,
  openChat,
  presentCall,
} from './lib/routes/actions';
import { getCurrentRoute } from './lib/routes/helpers';
import { navigationRef } from './lib/routes/navigationRef';
import { LEGACY_KIND } from './lib/routes/screenNames';
import { TabFocusedContext } from './lib/routes/tabFocus';
import type {
  MemberScreenParams,
  MemberTabParams,
  ProviderScreenParams,
  ProviderTabParams,
} from './lib/routes/types';
import { CALL_BASE } from './screens/CallScreen';
import { CallRoute } from './screens/routes/CallRoute';
import { ChatRoute } from './screens/routes/ChatRoute';
import {
  ApplicationStatusRoute,
  ApplyRoute,
  BlockedRoute,
  CallsRoute,
  ChatsListRoute,
  FavouritesRoute,
  HomeRoute,
  HomeSuggestionRoute,
  InvoicesRoute,
  ProviderDetailRoute,
  ProviderProfileRoute,
  TransactionsRoute,
  UsageRoute,
  WalletRoute,
  YouRoute,
} from './screens/routes/MemberRoutes';
import {
  ChatRequestRoute,
  ChatsRoute,
  EditProfileRoute,
  PayoutRoute,
  ProviderPhotosRoute,
  ProviderYouRoute,
  SavedRoute,
} from './screens/routes/ProviderRoutes';
import { SignedInActionsContext, type SignedInActions } from './screens/routes/signedIn';
import { StoryCreateRoute, StoryViewerRoute } from './screens/routes/StoryRoutes';
import { STORY_BASE } from './screens/StoryViewerScreen';
import { BottomBar, MEMBER_TABS, PROVIDER_TABS } from './shell/bottom-bar/BottomBar';
import { MemberShell, ProviderShell } from './shell';
import { useStore } from './store/useStore';
import { useTheme, useThemeMode } from './theme/ThemeProvider';
import { TOKENS } from './theme/tokens';

type MemberStackParams = MemberScreenParams & {
  Home: undefined;
  Favourites: undefined;
  Calls: undefined;
  You: undefined;
};
type ProviderStackParams = ProviderScreenParams & {
  Chats: undefined;
  Saved: undefined;
  You: undefined;
};

const MemberTab = createBottomTabNavigator<MemberTabParams>();
const ProviderTab = createBottomTabNavigator<ProviderTabParams>();
const HomeStack = createNativeStackNavigator<MemberStackParams>();
const FavouritesStack = createNativeStackNavigator<MemberStackParams>();
const CallsStack = createNativeStackNavigator<MemberStackParams>();
const YouStack = createNativeStackNavigator<MemberStackParams>();
const ChatsStack = createNativeStackNavigator<ProviderStackParams>();
const SavedStack = createNativeStackNavigator<ProviderStackParams>();
const ProviderYouStack = createNativeStackNavigator<ProviderStackParams>();

/**
 * How tall the two native sheets stand: 92% of the stack below the status
 * bar (`sheetShouldOverflowTopInset` false), one detent, so a drag down
 * dismisses rather than resting at a second height. A fraction of the stack
 * and not `fitToContents`, because both bodies scroll and fill with `flex: 1`,
 * which `fitToContents` cannot measure (the sheet does not display at all).
 */
const SHEET_DETENT = 0.92;

/** Every stack's screen options (nav-migration §1). */
function stackOptions(background: string, reduced: boolean): NativeStackNavigationOptions {
  return {
    headerShown: false,
    contentStyle: { backgroundColor: background },
    // The platform push/pop; a fade under the OS reduced-motion setting
    // (animate-expo step 9). The only deviation from Bluesky's stack options.
    animation: reduced ? 'fade' : 'default',
  };
}

/** The Call surface is dark in both themes: its push never flashes the theme background. */
const CALL_OPTIONS: NativeStackNavigationOptions = { contentStyle: { backgroundColor: CALL_BASE } };

/**
 * The story viewer: a full-screen push on black, faded in both motion modes.
 * A fade, not the platform slide: stories open from a face in a rail, and a
 * sideways slide would say "a page to the right" where the viewer is a layer
 * over this one (spatial consistency, animate-expo step 2). A fade is also
 * already what reduced motion asks for, so one option serves both.
 */
const STORY_VIEWER_OPTIONS: NativeStackNavigationOptions = {
  animation: 'fade',
  contentStyle: { backgroundColor: STORY_BASE },
};

/** The two tall native sheets (owner 2026-09-26; see the header's REVERSAL). */
function sheetOptions(background: string): NativeStackNavigationOptions {
  return {
    presentation: 'formSheet',
    sheetAllowedDetents: [SHEET_DETENT],
    sheetCornerRadius: TOKENS.radius.sheet,
    // iOS only; on Android `Layout.Screen sheet` draws the handle.
    sheetGrabberVisible: true,
    contentStyle: { backgroundColor: background },
  };
}

/**
 * The member screens every member tab stack registers (Bluesky
 * `commonScreens`), so a push stays in the tab it was made from.
 */
function memberScreens(Stack: typeof HomeStack, background: string) {
  const sheet = sheetOptions(background);
  return (
    <>
      <Stack.Screen name="ChatsList" getComponent={() => ChatsListRoute} />
      <Stack.Screen name="ProviderDetail" getComponent={() => ProviderDetailRoute} options={sheet} />
      {/* The same profile as a full-page push, opened from inside a chat. */}
      <Stack.Screen name="ProviderProfile" getComponent={() => ProviderProfileRoute} />
      <Stack.Screen name="Chat" getComponent={() => ChatRoute} />
      <Stack.Screen name="ChatV2" getComponent={() => ChatRoute} />
      <Stack.Screen name="Call" getComponent={() => CallRoute} options={CALL_OPTIONS} />
      <Stack.Screen name="Wallet" getComponent={() => WalletRoute} options={sheet} />
      <Stack.Screen name="Apply" getComponent={() => ApplyRoute} />
      <Stack.Screen name="ApplicationStatus" getComponent={() => ApplicationStatusRoute} />
      <Stack.Screen name="Blocked" getComponent={() => BlockedRoute} />
      <Stack.Screen name="Usage" getComponent={() => UsageRoute} />
      <Stack.Screen name="Invoices" getComponent={() => InvoicesRoute} />
      <Stack.Screen name="Transactions" getComponent={() => TransactionsRoute} />
      <Stack.Screen name="HomeSuggestion" getComponent={() => HomeSuggestionRoute} />
      <Stack.Screen name="StoryViewer" getComponent={() => StoryViewerRoute} options={STORY_VIEWER_OPTIONS} />
    </>
  );
}

/** The provider screens every provider tab stack registers. */
function providerScreens(Stack: typeof ChatsStack) {
  return (
    <>
      <Stack.Screen name="Chat" getComponent={() => ChatRoute} />
      <Stack.Screen name="ChatV2" getComponent={() => ChatRoute} />
      <Stack.Screen name="Call" getComponent={() => CallRoute} options={CALL_OPTIONS} />
      <Stack.Screen name="ChatRequest" getComponent={() => ChatRequestRoute} />
      <Stack.Screen name="Payout" getComponent={() => PayoutRoute} />
      <Stack.Screen name="ProviderPhotos" getComponent={() => ProviderPhotosRoute} />
      <Stack.Screen name="EditProfile" getComponent={() => EditProfileRoute} />
      <Stack.Screen name="Blocked" getComponent={() => BlockedRoute} />
      <Stack.Screen name="Usage" getComponent={() => UsageRoute} />
      <Stack.Screen name="StoryViewer" getComponent={() => StoryViewerRoute} options={STORY_VIEWER_OPTIONS} />
      <Stack.Screen name="StoryCreate" getComponent={() => StoryCreateRoute} />
    </>
  );
}

/** One stack's frame: its tab's focus for `useChatLive`, and the shared options. */
function useStackFrame(): { tabFocused: boolean; options: NativeStackNavigationOptions; background: string } {
  const tabFocused = useIsFocused();
  const t = useTheme();
  const reduced = useReducedMotion();
  const background = t.color.bg.base;
  const options = useMemo(() => stackOptions(background, reduced), [background, reduced]);
  return { tabFocused, options, background };
}

function HomeTabStack() {
  const { tabFocused, options, background } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <HomeStack.Navigator initialRouteName="Home" screenOptions={options}>
        <HomeStack.Screen name="Home" getComponent={() => HomeRoute} />
        {memberScreens(HomeStack, background)}
      </HomeStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function FavouritesTabStack() {
  const { tabFocused, options, background } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <FavouritesStack.Navigator initialRouteName="Favourites" screenOptions={options}>
        <FavouritesStack.Screen name="Favourites" getComponent={() => FavouritesRoute} />
        {memberScreens(FavouritesStack, background)}
      </FavouritesStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function CallsTabStack() {
  const { tabFocused, options, background } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <CallsStack.Navigator initialRouteName="Calls" screenOptions={options}>
        <CallsStack.Screen name="Calls" getComponent={() => CallsRoute} />
        {memberScreens(CallsStack, background)}
      </CallsStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function YouTabStack() {
  const { tabFocused, options, background } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <YouStack.Navigator initialRouteName="You" screenOptions={options}>
        <YouStack.Screen name="You" getComponent={() => YouRoute} />
        {memberScreens(YouStack, background)}
      </YouStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function ChatsTabStack() {
  const { tabFocused, options } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <ChatsStack.Navigator initialRouteName="Chats" screenOptions={options}>
        <ChatsStack.Screen name="Chats" getComponent={() => ChatsRoute} />
        {providerScreens(ChatsStack)}
      </ChatsStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function SavedTabStack() {
  const { tabFocused, options } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <SavedStack.Navigator initialRouteName="Saved" screenOptions={options}>
        <SavedStack.Screen name="Saved" getComponent={() => SavedRoute} />
        {providerScreens(SavedStack)}
      </SavedStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

function ProviderYouTabStack() {
  const { tabFocused, options } = useStackFrame();
  return (
    <TabFocusedContext.Provider value={tabFocused}>
      <ProviderYouStack.Navigator initialRouteName="You" screenOptions={options}>
        <ProviderYouStack.Screen name="You" getComponent={() => ProviderYouRoute} />
        {providerScreens(ProviderYouStack)}
      </ProviderYouStack.Navigator>
    </TabFocusedContext.Provider>
  );
}

/**
 * Tab.Navigator options for both roles, after Bluesky Navigation.tsx: the
 * first tab is the initial route and what back returns to (`initialRoute`),
 * tabs mount on first visit (`lazy`), and inactive tabs are detached
 * natively (bottom-tabs' default `detachInactiveScreens`). No `animation`:
 * the default is 'none', and tabs never slide.
 */
const TAB_SCREEN_OPTIONS = { headerShown: false, lazy: true } as const;

function MemberTabs() {
  const tabBar = useCallback((props: BottomTabBarProps) => <BottomBar {...props} tabs={MEMBER_TABS} />, []);
  return (
    <MemberTab.Navigator
      initialRouteName="HomeTab"
      backBehavior="initialRoute"
      screenOptions={TAB_SCREEN_OPTIONS}
      tabBar={tabBar}>
      <MemberTab.Screen name="HomeTab" getComponent={() => HomeTabStack} />
      <MemberTab.Screen name="FavouritesTab" getComponent={() => FavouritesTabStack} />
      {CALLS_TAB_ENABLED ? <MemberTab.Screen name="CallsTab" getComponent={() => CallsTabStack} /> : null}
      <MemberTab.Screen name="YouTab" getComponent={() => YouTabStack} />
    </MemberTab.Navigator>
  );
}

function ProviderTabs() {
  const tabBar = useCallback((props: BottomTabBarProps) => <BottomBar {...props} tabs={PROVIDER_TABS} />, []);
  return (
    <ProviderTab.Navigator
      initialRouteName="ChatsTab"
      backBehavior="initialRoute"
      screenOptions={TAB_SCREEN_OPTIONS}
      tabBar={tabBar}>
      <ProviderTab.Screen name="ChatsTab" getComponent={() => ChatsTabStack} />
      <ProviderTab.Screen name="SavedTab" getComponent={() => SavedTabStack} />
      <ProviderTab.Screen name="YouTab" getComponent={() => ProviderYouTabStack} />
    </ProviderTab.Navigator>
  );
}

/**
 * The container's theme from the design tokens. Headers are hidden, so the
 * fonts stay the library's. A theme change updates the prop; nothing remounts.
 */
function useNavTheme(): NavTheme {
  const t = useTheme();
  const { isDark } = useThemeMode();
  return useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: t.color.bg.accent,
        background: t.color.bg.base,
        card: t.color.bg.base,
        text: t.color.text.primary,
        border: t.color.border.hairline,
        notification: t.color.bg.accent,
      },
    };
  }, [isDark, t]);
}

/**
 * Applies an intent the queue has decided to let through (src/lib/intents.ts
 * owns ordering, owner tags, glare and the hold during a call). Registered in
 * `onReady`, cleared on unmount.
 */
function applyIntent(intent: NavIntent): void {
  switch (intent.type) {
    case 'incomingCall': {
      // `activeCall` was set by the queue before this runs; its seq is this call's.
      const seq = useStore.getState().activeCall?.seq;
      if (seq !== undefined) {
        presentCall(
          { peerId: intent.peerId, direction: 'in', callId: intent.callId, medium: intent.medium },
          seq,
        );
      }
      return;
    }
    case 'openChat':
      openChat(intent.peerId, 'intent');
      return;
    case 'openChatV2': {
      // The dev/benchmark seam: pushed in the conversations tab, like a chat.
      const root = currentRoot();
      if (root === undefined) {
        return;
      }
      const tab = chatTabOf(root);
      const params = { peerId: intent.peerId, benchmarkReadOnly: intent.benchmarkReadOnly };
      const stack = root.routes.find(r => r.name === tab)?.state;
      if (stack === undefined) {
        navigationRef.dispatch(
          CommonActions.navigate({ name: tab, params: { screen: 'ChatV2', params, initial: false } }),
        );
        return;
      }
      if (focusedTab(root)?.name !== tab) {
        navigationRef.dispatch(CommonActions.navigate({ name: tab }));
      }
      navigationRef.dispatch({ ...StackActions.push('ChatV2', params), target: stack.key });
      return;
    }
    case 'chatRequest': {
      const target = focusedStackKey();
      if (target !== undefined) {
        navigationRef.dispatch({
          ...StackActions.push('ChatRequest', { requestId: intent.requestId }),
          target,
        });
      }
      return;
    }
  }
}

/** The focused leaf's telemetry kind, the old route strings kept (R17). */
function screenKind(state: NavigationState | undefined): string {
  const name = getCurrentRoute(state).name;
  return LEGACY_KIND[name] ?? name;
}

interface RoutesContainerProps {
  role: 'member' | 'provider';
  actions: SignedInActions;
  /** Apply's first frame, or a re-gate's restored stacks (App.tsx). */
  initialState?: InitialState;
  onStateChange: (state: NavigationState | undefined) => void;
}

/**
 * The container, both trees. App.tsx keys it by role. `onReady` registers the
 * intent applier (so a cold-start tap held through boot is applied now) and
 * sends the initial screen event, which `onStateChange` does not fire for.
 */
export function RoutesContainer({ role, actions, initialState, onStateChange }: RoutesContainerProps) {
  const theme = useNavTheme();
  const lastKind = useRef<string | null>(null);

  const onReady = useCallback(() => {
    const kind = screenKind(navigationRef.getRootState());
    lastKind.current = kind;
    trackScreenOpened(kind);
    setIntentApplier(applyIntent);
  }, []);

  const handleStateChange = useCallback(
    (state: NavigationState | undefined) => {
      const kind = screenKind(state);
      if (kind !== lastKind.current) {
        lastKind.current = kind;
        trackScreenOpened(kind);
      }
      onStateChange(state);
    },
    [onStateChange],
  );

  // Unmount (sign-out, a role flip, a re-gate): the queue holds again.
  useEffect(() => () => setIntentApplier(null), []);

  return (
    <SignedInActionsContext.Provider value={actions}>
      <NavigationContainer
        ref={navigationRef}
        theme={theme}
        initialState={initialState}
        onReady={onReady}
        onStateChange={handleStateChange}>
        {role === 'provider' ? (
          <ProviderShell>
            <ProviderTabs />
          </ProviderShell>
        ) : (
          <MemberShell>
            <MemberTabs />
          </MemberShell>
        )}
      </NavigationContainer>
    </SignedInActionsContext.Provider>
  );
}

/** Routes that are never restored: a call, a ring and a prompt are moments, not places. */
const NEVER_RESTORED: ReadonlySet<string> = new Set(['Call', 'ChatRequest', 'HomeSuggestion', 'StoryViewer', 'StoryCreate']);

/**
 * A saved state with the moments stripped out (nav-migration §3, re-gate
 * restore; https://reactnavigation.org/docs/state-persistence). Returns the
 * request ids of stripped rings so the caller can clear them.
 */
export function stripForRestore(state: NavigationState): {
  state: InitialState;
  strippedRequests: string[];
} {
  const strippedRequests: string[] = [];
  const routes = state.routes.map(tab => {
    const stack = tab.state as NavigationState | undefined;
    if (stack === undefined) {
      return { name: tab.name, params: tab.params };
    }
    const kept = stack.routes.filter(route => {
      if (!NEVER_RESTORED.has(route.name)) {
        return true;
      }
      const requestId = (route.params as { requestId?: unknown } | undefined)?.requestId;
      if (route.name === 'ChatRequest' && typeof requestId === 'string') {
        strippedRequests.push(requestId);
      }
      return false;
    });
    return {
      name: tab.name,
      params: tab.params,
      state: {
        index: Math.max(0, Math.min(stack.index, kept.length - 1)),
        routes: kept.map(r => ({ name: r.name, params: r.params })),
      },
    };
  });
  return { state: { index: state.index, routes }, strippedRequests };
}

/** Boot into Apply: Apply is the first frame, over Home, with no push (§3). */
export const APPLY_INITIAL_STATE: InitialState = {
  routes: [
    {
      name: 'HomeTab',
      state: { index: 1, routes: [{ name: 'Home' }, { name: 'Apply', params: { from: 'home' } }] },
    },
  ],
};

