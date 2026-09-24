import {
  AppState,
  PermissionsAndroid,
  Platform,
  type AppStateStatus,
} from 'react-native';
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
  notifyChatRequest,
  notifyConversation,
  pushLog,
  readCallPush,
  readConversationPush,
  readEngagementPush,
  type CallPush,
  type EngagementPush,
  type NotifyOptions,
} from './conversations';
import {
  foregroundPushAction,
  getRingingConversation,
  getViewingConversation,
} from './viewingConversation';

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
 * Three deliberate choices:
 *
 *   1. **A foreground message is drawn only when it is not already on
 *      screen, as a banner, and never with sound.** A foreground delivery goes to
 *      `onMessage` INSTEAD of the background handler, never to both, so
 *      whatever it does is the whole of what the user gets.
 *      https://rnfirebase.io/messaging/usage#foreground-state-messages
 *      It used to do NOTHING for a message, on the reasoning that Realtime had
 *      already put it on screen — true for the conversation being read, false
 *      for everybody on Home, in Settings or in a different chat, who got no
 *      sign at all. Delivery was never the problem (2026-09-25: 29 of the
 *      last 33 messages were pushed, and three of the other four had been read
 *      within a second); a push that reached an open app was simply dropped
 *      here. The rule now is Bluesky's: post the conversation notification
 *      unless its conversation is the one on screen (`viewingConversation.ts`),
 *      in the shade and as a heads-up banner with no sound, because the person
 *      is already using the phone. The banner-without-sound is a channel of its
 *      own on Android (`CHANNEL_IN_APP` in Conversations.kt), since a per-post
 *      "silent" flag also stops the peek.
 *      A CALL and an engagement nudge are unchanged, and they are not cosmetic
 *      exceptions — if the Realtime socket is down (a network flap, a Doze
 *      wake, a token refresh) the push is the only ring there will be, and
 *      `announce_chat_open` gates on a MANUAL presence declaration, so it
 *      reaches somebody who is actively using the app. Both are routed into
 *      the app's own UI rather than drawn.
 *   2. **The body is never in the payload.** The sender publishes who it is from
 *      and nothing else, see `pending_pushes`. A lock screen that quotes the
 *      message tells whoever is holding the phone what you talked about, and for
 *      this product that is the wrong default at any convenience.
 *   3. **No notification library.** Every notification this app shows, in the
 *      foreground or not, is built by `Conversations.kt`, because a
 *      conversation notification (shortcut + Person + MessagingStyle) is not
 *      something a generic display library assembles.
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

/**
 * How long the app must stay active before a return re-registers.
 *
 * Android pauses the activity for every system surface drawn over it — the
 * permission dialog, the Credential Manager sheet, the share sheet — and each
 * pause is a `background` → `active` pair in AppState. A return that does not
 * outlast this is one of those, not the person coming back.
 */
export const ACTIVE_SETTLE_MS = 1_500;

/**
 * The least time between a successful registration and an AppState-driven
 * one. A person flicking between two apps is not a reason to call the RPC on
 * every switch; `last_seen_at` is read in months, not seconds.
 */
export const ACTIVE_MIN_INTERVAL_MS = 60_000;

/** Why a registration ran, for the log line and nothing else. */
type RegisterReason = 'start' | 'refresh' | 'active';

/** When this process last registered successfully; 0 for never. */
let lastRegisteredAt = 0;

/**
 * Bumped by every teardown and every start. Work that began under one value —
 * a registration waiting on FCM, a `startPush` waiting on the channel or the
 * permission dialog — carries THAT value to every later check, so a sign-out
 * in the middle cannot re-create the row `stopPush` is deleting, or install
 * listeners for a session that has already ended.
 *
 * Carried, not re-read. A step that reads `generation` when it starts, after
 * an await, adopts whatever a sign-out left there and passes its own check:
 * that is how a `stopPush` during the permission dialog used to be followed
 * by a `register_push_token` for the session it had just ended.
 */
let generation = 0;
/** The last `stopPush` teardown; `startPush` waits for it. Never rejects. */
let teardown: Promise<void> = Promise.resolve();

/** Tears down whichever listeners `listen` installed last. */
let stopListening: () => void = () => undefined;

/** Stop everything this module is doing for the current session. */
function halt(): void {
  generation += 1;
  stopListening();
  stopListening = () => undefined;
}

/**
 * Every `register_push_token` call still on the wire.
 *
 * The generation checks stop a registration from STARTING after a sign-out,
 * and cannot stop one that already left: a return-to-app register whose RPC
 * was sent a moment before `stopPush` is answered whenever the server gets to
 * it, and if that is after `stopPush`'s row delete, the row is back, for the
 * user who just signed out. So `stopPush` waits for these before it deletes
 * (`drainRegistrations`). Settled-only promises, never rejecting, so the wait
 * cannot throw.
 */
const inFlight = new Set<Promise<void>>();

/**
 * The longest `stopPush` waits for a registration on the wire before deleting
 * the row anyway.
 *
 * A bound because the RPC has no timeout of its own and a sign-out must not
 * hang on a dead network. Past it the order is no longer guaranteed, and the
 * cost is bounded by what `stopPush` does next: `deleteToken` revokes the FCM
 * token that a late row would carry, and `send-push` forgets a token FCM
 * answers UNREGISTERED for (see `listen`).
 *
 * Whether the wait is seen depends on the caller. Sign-out runs this in the
 * background after the signed-in UI has already gone (`onSignOutPress` in
 * SettingsSheet.tsx), so it is not on screen. Account deletion awaits it on
 * screen, behind the confirm sheet's spinner (`onDelete`), for up to this
 * long, and there the drain protects nothing: push_tokens.user_id cascades
 * from auth.users (migration 008), so a registration answered after the
 * deletion fails its foreign key and one answered before it goes with the
 * cascade. The wait happens only while an RPC is actually on the wire, which
 * is normally one round trip.
 */
export const STOP_DRAIN_MS = 3_000;

/** `work`, recorded in `inFlight` until it settles either way. */
function inFlightUntilSettled<T>(work: Promise<T>): Promise<T> {
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  inFlight.add(settled);
  void settled.then(() => inFlight.delete(settled));
  return work;
}

/** Wait, up to `ms`, for every registration already on the wire to land. */
async function drainRegistrations(ms: number): Promise<void> {
  if (inFlight.size === 0) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const landed = await Promise.race([
    Promise.all([...inFlight]).then(() => true),
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]);
  clearTimeout(timer);
  if (!landed) {
    pushLog('warn', `stop: a registration was still in flight after ${ms}ms, deleting anyway`);
  }
}

/** Bounded, token-free text for a log line. */
function detail(text: string, token: string): string {
  const clean = token === '' ? text : text.split(token).join('[redacted]');
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
}

/**
 * Upload this device's token, and say what happened in logcat.
 *
 * The outcome goes to `pushLog` (tag `PappalPush`) in EVERY build. It used to
 * be a `__DEV__`-only warning, so a device with no row in `push_tokens` had
 * nothing in a release build to say why. The token itself is never logged: it
 * is a capability to push onto this lock screen (migration 008), and `detail`
 * strips it from anything the server echoes back.
 *
 * `gen` is the generation the caller started under (see `generation`). It is
 * checked before `getToken`, which after `stopPush`'s `deleteToken` would mint
 * a token nobody should hold, and again before the RPC, since FCM can take
 * seconds to answer. An RPC that got past both is in `inFlight` until it is
 * answered, and `stopPush` waits for it.
 */
async function register(
  reason: RegisterReason,
  gen: number,
  fresh?: string,
): Promise<boolean> {
  if (gen !== generation) {
    pushLog('info', `register ${reason}: dropped, push stopped meanwhile`);
    return false;
  }
  let token = fresh ?? '';
  if (token === '') {
    try {
      token = await getToken(getMessaging());
    } catch (err) {
      pushLog('warn', `register ${reason}: FCM gave nothing, ${detail(String(err), '')}`);
      return false;
    }
  }
  if (token === '') {
    pushLog('warn', `register ${reason}: FCM gave nothing`);
    return false;
  }
  if (gen !== generation) {
    pushLog('info', `register ${reason}: dropped, push stopped meanwhile`);
    return false;
  }
  // Recorded in the same synchronous step as the check above, so a stopPush
  // either moved the generation first (and nothing is sent) or finds this in
  // `inFlight` and waits for it. Promise.resolve turns the query builder into
  // ONE promise: the builder is a thenable that sends a fresh request every
  // time `then` is called on it, and this await and the drain would each call
  // it.
  const { error } = await inFlightUntilSettled(
    Promise.resolve(
      supabase.rpc('register_push_token', {
        p_token: token,
        p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    ),
  );
  if (error !== null) {
    const why = `${error.code || 'no code'} ${detail(error.message, token)}`;
    pushLog('warn', `register ${reason}: failed, ${why}`);
    return false;
  }
  lastRegisteredAt = Date.now();
  pushLog('info', `register ${reason}: ok`);
  return true;
}

/**
 * `register`, unless notifications are not granted.
 *
 * A CHECK, never a request: this runs from a listener, and a permission dialog
 * appearing because the app came back to the foreground is exactly the ambush
 * ADR-0026 exists to prevent. The request belongs to `startPush`. A token
 * without the permission is a token that will never ring, so it is not sent —
 * and a person who turns notifications on in Settings is registered on the
 * return from Settings, which is the case the old boot-only upload missed.
 *
 * The generation is taken before the check, not after, so a teardown during
 * the check is seen by `register`.
 */
async function registerIfGranted(
  reason: RegisterReason,
  fresh?: string,
): Promise<boolean> {
  const gen = generation;
  if (!(await notificationsGranted())) {
    pushLog('info', `register ${reason}: skipped, notifications not granted`);
    return false;
  }
  return register(reason, gen, fresh);
}

/**
 * The listeners that keep a registration alive for the length of a session.
 *
 *   - `onTokenRefresh` is not optional housekeeping: FCM rotates a token on
 *     app restore, on some updates, and whenever it feels the old one is
 *     compromised. A client that registers once and never again goes quietly
 *     silent weeks later, which is indistinguishable from "nobody messaged me".
 *   - AppState `active` re-registers on every return to the app, debounced
 *     (`ACTIVE_SETTLE_MS`, `ACTIVE_MIN_INTERVAL_MS`). A boot-only upload meant
 *     one failed boot — offline, FCM's SERVICE_NOT_AVAILABLE, an RPC error —
 *     left the device unregistered until the next cold start, and a row
 *     `send-push` dropped (it forgets tokens FCM calls UNREGISTERED or
 *     SENDER_ID_MISMATCH) or that another account on the same phone took over
 *     stayed gone for as long as the app was merely backgrounded. Bluesky
 *     re-registers on every account activation for the same reason
 *     (social-app src/lib/notifications/notifications.ts). Each run also bumps
 *     `last_seen_at`, which is what lets the sender prune dead devices.
 *
 * Only `startPush` installs them, after `halt` and a generation check, so at
 * most one set is ever live.
 */
function listen(): () => void {
  let live = true;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const unsubscribeRefresh = onTokenRefresh(getMessaging(), (next: string) => {
    void registerIfGranted('refresh', next);
  });

  const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') {
      // Left again before the settle ran: that return was a system surface
      // passing over the app, not the person coming back.
      if (settle !== undefined) {
        clearTimeout(settle);
        settle = undefined;
      }
      return;
    }
    if (settle !== undefined) {
      return;
    }
    settle = setTimeout(() => {
      settle = undefined;
      if (!live) {
        return;
      }
      const since = Date.now() - lastRegisteredAt;
      if (since < ACTIVE_MIN_INTERVAL_MS) {
        pushLog('info', `register active: skipped, last ok ${Math.round(since / 1000)}s ago`);
        return;
      }
      void registerIfGranted('active');
    }, ACTIVE_SETTLE_MS);
  });

  const stop = (): void => {
    if (!live) {
      return;
    }
    live = false;
    generation += 1;
    if (settle !== undefined) {
      clearTimeout(settle);
      settle = undefined;
    }
    appState.remove();
    unsubscribeRefresh();
  };
  stopListening = stop;
  return stop;
}

/**
 * Register this device, and keep registering it (see `listen`).
 *
 * Returns the unsubscribe so a sign-out can stop listening, otherwise the
 * refresh handler would re-register the *new* user's device against the old
 * session's client. `stopPush` also stops them, so a sign-out cannot leave
 * them running even when App.tsx's cleanup ran before this resolved.
 *
 * Runs for BOTH trees: App.tsx calls it from the `boot.phase === 'ready'`
 * effect in Root, and `SignedIn` — which picks the member or the provider
 * tree by role — only ever renders in that phase.
 */
export async function startPush(): Promise<() => void> {
  // A second start replaces the first rather than stacking listeners on it.
  // Before the first await, so a `stopPush` during ANY of the waits below
  // moves the generation away from `started` and is seen by every check.
  halt();
  const started = generation;

  /*
   * Wait out a sign-out teardown still in flight before registering anything.
   *
   * Sign-out puts the sign-in screen up at once and tears push down behind it
   * (SettingsSheet's `onSignOutPress`), and that teardown can take up to
   * STOP_DRAIN_MS plus two network calls. Somebody who signs straight back in
   * would otherwise register a fresh row that the old teardown then deletes,
   * and have the token itself revoked by its `deleteToken` — a signed-in
   * device with no push and nothing to say so.
   */
  await teardown;

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
  if (started !== generation) {
    // Signed out while the channel was created: no permission dialog for a
    // session that has already ended.
    return () => undefined;
  }

  const granted = await ensurePermission();
  if (granted) {
    await register('start', started);
  } else {
    // A refusal is a legitimate answer and not an error state. The app works
    // without it; the person simply finds out when they open it. The
    // listeners still go in, so turning notifications on in Settings later is
    // picked up on the way back rather than at the next cold start.
    pushLog('info', 'register start: skipped, notifications not granted');
  }
  if (started !== generation) {
    // Signed out, or started again, while this one waited on the dialog or
    // the RPC. Whoever moved the generation owns what happens next; App.tsx
    // may already have run its cleanup, so this must not leave listeners.
    return () => undefined;
  }
  return listen();
}

/**
 * Drop this device's token on sign-out.
 *
 * The registration RPC already reassigns a token to whoever registers it last,
 * so a second account on the same phone cannot inherit the first one's pushes.
 * This is the other half: between signing out and anyone signing in, the row
 * should not exist at all. Deleting the FCM token as well forces a fresh one,
 * so the old value cannot be replayed.
 *
 * Order-safe against a registration already on the wire: `halt` stops any
 * from starting, and the delete waits for the ones that started before it
 * (`drainRegistrations`, bounded by `STOP_DRAIN_MS`), so a late
 * `register_push_token` cannot land after the delete and recreate the row.
 *
 * Not safe against a sign-in that lands while it is still running, and the
 * drain makes that window longer whenever a registration is on the wire.
 * `onSignOutPress` leaves the signed-in UI at once and runs `stopPush()` then
 * `signOut()` behind it. A new sign-in in that time replaces the one Supabase
 * session, so this row delete and `deleteToken` remove the row and the token
 * the NEW user just registered from this phone, and the caller's `signOut()`
 * then ends the new session. A
 * generation check here alone does not fix it: it would skip the delete and
 * the revoke while the caller still signs the new user out, leaving a live
 * row and token for somebody signed out, the state this function exists to
 * prevent. The fix belongs to the sign-out chain in SettingsSheet.tsx, which
 * would have to know that no newer session has started before it tears down.
 */
export function stopPush(): Promise<void> {
  // First, so nothing re-registers the row this is about to delete.
  halt();
  const run = revoke();
  // `startPush` awaits this; it must never reject into a sign-in.
  teardown = run.catch(() => undefined);
  return run;
}

async function revoke(): Promise<void> {
  try {
    await drainRegistrations(STOP_DRAIN_MS);
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
 * The line a conversation notification shows for a message. The SAME string
 * index.js's background handler passes, because a foreground post and a
 * background post land on the same notification and extend one transcript;
 * `__tests__/pushForeground.test.ts` holds the two together.
 */
const MESSAGE_BODY = 'wants to have a chat with you';

/**
 * Every foreground delivery.
 *
 * RNFirebase's receiver branches on `isAppInForeground` and, when it is, emits
 * to `onMessage` rather than starting the headless task index.js registers — so
 * without this listener a push that arrives while the app is open is dropped
 * with no ring, no notification and no error.
 * https://rnfirebase.io/messaging/usage#foreground-state-messages
 *
 * Calls and nudges go to the app's own UI through `handlers`. A conversation
 * or contact push goes to the same native notification the background handler
 * posts, decided by `foregroundPushAction`: nothing for the conversation on
 * screen, a silent shade entry (no banner, no sound) for the one whose chat
 * request is ringing in the app, the in-app banner with no sound for any other
 * while the app is in use, alerting if AppState says it is not. The kinds are
 * read in index.js's order, so a push is never two things at once.
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
      return;
    }
    const push = readConversationPush(remote.data);
    if (push === null) {
      return;
    }
    const action = foregroundPushAction(
      push,
      getViewingConversation(),
      AppState.currentState === 'active',
      getRingingConversation(),
    );
    pushLog('info', `foreground ${push.requestId ? 'contact' : 'message'}: ${action}`);
    if (action === 'ignore') {
      return;
    }
    // A ringing request's push is an in-app post too, on the same channel,
    // only silenced: in the shade, no banner over the ring.
    const options: NotifyOptions = {
      inApp: action === 'show-in-app' || action === 'show-silent',
      silent: action === 'show-silent',
    };
    // Same routing as index.js: a requestId is a provider's chat request and
    // gets Accept/Decline; anything else extends the conversation transcript.
    void (push.requestId
      ? notifyChatRequest(push, options)
      : notifyConversation(push, MESSAGE_BODY, options));
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
