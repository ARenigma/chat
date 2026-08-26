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

export type MemberRoute =
  /**
   * The v13 merged home: Chats and Explore on one screen. Replaces the first-gen
   * `inbox` + `directory` tab pair.
   */
  | { readonly name: 'home' }
  /** The provider profile, reached from a Home row, the rail, or the featured card. */
  | { readonly name: 'providerDetail'; readonly providerId: string }
  /**
   * `from` exists because a conversation has more than one door.
   *
   * You reach a chat from Home directly or from a provider's detail screen, and
   * back should return you to the one you used. Without it the choice is a wrong
   * guess, or a full history stack to answer a question one field answers.
   */
  | { readonly name: 'chat'; readonly providerId: string; readonly from: 'home' | 'detail' }
  | { readonly name: 'apply' }
  | { readonly name: 'applicationStatus' };

export type ProviderRoute =
  | { readonly name: 'home' }
  | { readonly name: 'chat'; readonly peerId: string };

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
      // Back from a chat opened via a profile returns to that profile, not Home.
      return route.from === 'detail'
        ? { name: 'providerDetail', providerId: route.providerId }
        : { name: 'home' };
    case 'providerDetail':
    case 'apply':
    case 'applicationStatus':
      return { name: 'home' };
  }
}

export function providerParent(route: ProviderRoute): ProviderRoute | null {
  return route.name === 'home' ? null : { name: 'home' };
}
