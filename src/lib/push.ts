import { PermissionsAndroid, Platform } from 'react-native';
import { alertPermissionBlocked, requestAndroidPermission } from './permissions';
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { supabase } from './supabase';
import { ensureConversationChannel } from './conversations';
import { isUuid } from './ids';

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
 *   1. **Nothing is displayed while the app is foregrounded.** `onMessage` fires
 *      only in the foreground and does not draw anything unless we ask it to, so
 *      not asking is the whole implementation: Realtime has already put the
 *      message on screen, and a banner over the conversation you are reading is
 *      noise. Background and quit-state notifications are drawn by the OS from
 *      the `notification` block the sender includes.
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
 * Default is 'required' so the blocking alert is shown unless a caller
 * explicitly sets it to 'optional' (internal/testing builds). Set this via
 * `setNotificationPolicy()` before calling `startPush()`.
 */
let _notificationPolicy: 'optional' | 'required' = 'required';

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
 * Who a notification wants to open, if the app was launched or resumed by
 * tapping one.
 *
 * The payload carries `peerId`, not a conversation id, because that is what the
 * app navigates by, routing on the conversation would mean looking the peer up
 * before the first frame, and the sender already knows both. A raw `data` field
 * rather than a deep link: the payload is ours end to end, and a URL would mean
 * parsing an untrusted string into a route.
 *
 * Validated as a uuid regardless. A push payload is remote input, and remote
 * input is exactly what should not reach a query unchecked, the same reasoning
 * that put `isUuid` in front of the stored last-conversation id.
 */
export function openedPeerId(
  remote: { data?: Record<string, string | object> } | null,
): string | null {
  const raw = remote?.data?.peerId;
  return typeof raw === 'string' && isUuid(raw) ? raw : null;
}

/** Fires when a notification is tapped while the app is backgrounded. */
export function onNotificationOpen(handler: (peerId: string) => void): () => void {
  return onNotificationOpenedApp(getMessaging(), remote => {
    const id = openedPeerId(remote);
    if (id !== null) {
      handler(id);
    }
  });
}

/** The notification that launched a cold start, if there was one. */
export async function initialNotificationPeer(): Promise<string | null> {
  const remote = await getInitialNotification(getMessaging());
  return openedPeerId(remote);
}
