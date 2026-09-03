/**
 * Where the back gesture goes, as data rather than as branches in a handler.
 *
 * Nothing intercepted back before this, so the gesture quit the app from any
 * screen, including from inside a conversation. On Android that is not a missing
 * feature, it is the app being rude: back is the one control users trust to be
 * reversible.
 *
 * Kept here rather than in `App.tsx` for the usual reason: `App.tsx` imports the
 * whole native runtime, and a lookup table should be testable without booting it.
 *
 * Deliberately not React Navigation. A handful of destinations across two trees,
 * no deep linking into anything but a conversation, no shared element
 * transitions. What that library would add is a history stack, and a stack is
 * what the `from` field below replaces for the routes where history matters.
 */

/** The door a conversation was opened from — back returns here. */
export type ChatDoor = 'home' | 'detail' | 'chatsList';

export type MemberRoute =
  /**
   * The v13 merged home: Chats and Explore on one screen. Replaces the first-gen
   * `inbox` + `directory` tab pair.
   */
  | { readonly name: 'home' }
  /**
   * The provider profile. Like `chat`, it has more than one door — a Home row /
   * rail / featured card, the Favourites grid, or the identity block in a chat
   * header — and back returns to the one used. `from` is that door.
   */
  | {
      readonly name: 'providerDetail';
      readonly providerId: string;
      readonly from: 'home' | 'favourites' | 'chat';
    }
  /**
   * `from` exists because a conversation has more than one door.
   *
   * You reach a chat from Home, the extended Chats list, or a provider's
   * detail screen, and back should return you to the one you used. Without it
   * the choice is a wrong guess, or a full history stack to answer a question
   * one field answers. See docs/flows.md.
   */
  | {
      readonly name: 'chat';
      readonly providerId: string;
      readonly from: ChatDoor;
    }
  /**
   * A voice or video call. `direction` is 'out' (we dialled; `callId` is null
   * until `start_call` returns one) or 'in' (someone is ringing us; `callId`
   * is set). Reached from a chat/profile call button (out) or the incoming-call
   * subscription (in). `medium` determines whether audio-only or video is
   * negotiated; the peer's camera starts off and can be toggled mid-call.
   */
  | {
      readonly name: 'call';
      readonly providerId: string;
      readonly direction: 'out' | 'in';
      readonly callId: string | null;
      readonly medium: 'voice' | 'video';
    }
  /**
   * The provider application form. Three doors, three parents: the post-onboarding
   * redirect (root `home`), the Settings "become a provider" row, and the "edit"
   * action on the application-status screen. `from` keeps back honest for each.
   */
  | { readonly name: 'apply'; readonly from: 'home' | 'settings' | 'applicationStatus' }
  | { readonly name: 'applicationStatus' }
  | { readonly name: 'blocked' }
  /** The full chats list, reached from the Home rail's "See all". */
  | { readonly name: 'chatsList' }
  /** The Calls tab (empty state for now); a top-level nav destination. */
  | { readonly name: 'calls' }
  /** The Favourites tab — saved providers; a top-level nav destination. */
  | { readonly name: 'favourites' }
  /** Account & privacy, a mounted screen now rather than a bottom sheet. */
  | { readonly name: 'settings' }
  /** Recharge history and invoice downloads. */
  | { readonly name: 'transactions' };

export type ProviderRoute =
  | { readonly name: 'home' }
  | { readonly name: 'chat'; readonly peerId: string }
  | { readonly name: 'settings' }
  /** Bank/UPI + PAN payout setup. */
  | { readonly name: 'payout' }
  /** A voice or video call on the provider tree. */
  | {
      readonly name: 'call';
      readonly peerId: string;
      readonly direction: 'out' | 'in';
      readonly callId: string | null;
      readonly medium: 'voice' | 'video';
    };

/**
 * The route back, or `null` when there is nowhere left to go.
 *
 * `null` means "let Android have the gesture", which closes the app. That is
 * correct at the root: an app that traps back at its home screen is worse than
 * one that never handled it, because the user has no way out except the task
 * switcher.
 */
export function memberParent(route: MemberRoute): MemberRoute | null {
  switch (route.name) {
    case 'home':
      return null;
    case 'chat':
      if (route.from === 'detail') {
        return { name: 'providerDetail', providerId: route.providerId, from: 'home' };
      }
      if (route.from === 'chatsList') {
        return { name: 'chatsList' };
      }
      return { name: 'home' };
    case 'call':
      // Home for either direction: an incoming call's `providerId` is the caller,
      // who may be a member (no profile screen), so the profile is the wrong
      // parent. Ending a call lands you home.
      return { name: 'home' };
    case 'providerDetail':
      if (route.from === 'favourites') {
        return { name: 'favourites' };
      }
      if (route.from === 'chat') {
        // Back to the conversation the profile was opened from. The chat's own
        // door is not carried here, so it re-opens as a home-door chat; its next
        // back then lands home, which is the right floor.
        return { name: 'chat', providerId: route.providerId, from: 'home' };
      }
      return { name: 'home' };
    case 'apply':
      if (route.from === 'settings') {
        return { name: 'settings' };
      }
      if (route.from === 'applicationStatus') {
        return { name: 'applicationStatus' };
      }
      return { name: 'home' };
    // Reached from Settings (check status) or from a just-submitted application;
    // Settings is the right floor for both — you do not go back into a form you
    // have already submitted.
    case 'applicationStatus':
      return { name: 'settings' };
    // Only reached from Settings.
    case 'blocked':
      return { name: 'settings' };
    case 'chatsList':
    case 'calls':
    case 'favourites':
    case 'settings':
      return { name: 'home' };
    case 'transactions':
      return { name: 'settings' };
  }
}

export function providerParent(route: ProviderRoute): ProviderRoute | null {
  return route.name === 'home' ? null : { name: 'home' };
}

/**
 * Which transition a member route arrives with, as data rather than branches.
 *
 * Three kinds, matching the three M3 patterns the app uses (see
 * `design/references/motion-system.md`):
 *
 *   root  — Home, the always-mounted floor. It never slides; the pushed screens
 *           are overlays above it and it is only ever revealed by a pop.
 *   tab   — the top-level destinations reached from the floating toolbar. They
 *           swap with a fade-through (no slide, no shared element), because they
 *           are peers, not a hierarchy.
 *   push  — everything deeper: a forward/back slide under a fade.
 *
 * A `switch` with no `default`, so adding a route to `MemberRoute` without
 * classifying it here fails typecheck rather than silently defaulting.
 */
export type TransitionKind = 'root' | 'tab' | 'push';

export function transitionFor(route: MemberRoute): TransitionKind {
  switch (route.name) {
    case 'home':
      return 'root';
    case 'favourites':
    case 'calls':
    case 'settings':
      return 'tab';
    case 'chat':
    case 'providerDetail':
    case 'call':
    case 'apply':
    case 'applicationStatus':
    case 'blocked':
    case 'chatsList':
    case 'transactions':
      return 'push';
  }
}
