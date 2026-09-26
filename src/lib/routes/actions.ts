/**
 * Pure navigation planners and imperative dispatch helpers.
 *
 * Pure functions (glareDecision, resolveOpenChat) return a description of
 * what to do; they carry no side effects and are unit-tested in isolation.
 * Imperative wrappers (applyChatPlan, removeSelf, startCall, openWallet,
 * closeWallet, openRefill) dispatch through navigationRef.
 *
 * Every programmatic REMOVAL here is dispatched with the route's own `source`
 * and its stack's `target`: without both, StackRouter acts on `state.index`,
 * the top of the stack, whatever route asked (StackRouter.tsx POP/REPLACE,
 * `action.target === state.key && action.source`). And an action with a
 * string `target` is offered to every navigator in the tree until the one
 * with that key takes it (core useOnAction.tsx), so a targeted action reaches
 * a stack in an unfocused tab too. nav-migration §3, ruling 12.
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useNotificationHandler.ts
 * and src/Navigation.tsx (MIT), see THIRD_PARTY_LICENSES.md
 */

import { CommonActions, StackActions } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { requestAwayFromFocusedChat } from './focusedChat';
import { navigationRef } from './navigationRef';
import type { CallMedium } from './types';

// ---------------------------------------------------------------------------
// Glare decision (incoming-call race)
// ---------------------------------------------------------------------------

export type ActiveCall = {
  seq: number;
  callId: string | null;
  peerId: string;
  direction: 'in' | 'out';
};

export type IncomingCallIntent = {
  type: 'incomingCall';
  peerId: string;
  callId: string;
};

/**
 * Decides what to do when a second incoming-call signal arrives while a call
 * is already active. Returns:
 *
 * - `'duplicate'`     — same callId already on screen; drop silently.
 * - `'ownDialRace'`   — this is the M23 own-dial echo; drop silently.
 * - `'busyDecline'`   — a genuinely different call; busy-decline it.
 *
 * Pure: no side effects, unit-tested.
 *
 * Three branches from nav-migration §3.
 */
export type GlareDecision = 'duplicate' | 'ownDialRace' | 'busyDecline';

export function glareDecision(
  activeCall: ActiveCall,
  intent: IncomingCallIntent,
): GlareDecision {
  if (activeCall.callId === intent.callId) {
    // Same call already on screen.
    return 'duplicate';
  }
  if (
    activeCall.direction === 'out' &&
    activeCall.callId === null &&
    activeCall.peerId === intent.peerId
  ) {
    // Own outgoing call: the M23 own-dial race where start_call will report
    // ALREADY_RINGING. Drop; the existing call remains.
    return 'ownDialRace';
  }
  // A genuinely different live call is already on screen.
  return 'busyDecline';
}

// ---------------------------------------------------------------------------
// Navigator state, as the planners read it
// ---------------------------------------------------------------------------

/** A route as the planners read it: enough to find, target and name it. */
export interface RouteLike {
  key: string;
  name: string;
  params?: unknown;
  state?: StackLike;
}

/** A navigator's state: one tab stack, or the tab navigator at the root. */
export interface StackLike {
  key: string;
  index?: number;
  routes: readonly RouteLike[];
}

/** The tab a role's conversations live in (Bluesky routes chat pushes to MessagesTab). */
export function chatTabOf(root: StackLike): 'HomeTab' | 'ChatsTab' {
  return root.routes.some(r => r.name === 'ChatsTab') ? 'ChatsTab' : 'HomeTab';
}

function focusedIndex(state: StackLike): number {
  return state.index ?? state.routes.length - 1;
}

/** The focused tab route and its stack state (undefined until the tab is first visited). */
export function focusedTab(root: StackLike): RouteLike | undefined {
  return root.routes[root.index ?? 0];
}

function focusedRouteOf(stack: StackLike | undefined): RouteLike | undefined {
  if (stack === undefined) {
    return undefined;
  }
  return stack.routes[focusedIndex(stack)];
}

function peerOf(route: RouteLike): string | undefined {
  const params = route.params as { peerId?: unknown } | undefined;
  return typeof params?.peerId === 'string' ? params.peerId : undefined;
}

/** Where a route key lives: its tab, its stack and its index in that stack. */
export function locateRoute(
  root: StackLike,
  routeKey: string,
): { tab: RouteLike; stack: StackLike; index: number } | undefined {
  for (const tab of root.routes) {
    const stack = tab.state;
    if (stack === undefined) {
      continue;
    }
    const index = stack.routes.findIndex(r => r.key === routeKey);
    if (index !== -1) {
      return { tab, stack, index };
    }
  }
  return undefined;
}

/** The first `Chat(peerId)` in any tab stack, the focused tab's stack first. */
function findChat(
  root: StackLike,
  peerId: string,
): { tab: RouteLike; stack: StackLike; index: number } | undefined {
  const focused = focusedTab(root);
  const tabs = focused === undefined ? root.routes : [focused, ...root.routes.filter(t => t !== focused)];
  for (const tab of tabs) {
    const stack = tab.state;
    if (stack === undefined) {
      continue;
    }
    const index = stack.routes.findIndex(r => r.name === 'Chat' && peerOf(r) === peerId);
    if (index !== -1) {
      return { tab, stack, index };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Chat plan (pure planner)
// ---------------------------------------------------------------------------

/**
 * Describes the navigation action required to open a chat, without executing
 * it. `applyChatPlan` performs the dispatch. `tab` is the tab to switch to
 * first, or null to stay in the focused one.
 */
export type ChatPlan =
  | {
      kind: 'popTo';
      tab: string | null;
      stackKey: string;
      /** Routes to pop off the top of that stack; 0 when the chat is on top. */
      count: number;
      /** The origin's own route, when the pop does not already remove it. */
      removeSource?: { source: string; target: string };
    }
  | { kind: 'replace'; source: string; target: string; peerId: string }
  | { kind: 'push'; tab: string | null; target: string; peerId: string }
  /** A tab stack that has never been visited has no key to target yet. */
  | { kind: 'navigateNested'; tab: string; peerId: string }
  | { kind: 'noop' };

export type ChatOrigin =
  | 'intent'
  | 'inApp'
  | 'callEnd'
  | 'requestAccept'
  | 'suggestionAccept'
  /**
   * From a native form sheet (the ProviderDetail profile). The chat REPLACES
   * the sheet rather than being pushed over it: on Android a card pushed over
   * a form sheet detaches the sheet's fragment, and popping back re-attaches
   * it through its enter animator, so the sheet would slide up again over the
   * pop (react-native-screens ScreenStack.onUpdate, ScreenStackFragment
   * onCreateAnimator). Owner decision 2026-09-26, ADR-0032.
   */
  | 'fromSheet';

/**
 * Resolves what navigation opens Chat(peerId) from the root (tab) state.
 * Rules, first match wins (nav-migration §3):
 *
 * 1. Chat(peerId) exists in any tab stack, focused tab first: pop to it,
 *    switching tabs if needed. One chat per peer across the whole navigator
 *    (A6). The origin's own route (Call, ChatRequest, HomeSuggestion) is
 *    removed too when the pop does not already take it.
 * 2. callEnd / requestAccept / suggestionAccept / fromSheet: REPLACE the
 *    origin's route with the chat, in its own stack.
 * 3. intent while the focused route is another peer's Chat: replace it in
 *    place (its prevent-remove asks first when it is paid).
 * 4. intent: push in the conversations tab (switching to it). inApp: push in
 *    the focused stack.
 *
 * A same-name `navigate(..., {pop: true})` is never used for chats: it matches
 * by name and would reuse chat A's key for peer B.
 */
export function resolveOpenChat(
  root: StackLike | undefined,
  peerId: string,
  origin: ChatOrigin,
  sourceKey?: string,
): ChatPlan {
  if (root === undefined) {
    return { kind: 'noop' };
  }
  const current = focusedTab(root);
  const source = sourceKey === undefined ? undefined : locateRoute(root, sourceKey);

  // Rule 1.
  const existing = findChat(root, peerId);
  if (existing !== undefined) {
    const top = existing.stack.routes.length - 1;
    const removedByPop =
      source !== undefined && source.stack.key === existing.stack.key && source.index > existing.index;
    return {
      kind: 'popTo',
      tab: existing.tab.key === current?.key ? null : existing.tab.name,
      stackKey: existing.stack.key,
      count: top - existing.index,
      removeSource:
        source !== undefined && !removedByPop
          ? { source: sourceKey as string, target: source.stack.key }
          : undefined,
    };
  }

  // Rule 2.
  if (
    origin === 'callEnd' ||
    origin === 'requestAccept' ||
    origin === 'suggestionAccept' ||
    origin === 'fromSheet'
  ) {
    if (source !== undefined) {
      return { kind: 'replace', source: sourceKey as string, target: source.stack.key, peerId };
    }
  }

  const focusedStack = current?.state;
  const focusedRoute = focusedRouteOf(focusedStack);

  // Rule 3.
  if (
    origin === 'intent' &&
    focusedStack !== undefined &&
    focusedRoute !== undefined &&
    focusedRoute.name === 'Chat' &&
    peerOf(focusedRoute) !== peerId
  ) {
    return { kind: 'replace', source: focusedRoute.key, target: focusedStack.key, peerId };
  }

  // Rule 4.
  if (origin === 'intent') {
    const chatTab = chatTabOf(root);
    const tab = root.routes.find(r => r.name === chatTab);
    if (tab === undefined) {
      return { kind: 'noop' };
    }
    if (tab.state === undefined) {
      return { kind: 'navigateNested', tab: chatTab, peerId };
    }
    return {
      kind: 'push',
      tab: tab.key === current?.key ? null : chatTab,
      target: tab.state.key,
      peerId,
    };
  }
  if (focusedStack === undefined || current === undefined) {
    return { kind: 'noop' };
  }
  return { kind: 'push', tab: null, target: focusedStack.key, peerId };
}

// ---------------------------------------------------------------------------
// Imperative dispatch helpers
// ---------------------------------------------------------------------------

/** The root (tab) state as the planners read it, or undefined before onReady. */
export function currentRoot(): StackLike | undefined {
  if (!navigationRef.isReady()) {
    return undefined;
  }
  return navigationRef.getRootState() as unknown as StackLike;
}

/** The focused tab's stack key, or undefined before the navigator is ready. */
export function focusedStackKey(): string | undefined {
  const root = currentRoot();
  return root === undefined ? undefined : focusedTab(root)?.state?.key;
}

/**
 * Carries out a `resolveOpenChat` plan. A plan that leaves the focused tab
 * while a paid chat is on it asks that chat first (`requestAway`), so no
 * intent silently walks away from a running bill: the chat's leave dialog
 * opens, and confirming ends the session and then proceeds.
 */
export function applyChatPlan(plan: ChatPlan): void {
  if (plan.kind === 'noop' || !navigationRef.isReady()) {
    return;
  }
  const run = (): void => {
    switch (plan.kind) {
      case 'popTo':
        if (plan.tab !== null) {
          navigationRef.dispatch(CommonActions.navigate({ name: plan.tab }));
        }
        if (plan.count > 0) {
          navigationRef.dispatch({ ...StackActions.pop(plan.count), target: plan.stackKey });
        }
        if (plan.removeSource !== undefined) {
          removeSelf(plan.removeSource.source, plan.removeSource.target);
        }
        return;
      case 'replace':
        navigationRef.dispatch({
          ...StackActions.replace('Chat', { peerId: plan.peerId }),
          source: plan.source,
          target: plan.target,
        });
        return;
      case 'push':
        if (plan.tab !== null) {
          navigationRef.dispatch(CommonActions.navigate({ name: plan.tab }));
        }
        navigationRef.dispatch({
          ...StackActions.push('Chat', { peerId: plan.peerId }),
          target: plan.target,
        });
        return;
      case 'navigateNested':
        // An unvisited tab: its stack is created with Chat above its root
        // (https://reactnavigation.org/docs/nesting-navigators#rendering-initial-route-defined-in-the-navigator).
        navigationRef.dispatch(
          CommonActions.navigate({
            name: plan.tab,
            params: { screen: 'Chat', params: { peerId: plan.peerId }, initial: false },
          }),
        );
        return;
    }
  };
  const leavesTab =
    plan.kind === 'navigateNested' ||
    ((plan.kind === 'popTo' || plan.kind === 'push') && plan.tab !== null);
  if (leavesTab) {
    requestAwayFromFocusedChat(run);
    return;
  }
  run();
}

/** Opens Chat(peerId) through the planner. The one door for every opener. */
export function openChat(peerId: string, origin: ChatOrigin, sourceKey?: string): void {
  applyChatPlan(resolveOpenChat(currentRoot(), peerId, origin, sourceKey));
}

/**
 * Removes exactly one route from its stack by key, even when it is not at
 * the top. Dispatches with `source` + `target` so StackRouter acts on that
 * specific route rather than on `state.index` (StackRouter.tsx POP). A route
 * that is already gone (replaced, or popped with the ones above it) is left
 * alone rather than turned into an unhandled action.
 *
 * Never deduped (nav-migration §3): CallScreen's no-balance end fires within
 * one round trip of the push. A contract pin forbids any code calling
 * `navigationRef.goBack()` directly.
 */
export function removeSelf(routeKey: string, stackKey: string): void {
  const root = currentRoot();
  if (root === undefined) {
    return;
  }
  const where = locateRoute(root, routeKey);
  if (where === undefined || where.stack.key !== stackKey || where.index === 0) {
    return;
  }
  navigationRef.dispatch({
    ...StackActions.pop(1),
    source: routeKey,
    target: stackKey,
  });
}

/** The `Call` route's params, both directions. */
export interface CallParams {
  peerId: string;
  direction: 'in' | 'out';
  callId: string | null;
  medium: CallMedium;
}

/**
 * Presents the `Call` route for the call `activeCall` holds as `seq`: pushed
 * into the focused stack (or into the focused tab when its stack has not been
 * created yet), or in place of `replace`. Checked a frame later against the
 * whole tree, because a nested stack's state is not guaranteed readable in the
 * dispatch's own tick: if no Call landed, the call is released at once rather
 * than holding every intent behind a call that is not on screen.
 */
export function presentCall(
  params: CallParams,
  seq: number,
  replace?: { source: string; target: string },
): void {
  const root = currentRoot();
  const target = replace?.target ?? focusedStackKey();
  if (replace !== undefined) {
    navigationRef.dispatch({ ...StackActions.replace('Call', { ...params }), source: replace.source, target: replace.target });
  } else if (target !== undefined) {
    navigationRef.dispatch({ ...StackActions.push('Call', { ...params }), target });
  } else if (root !== undefined && focusedTab(root) !== undefined) {
    navigationRef.dispatch(
      CommonActions.navigate({
        name: (focusedTab(root) as RouteLike).name,
        params: { screen: 'Call', params: { ...params }, initial: false },
      }),
    );
  }
  requestAnimationFrame(() => {
    const now = currentRoot();
    const landed =
      now !== undefined &&
      now.routes.some(tab => tab.state?.routes.some(r => r.name === 'Call') === true);
    if (!landed) {
      useStore.getState().endActiveCall(seq);
    }
  });
}

/**
 * Places an outgoing call: `activeCall` first (so a ring in the same frame
 * meets the glare guard), then the route (`presentCall`).
 *
 * `replace` names a route the call takes the place of instead of being pushed
 * over: the profile sheet, for the reason `fromSheet` states.
 */
export function startCall(
  peerId: string,
  medium: CallMedium,
  replace?: { source: string; target: string },
): void {
  const store = useStore.getState();
  if (store.activeCall !== null || !navigationRef.isReady()) {
    return;
  }
  const seq = store.beginCall({ direction: 'out', callId: null, peerId });
  presentCall({ peerId, direction: 'out', callId: null, medium }, seq, replace);
}

/**
 * The wallet page. Keeps the store's old exclusion with the refill sheet
 * (never both): the sheet closes, a focused Wallet stays as it is, and
 * otherwise the focused stack pops back to its Wallet or pushes one
 * (NAVIGATE with `pop`, StackRouter: it reuses the last route of that name).
 */
export function openWallet(): void {
  useStore.getState().closeRefill();
  const target = focusedStackKey();
  if (target === undefined || navigationRef.getCurrentRoute()?.name === 'Wallet') {
    return;
  }
  navigationRef.dispatch({
    ...CommonActions.navigate({ name: 'Wallet', pop: true }),
    target,
  });
}

/** Leaves the wallet page if it is the focused route. PaymentSheet's success calls it. */
export function closeWallet(): void {
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  const stack = focusedStackKey();
  if (route?.name !== 'Wallet' || stack === undefined) {
    return;
  }
  removeSelf(route.key, stack);
}

/** The refill sheet, with the wallet page closed first (the old exclusion). */
export function openRefill(): void {
  closeWallet();
  useStore.getState().openRefill();
}
