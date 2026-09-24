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

/**
 * How many overlays currently cover the screen: every bottom sheet (`Sheet`,
 * which SafetySheet, ConfirmDialog and the rest are built on) and the
 * full-screen MediaViewer. A chat under one is still mounted, so it still
 * holds `viewing`, but its transcript is not what the person is looking at;
 * a message for it that arrived then was `ignore`d as "already on screen" and
 * never shown anywhere (Greptile P1 on 7a9de76). While anything covers the
 * screen, no conversation counts as viewed, so that message gets the in-app
 * banner (no sound) like any other.
 */
let covers = 0;

/**
 * Mark the screen covered until the returned release is called. The release
 * is idempotent, so an effect cleanup and an explicit close cannot count
 * twice.
 */
export function coverViewing(): () => void {
  covers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    covers = Math.max(0, covers - 1);
  };
}

/** The conversation on screen, or `null` when no chat is being looked at. */
export function getViewingConversation(): string | null {
  return covers > 0 ? null : viewing;
}

let ringing: string | null = null;

/**
 * Declare the conversation whose chat request is ringing full screen in the
 * app, or `null` when no ring is up. Set by ChatRingScreen for the ring's
 * whole life, whether or not the app is in use, and released by it when the
 * ring ends or unmounts.
 *
 * A second signal rather than a second use of `viewing`, because the ring is
 * not the chat: `useViewingConversation` also clears the conversation's
 * notification, which is right for a chat on screen and wrong for a ring the
 * provider may let run out (ChatRingScreen decides that clear itself).
 *
 * Not dropped while the app is out of use, for two reasons. It does not need
 * to be: `foregroundPushAction` tests `inUse` before the ring, so a phone
 * locked mid-ring still alerts. And it must not be: `useViewingConversation`
 * reads it on every return to active to decide whether the ring still covers
 * its chat, and AppState calls its listeners in the order they subscribed.
 * The chat under a ring subscribed first, so a signal the ring took back on
 * the same return would still be clear when the chat asked, and the chat
 * would clear a notification nobody could see.
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
 *     conversation on screen with no ring over it, where Realtime has already
 *     drawn the message and a notification on top of it would be noise.
 *   - `show-silent`: the push is for the conversation whose chat request is
 *     ringing full screen in the app, even when that conversation's chat is
 *     the screen under the ring. The ring is that same event on screen, so
 *     no banner and no sound; but it still goes into the shade, silently
 *     (NotificationCompat#setSilent), because the ring is out of sight the
 *     moment AppState leaves active: a provider who locks the phone or
 *     switches apps before answering, and does not come back, has only the
 *     shade entry to answer from.
 *   - `show-in-app`: post the same conversation notification the background
 *     handler would, on the in-app channel: in the shade and as a heads-up
 *     banner, with no sound or vibration. The person is already holding the
 *     phone and looking at the app, somewhere other than this chat; the banner
 *     tells them where the message is, and a sound would only repeat it.
 *   - `show`: post it exactly as the background handler does, alerting. Only
 *     when RNFirebase reported the app as foreground but the app is not
 *     actually in use (see `inUse`).
 */
export type ForegroundPushAction = 'show-in-app' | 'show-silent' | 'show' | 'ignore';

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
  /*
   * The ring. A member's first message inserts the session request and the
   * message in one transaction (077), so the provider gets the ring over
   * Realtime and the "wants to have a chat with you" push for the SAME
   * conversation. The ring is opaque and full screen (ChatRingScreen), and
   * ChatRingScreen's own header draws the line: the ring is the in-app half,
   * the notification the out-of-app half. A banner dropped over it announces
   * the event twice, and tapping it opened the chat underneath the ring,
   * which stayed up. While it is up, no conversation gets a banner (below).
   *
   * Silent, not dropped. This used to be `ignore`, on the reasoning that the
   * event was on screen already; it is, but only while the provider stays.
   * The ring is out of sight the moment AppState leaves active, and a
   * provider who locked the phone or switched apps before answering, and did
   * not come back, had no shade entry at all: the one out-of-app half of the
   * request had been thrown away while they were looking at the in-app half.
   * (One who comes back within the 30 seconds finds the ring still up; after
   * it the request waits in the thread.) setSilent "prevents the
   * notification from peeking on screen, regardless of the importance",
   * which keeps the ring clear, and the entry sits in the shade until it is
   * answered, dismissed, or cleared: ChatRingScreen clears it on a decline the
   * server took, on a ring watched to the end, and when the ring leaves with
   * this conversation's chat on screen under it; opening the chat clears it
   * (`useViewingConversation`).
   * https://developer.android.com/develop/ui/views/notifications/build-notification#Removing
   * https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSilent(boolean)
   *
   * Before the viewing test. The ring is opaque and covers whatever is under
   * it, so the chat on screen by the signal can be this very conversation
   * with nobody able to see it: a provider still on a member's thread when
   * that member sends again with no live session gets a new request (077)
   * and its ring over that thread. Tested the other way round, that push was
   * `ignore`, and the provider who then left had no shade entry at all, the
   * case this branch exists for.
   *
   * After the not-in-use test, so a phone locked mid-ring still alerts. That
   * order is the whole of it: ChatRingScreen holds the ringing signal while
   * the app is out of use (see `setRingingConversation`).
   * Residual, and accepted: this reads the signal at delivery, so a push that
   * beats the Realtime insert can still peek once before the ring starts. Both
   * leave the server on the same commit (the push through 092/105's insert
   * trigger), and the push then has send-push and FCM to cross while the ring
   * has one open socket, so the ring usually wins. Clearing the notification
   * when a ring starts would close the gap, and would also cancel older lines
   * of that conversation nobody has read, which the platform says not to do.
   */
  /*
   * Any ring, not only this conversation's. The ring is opaque and full
   * screen, so while it is up nothing under it is visible, including the chat
   * the viewing signal still names: a message for that chat must not be
   * `ignore`d as "already on screen", and no banner may peek over the ring
   * for any conversation. Everything goes to the shade silently until the
   * ring leaves.
   */
  if (ringingId !== null) {
    return 'show-silent';
  }
  if (viewingId !== null && push.conversationId === viewingId) {
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
 *
 * Except while this conversation's chat request is ringing over it. The ring
 * is opaque and full screen (ChatRingScreen), so the chat is mounted, in use
 * and holding the signal while nobody can see it: the platform's view "where
 * the user can't see or address the message". The shade entry is then the
 * ring's out-of-app half (`show-silent` in `foregroundPushAction`), and
 * clearing it on a return would undo that. ChatRingScreen does this clear
 * instead, when the ring leaves with this chat on screen.
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
        if (getRingingConversation() !== conversationId) {
          void clearConversation(conversationId);
        }
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
