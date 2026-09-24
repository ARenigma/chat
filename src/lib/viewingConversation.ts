import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { clearConversation, type ConversationPush } from './conversations';

/**
 * Which conversation is on screen right now, and what a foreground push does
 * about it.
 *
 * A foreground FCM delivery goes to `onMessage` INSTEAD of the background
 * handler, never to both (https://rnfirebase.io/messaging/usage#foreground-state-messages),
 * so whatever `onForegroundPush` decides is the whole of what the user gets.
 * It used to decide "nothing" for every chat push, which was right for the
 * conversation being read (Realtime has already put the message on screen) and
 * wrong everywhere else: somebody on Home, in Settings, or in a DIFFERENT chat
 * learned about a new message only by stumbling on it.
 *
 * The rule now is the Bluesky one (social-app
 * src/lib/hooks/useNotificationHandler.ts): show a chat notification in the
 * foreground, in the shade AND as a banner, UNLESS its conversation is the one
 * being viewed, and never with sound while the app is in use
 * (`shouldShowList` and `shouldShowBanner` both follow `convoId !==
 * currentConvoId`; `shouldPlaySound` is false). Their `currentConvoId` is set
 * by the conversation screen's `useFocusEffect` and cleared on blur; this
 * module is the same signal without a navigation library to hang it on.
 *
 * Deliberately module state and not React state or the store. The only reader
 * is the `onMessage` callback, which runs outside the render tree, and a value
 * that re-rendered anything when a chat opened would be paying for a
 * subscriber that does not exist.
 *
 * Kept free of Firebase and Supabase imports so the decision below is testable
 * without booting either (see `__tests__/pushForeground.test.ts`). The one
 * import with a native side, `clearConversation`, is a `NativeModules` call
 * that no-ops when the module is absent.
 */

let viewing: string | null = null;

/**
 * Declare the conversation on screen, or `null` for none.
 *
 * THE STABLE SEAM. The navigation is moving to react-navigation, at which point
 * the caller becomes the chat screen's `useFocusEffect` (focus sets, blur
 * clears) and nothing about this signature changes. Anything that reads the
 * signal goes through `getViewingConversation`, never the variable.
 */
export function setViewingConversation(conversationId: string | null): void {
  viewing = conversationId;
}

/** The conversation on screen, or `null` when no chat is being looked at. */
export function getViewingConversation(): string | null {
  return viewing;
}

let ringing: string | null = null;

/**
 * Declare the conversation whose chat request is ringing full screen in the
 * app, or `null` when no ring is up. Set by ChatRingScreen while AppState is
 * active, and released by it on any departure and when the ring ends.
 *
 * A second signal rather than a second use of `viewing`, because the ring is
 * not the chat: `useViewingConversation` also clears the conversation's
 * notification, which is right for a chat on screen and wrong for a ring the
 * provider may let run out (ChatRingScreen decides that clear itself).
 */
export function setRingingConversation(conversationId: string | null): void {
  ringing = conversationId;
}

/** The conversation ringing in the app, or `null`. */
export function getRingingConversation(): string | null {
  return ringing;
}

/**
 * What a foreground push does.
 *
 *   - `ignore`: the push is not a conversation push, or it is for the
 *     conversation on screen, where Realtime has already drawn the message and
 *     a notification on top of it would be noise, or for the conversation
 *     whose chat request is ringing full screen in the app, which is that same
 *     event already on screen.
 *   - `show-in-app`: post the same conversation notification the background
 *     handler would, on the in-app channel: in the shade and as a heads-up
 *     banner, with no sound or vibration. The person is already holding the
 *     phone and looking at the app, somewhere other than this chat; the banner
 *     tells them where the message is, and a sound would only repeat it.
 *   - `show`: post it exactly as the background handler does, alerting. Only
 *     when RNFirebase reported the app as foreground but the app is not
 *     actually in use (see `inUse`).
 */
export type ForegroundPushAction = 'show-in-app' | 'show' | 'ignore';

/**
 * Decide a foreground conversation push. Pure, so the rule is asserted as a
 * value rather than read off the handler.
 *
 * `inUse` is `AppState.currentState === 'active'` at delivery. It is a separate
 * input because RNFirebase's foreground test and React Native's disagree in one
 * window that matters: `SharedUtils.isAppInForeground` asks whether the PROCESS
 * is IMPORTANCE_FOREGROUND, and it still is for a moment after the screen locks,
 * while the activity has already paused and AppState has gone to 'background'.
 * A push in that window reaches `onMessage` with nobody looking, and a banner
 * with no sound there is a message the person never hears about, the same
 * outcome as the bug this replaces. So a not-in-use foreground delivery alerts,
 * exactly as the background handler would have.
 */
export function foregroundPushAction(
  push: Pick<ConversationPush, 'conversationId'> | null,
  viewingId: string | null,
  inUse = true,
  ringingId: string | null = null,
): ForegroundPushAction {
  if (push === null) {
    return 'ignore';
  }
  if (!inUse) {
    return 'show';
  }
  if (viewingId !== null && push.conversationId === viewingId) {
    return 'ignore';
  }
  /*
   * The ring. A member's first message inserts the session request and the
   * message in one transaction (077), so the provider gets the ring over
   * Realtime and the "wants to have a chat with you" push for the SAME
   * conversation. The ring is opaque and full screen (ChatRingScreen), and
   * ChatRingScreen's own header draws the line: the ring is the in-app half,
   * the notification the out-of-app half. A banner dropped over it announces
   * the event twice, and tapping it opened the chat underneath the ring,
   * which stayed up. So a push for the ringing conversation is on screen
   * already. Any other conversation still gets its banner.
   *
   * After the not-in-use test, so a phone locked mid-ring still alerts.
   * Residual, and accepted: this reads the signal at delivery, so a push that
   * beats the Realtime insert can still peek once before the ring starts. Both
   * leave the server on the same commit (the push through 092/105's insert
   * trigger), and the push then has send-push and FCM to cross while the ring
   * has one open socket, so the ring usually wins. Clearing the notification
   * when a ring starts would close the gap, and would also cancel older lines
   * of that conversation nobody has read, which the platform says not to do.
   */
  if (ringingId !== null && push.conversationId === ringingId) {
    return 'ignore';
  }
  return 'show-in-app';
}

/**
 * Hold the signal for as long as this conversation is on screen AND the app is
 * in use.
 *
 * Called from the V2 chat controller, so it covers every tree that mounts the
 * V2 screen — the member's chat and the provider's — without either knowing.
 * `undefined` until the thread resolves (a brand-new conversation has no id to
 * compare yet), which leaves the signal clear rather than guessing.
 *
 * Why AppState and not mount alone: a chat left open when the phone locks or
 * the person switches apps is still MOUNTED, but nobody is viewing it, and a
 * push for it must not be swallowed on the grounds that they are.
 *
 * Every clear is conditional on the signal still being ours. Two chat screens
 * can overlap for a frame during a push or pop, and an unconditional clear from
 * the leaving one would erase the arriving one's claim.
 *
 * Taking the signal also removes this conversation's notification from the
 * shade. Without it, every in-app foreground post for a chat the person then
 * opened from Home stayed behind, and the next post read that transcript back
 * and grew it, so the shade kept a stack of lines already read. The platform
 * sets the moment: a conversation notification is not to be cancelled before
 * the person has seen the message, and cancelling it on opening the app in a
 * view where the message cannot be seen is the example it gives of getting
 * that wrong. This is the right moment — the conversation is on screen and the
 * app is in use — so it runs on mount and on every return to active, and not
 * on Home or on a bare app launch. A tap on the notification already cleared
 * it through `setAutoCancel`. Same id both posts use (`notificationId` in
 * Conversations.kt), so a chat request's notification goes too.
 * https://developer.android.com/develop/ui/views/notifications/conversations#best-practices
 * https://developer.android.com/develop/ui/views/notifications/build-notification#Removing
 */
export function useViewingConversation(conversationId: string | undefined): void {
  useEffect(() => {
    if (conversationId === undefined) {
      return;
    }
    const release = (): void => {
      if (getViewingConversation() === conversationId) {
        setViewingConversation(null);
      }
    };
    const sync = (state: AppStateStatus): void => {
      if (state === 'active') {
        setViewingConversation(conversationId);
        void clearConversation(conversationId);
      } else {
        release();
      }
    };
    sync(AppState.currentState);
    const subscription = AppState.addEventListener('change', sync);
    return () => {
      subscription.remove();
      release();
    };
  }, [conversationId]);
}
