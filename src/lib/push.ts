import { PermissionsAndroid, Platform } from 'react-native';
import { alertPermissionBlocked, requestAndroidPermission } from './permissions';
import {
  AuthorizationStatus,
  deleteToken,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { supabase } from './supabase';
import {
  ensureConversationChannel,
  readCallPush,
  readEngagementPush,
  type CallPush,
  type EngagementPush,
} from './conversations';

/**
 * Push notifications, which are the one thing the product's core loop was
 * missing.
 *
 * Realtime only reaches a client holding a live socket, so until now "someone
 * replied" was a fact the app could only learn while it was open, which is the
 * opposite of what a conversation product needs. This is also the only feature a
 * paid chat SDK would genuinely have given us, and it costs nothing: FCM is
 * free at any volume we will see.
 *
 * Three deliberate omissions:
 *
 *   1. **No notification is displayed while the app is foregrounded.** A
 *      foreground delivery goes to `onMessage` INSTEAD of the background
 *      handler, never to both, so whatever it does is the whole of what the
 *      user gets. For an ordinary message that is nothing: Realtime has already
 *      put it on screen and a banner over the conversation you are reading is
 *      noise. A CALL and an engagement nudge are the two exceptions, and they
 *      are not cosmetic ones — if the Realtime socket is down (a network flap,
 *      a Doze wake, a token refresh) the push is the only ring there will be,
 *      and `announce_chat_open` gates on a MANUAL presence declaration, so it
 *      reaches somebody who is actively using the app. Both are routed into the
 *      app's own UI by `onForegroundPush` below rather than drawn.
 *      https://rnfirebase.io/messaging/usage#foreground-state-messages
 *   2. **The body is never in the payload.** The sender publishes who it is from
 *      and nothing else, see `pending_pushes`. A lock screen that quotes the
 *      message tells whoever is holding the phone what you talked about, and for
 *      this product that is the wrong default at any convenience.
 *   3. **No notification library.** Notifee and friends exist to *display*
 *      notifications from the app, which is exactly the case we are declining.
 *
 * Uses the modular API (`getMessaging(...)`) rather than the namespaced
 * `messaging()` default export, which v26 removed, the namespaced form still
 * appears in most tutorials and fails at import with no default export.
 */

/**
 * Notification permission policy — controls whether the blocked-settings alert
 * fires when the user has permanently denied POST_NOTIFICATIONS on Android 13+.
 *
 * Default is optional: notification denial is a valid product choice and must
 * never block Home. Set this via `setNotificationPolicy()` before calling
 * `startPush()` when remote config is available.
 */
let _notificationPolicy: 'optional' | 'required' = 'optional';

/**
 * Configure the notification blocking-alert behaviour before startPush().
 *
 * When 'optional', a permanent denial is accepted silently — the app works
 * without push and the user is not shown a settings alert. When 'required'
 * (the default), the alert fires so the user can re-enable in Settings.
 *
 * Called from App.tsx after resolving effectivePermissionLevel('notification')
 * from the admin permissions config.
 */
export function setNotificationPolicy(level: 'optional' | 'required'): void {
  _notificationPolicy = level;
}

/** Whether this device can receive FCM lock-screen rings. */
export async function notificationsGranted(): Promise<boolean> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  return true;
}

/**
 * Android 13 made notifications a runtime permission, so on API 33+ a token
 * without a granted permission is a token that will never ring. Below 33 the
 * permission is implicit and the request resolves immediately.
 */
async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) >= 33) {
      const outcome = await requestAndroidPermission(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (outcome === 'never_ask_again' && _notificationPolicy === 'required') {
        alertPermissionBlocked('Notifications');
      }
      return outcome === 'granted';
    }
    return true;
  }
  const status = await requestPermission(getMessaging());
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

async function upload(token: string): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error !== null && __DEV__) {
    console.warn(`push: could not register token, ${error.message}`);
  }
}

/**
 * Register this device, and keep registering it.
 *
 * `onTokenRefresh` is not optional housekeeping: FCM rotates a token on app
 * restore, on some updates, and whenever it feels the old one is compromised. A
 * client that registers once and never again goes quietly silent weeks later,
 * which is indistinguishable from "nobody messaged me".
 *
 * Returns the unsubscribe so a sign-out can stop listening, otherwise the
 * refresh handler would re-register the *new* user's device against the old
 * session's client.
 */
export async function startPush(): Promise<() => void> {
  /*
   * Create the notification channel before asking for permission, not after.
   *
   * Android 8+ requires a channel for any notification, and this app declared
   * none at all — Firebase's SDK was falling back to a generic channel named
   * after the library, which is what a user would have found in Settings. Doing
   * it here means somebody who wants to silence messages before ever receiving
   * one has something to silence.
   */
  await ensureConversationChannel();

  const granted = await ensurePermission();
  if (!granted) {
    // A refusal is a legitimate answer and not an error state. The app works
    // without it; the person simply finds out when they open it.
    return () => undefined;
  }
  const token = await getToken(getMessaging());
  if (token !== '') {
    await upload(token);
  }
  return onTokenRefresh(getMessaging(), (next: string) => {
    void upload(next);
  });
}

/**
 * Drop this device's token on sign-out.
 *
 * The registration RPC already reassigns a token to whoever registers it last,
 * so a second account on the same phone cannot inherit the first one's pushes.
 * This is the other half: between signing out and anyone signing in, the row
 * should not exist at all. Deleting the FCM token as well forces a fresh one,
 * so the old value cannot be replayed.
 */
export async function stopPush(): Promise<void> {
  try {
    const token = await getToken(getMessaging());
    if (token !== '') {
      await supabase.from('push_tokens').delete().eq('token', token);
    }
    await deleteToken(getMessaging());
  } catch (err) {
    if (__DEV__) {
      console.warn(`push: could not revoke token, ${String(err)}`);
    }
  }
}

/**
 * The two foreground deliveries the app acts on.
 *
 * RNFirebase's receiver branches on `isAppInForeground` and, when it is, emits
 * to `onMessage` rather than starting the headless task index.js registers — so
 * without this listener a call push that arrives while the app is open is
 * dropped with no ring and no error.
 * https://rnfirebase.io/messaging/usage#foreground-state-messages
 *
 * A conversation message is deliberately not one of them: see the note above.
 */
export function onForegroundPush(handlers: {
  onCall: (push: CallPush) => void;
  onEngagement: (push: EngagementPush) => void;
}): () => void {
  return onMessage(getMessaging(), remote => {
    const call = readCallPush(remote.data);
    if (call !== null) {
      handlers.onCall(call);
      return;
    }
    const nudge = readEngagementPush(remote.data);
    if (nudge !== null) {
      handlers.onEngagement(nudge);
    }
  });
}

/*
 * THERE IS NO `getInitialNotification` / `onNotificationOpenedApp` PATH HERE,
 * DELIBERATELY (2026-09-17 audit; this replaces `openedPeerId`,
 * `onNotificationOpen` and `initialNotificationPeer`, which used to live in
 * this file and never once fired).
 *
 * Those two RNFirebase APIs track taps on a notification the SYSTEM rendered
 * from an FCM message's own `notification` block. This app's messages are
 * `setBackgroundMessageHandler`'s data-only, by design — see index.js's own
 * docblock: "A payload with a `notification` block is rendered by the system
 * and never reaches JavaScript, which also means it can never be a
 * conversation notification." Every notification a member or provider sees
 * is built by hand, on the native side
 * (android/app/src/main/java/com/companionchat/Conversations.kt), with its
 * own `PendingIntent` carrying a `companionchat://peer/<id>` deep link — not
 * an intent Firebase's SDK generated or is tracking. So `getInitialNotification`
 * always resolved null and `onNotificationOpenedApp` never fired, for every
 * message notification this app has ever sent.
 *
 * The real, working path for a tapped message notification is the SAME
 * `Linking.getInitialURL()` / `addEventListener('url', ...)` deep link App.tsx
 * already uses for the CALL-style notification's `companionchat://call/...`
 * link — `companionchat://peer/<id>` is parsed by the identical handler. See
 * `pendingPeer` in App.tsx for where the role-aware routing happens.
 */
