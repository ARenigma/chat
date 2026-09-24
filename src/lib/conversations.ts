import { NativeModules } from 'react-native';

/**
 * The bridge to Android's conversation notifications.
 *
 * Same shape and same reasoning as `src/lib/googleCredential.ts`: the native
 * side can only be exercised on a device with a notification shade, so this file
 * holds the call signature and the meaning of failure, and nothing else.
 *
 * See `android/app/src/main/java/com/companionchat/Conversations.kt` for why a
 * conversation notification needs a long-lived shortcut, a `Person` and a
 * `MessagingStyle` together, and what happens when one is missing.
 */

interface Native {
  notify(
    conversationId: string,
    peerId: string,
    senderName: string,
    body: string,
    sentAt: number,
    // The sender's public photo URL, or '' for none. Empty rather than nullable
    // because the bridge marshals a non-optional String; the native side treats
    // '' as "no icon" and builds the Person without one.
    avatarUrl: string,
    // Required at the bridge (one arity per method); the default is
    // `notifyConversation`'s, below. See `NotifyOptions`.
    inApp: boolean,
    silent: boolean,
  ): Promise<boolean>;
  notifyEngagement(
    peerId: string,
    title: string,
    body: string,
    avatarUrl: string,
  ): Promise<boolean>;
  notifyChatRequest(
    conversationId: string,
    peerId: string,
    senderName: string,
    requestId: string,
    sentAt: number,
    avatarUrl: string,
    inApp: boolean,
    silent: boolean,
  ): Promise<boolean>;
  notifyCall(
    callId: string,
    peerId: string,
    callerName: string,
    avatarUrl: string,
    medium: string,
  ): Promise<boolean>;
  clearCall(callId: string): Promise<void>;
  startCallForegroundService(
    peerName: string,
    isIncoming: boolean,
    includeMicrophone: boolean,
    includeCamera: boolean,
  ): void;
  stopCallForegroundService(): void;
  clear(conversationId: string): Promise<void>;
  ensureChannel(): Promise<void>;
  pushLog(warn: boolean, message: string): void;
}

const native = (NativeModules as { Conversations?: Native }).Conversations;

/**
 * What a data-only push carries.
 *
 * Every field arrives as a string: FCM's `data` map is `Map<String, String>` and
 * there is no other type available in it. `sentAt` is parsed here rather than
 * trusted, because a missing or malformed value would otherwise reach
 * `MessagingStyle` as `NaN` and sort the transcript into nonsense.
 */
export interface ConversationPush {
  readonly conversationId: string;
  readonly peerId: string;
  readonly senderName: string;
  readonly sentAt: number;
  // The sender's public photo, when the sender is a provider; null otherwise.
  // Rendered as the notification's Person icon — the SP-photo hero (#6).
  readonly avatarUrl: string | null;
  /**
   * The session_request id, present only on `kind: 'contact'` pushes (migration
   * 105). Carried so the native notification can build Accept/Decline actions
   * without an extra DB round-trip. Absent on plain message pushes and on
   * builds shipped before send-push was redeployed.
   */
  readonly requestId?: string;
}

/**
 * Read a push payload, or `null` if it is not one of ours.
 *
 * Returning null rather than throwing because this runs inside the FCM handler,
 * where a throw is an unhandled rejection nobody sees. A payload that does not
 * parse is a payload from an older server build, and the correct response is to
 * ignore it rather than to crash a background process.
 */
export function readConversationPush(
  data: Readonly<Record<string, string | object>> | undefined,
): ConversationPush | null {
  if (data === undefined) {
    return null;
  }
  const asString = (key: string): string =>
    typeof data[key] === 'string' ? (data[key] as string) : '';
  const conversationId = asString('conversationId');
  const peerId = asString('peerId');
  if (conversationId === '' || peerId === '') {
    return null;
  }
  const parsed = Number.parseInt(asString('sentAt'), 10);
  return {
    conversationId,
    peerId,
    senderName: asString('senderName') || 'Someone',
    // A malformed timestamp becomes "now" rather than NaN: an approximately
    // right ordering is worth more than a notification that refuses to build.
    sentAt: Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now(),
    // Absent for a member sender (no public photo) and for older server builds;
    // '' from `asString` becomes null so the native side skips the icon.
    avatarUrl: asString('senderAvatar') || null,
    // Present only on kind: 'contact' pushes (send-push redeploy from migration
    // 105). Absent on plain messages — the native layer checks for undefined.
    requestId: asString('requestId') || undefined,
  };
}

/**
 * What an engagement push carries — the second notification type. No
 * `conversationId` (there may be no conversation yet); it is a nudge to open a
 * provider, so `peerId` plus the copy is enough. `kind: 'engagement'` in the data
 * map is what routes a push here rather than to the message path.
 */
export interface EngagementPush {
  readonly peerId: string;
  readonly title: string;
  readonly body: string;
  readonly avatarUrl: string | null;
}

/** Read an engagement payload, or `null` if it is not one. */
export function readEngagementPush(
  data: Readonly<Record<string, string | object>> | undefined,
): EngagementPush | null {
  if (data === undefined || data.kind !== 'engagement') {
    return null;
  }
  const asString = (key: string): string =>
    typeof data[key] === 'string' ? (data[key] as string) : '';
  const peerId = asString('peerId');
  const title = asString('title');
  if (peerId === '' || title === '') {
    return null;
  }
  return {
    peerId,
    title,
    body: asString('body'),
    avatarUrl: asString('senderAvatar') || null,
  };
}

/**
 * What an incoming-call push carries — the third notification type. `kind: 'call'`
 * routes a push here; `callId` + the caller (`peerId`) are what the CallStyle
 * notification and the in-app answer/decline need.
 */
export interface CallPush {
  readonly callId: string;
  readonly peerId: string;
  readonly callerName: string;
  readonly medium: string;
  readonly mediaBackend: 'current' | 'livekit' | 'agora';
  readonly mediaExperimentId: string | null;
  readonly avatarUrl: string | null;
}

/** Read an incoming-call payload, or `null` if it is not one. */
export function readCallPush(
  data: Readonly<Record<string, string | object>> | undefined,
): CallPush | null {
  if (data === undefined || data.kind !== 'call') {
    return null;
  }
  const asString = (key: string): string =>
    typeof data[key] === 'string' ? (data[key] as string) : '';
  const callId = asString('callId');
  const peerId = asString('peerId');
  const rawMediaBackend = asString('mediaBackend');
  const mediaBackend = ['current', 'livekit', 'agora'].includes(rawMediaBackend)
    ? rawMediaBackend
    : 'current';
  if (callId === '' || peerId === '') {
    return null;
  }
  return {
    callId,
    peerId,
    callerName: asString('senderName') || 'Someone',
    medium: asString('medium') || 'voice',
    mediaBackend: mediaBackend as CallPush['mediaBackend'],
    mediaExperimentId: asString('mediaExperimentId') || null,
    avatarUrl: asString('senderAvatar') || null,
  };
}

/** Whether the native module is present. False under jest and in any build without it. */
export function conversationsAvailable(): boolean {
  return native !== undefined;
}

/** Ring an incoming call (CallStyle). Resolves `false` when the module is absent. */
export async function notifyCall(push: CallPush): Promise<boolean> {
  if (native === undefined) {
    return false;
  }
  return native.notifyCall(push.callId, push.peerId, push.callerName, push.avatarUrl ?? '', push.medium);
}

/** Clear a call notification once it is answered, declined or gone. */
export async function clearCall(callId: string): Promise<void> {
  if (native === undefined) {
    return;
  }
  await native.clearCall(callId);
}

/**
 * Start the Android phone-call foreground service from the user-initiated call
 * flow. Android requires the service to be promoted within five seconds.
 * https://developer.android.com/develop/background-work/services/fgs/launch
 *
 * `isIncoming` picks the CallStyle: `forIncomingCall` (Decline | Answer) only
 * when the phone is actually ringing, `forOngoingCall` (Hang up) otherwise.
 * https://developer.android.com/develop/ui/views/notifications/call-style
 * Passing it wrongly is not cosmetic — an outgoing call rendered as incoming
 * puts a full "Incoming call / Decline / Answer" heads-up over the caller's own
 * call screen, offering to answer a call they are placing.
 */
export function startCallForegroundService(
  peerName: string,
  isIncoming: boolean,
  includeMicrophone = false,
  includeCamera = false,
): void {
  native?.startCallForegroundService(
    peerName,
    isIncoming,
    includeMicrophone,
    includeCamera,
  );
}

/** Stop the call foreground service when the server call/session ends. */
export function stopCallForegroundService(): void {
  native?.stopCallForegroundService();
}

/** Post an engagement nudge (BigPicture). Resolves `false` when the module is absent. */
export async function notifyEngagement(push: EngagementPush): Promise<boolean> {
  if (native === undefined) {
    return false;
  }
  return native.notifyEngagement(
    push.peerId,
    push.title,
    push.body,
    push.avatarUrl ?? '',
  );
}

/**
 * How a conversation notification is posted.
 *
 * `inApp` is the foreground post (`onForegroundPush` in push.ts): the same
 * notification, id and cumulative transcript, posted on the in-app channel,
 * which shows it in the shade and as a heads-up banner with no sound, because
 * the person is using the app. Absent means `false`, which is what every
 * caller that predates it (the background handler in index.js) gets without
 * changing a line. See `Conversations.route` for the channel it picks and why
 * it is a channel rather than a per-post flag.
 *
 * `silent` is the one foreground post that must not peek: a push for the
 * conversation whose chat request is ringing full screen in the app
 * (`foregroundPushAction`). Same channel as `inApp`, posted with
 * NotificationCompat's setSilent, so it goes into the shade with no banner over
 * the ring and no sound, and is there to answer from if the provider leaves
 * before the ring is answered. Only meaningful with `inApp`; absent means
 * `false`. See `Route.silencedIf` in Conversations.kt.
 */
export interface NotifyOptions {
  readonly inApp?: boolean;
  readonly silent?: boolean;
}

/**
 * Post or extend a conversation notification.
 *
 * Resolves `false` rather than rejecting when the module is absent, so a caller
 * inside a background handler has nothing to catch.
 */
export async function notifyConversation(
  push: ConversationPush,
  body: string,
  options: NotifyOptions = {},
): Promise<boolean> {
  if (native === undefined) {
    return false;
  }
  return native.notify(
    push.conversationId,
    push.peerId,
    push.senderName,
    body,
    push.sentAt,
    push.avatarUrl ?? '',
    options.inApp === true,
    options.silent === true,
  );
}

/**
 * Post a chat-request notification with Accept/Decline action buttons.
 *
 * Used for `kind: 'contact'` pushes — a provider-initiated chat request that
 * the member needs to accept or decline. The lock-screen notification stays in
 * the conversations channel (MessagingStyle) per Android guidance; CallStyle is
 * reserved for telephony. The Accept action navigates to the conversation; the
 * Decline action fires a BroadcastReceiver that declines without opening the UI.
 * https://developer.android.com/develop/ui/views/notifications/conversations
 */
export async function notifyChatRequest(
  push: ConversationPush,
  options: NotifyOptions = {},
): Promise<boolean> {
  if (native === undefined || !push.requestId) {
    // Fallback to a plain conversation notification when the bridge is absent or
    // when requestId is missing (older server build before send-push redeploy).
    // The options ride along: a foreground fallback goes on the same in-app
    // channel as the request it stands in for.
    return notifyConversation(push, 'wants to have a chat with you', options);
  }
  return native.notifyChatRequest(
    push.conversationId,
    push.peerId,
    push.senderName,
    push.requestId,
    push.sentAt,
    push.avatarUrl ?? '',
    options.inApp === true,
    options.silent === true,
  );
}

/**
 * Clear a conversation's notification once it has been read in the app. Called
 * by `useViewingConversation` whenever that conversation is on screen, and by
 * `ChatRingScreen` once the server has taken the provider's decline of a
 * ringing request, or when they watch it ring out.
 */
export async function clearConversation(conversationId: string): Promise<void> {
  if (native === undefined) {
    return;
  }
  await native.clear(conversationId);
}

/**
 * Create the conversation channels up front: Messages and the in-app one.
 *
 * Called at startup rather than lazily on the first push, so somebody who wants
 * to silence messages before ever receiving one finds the channel in Settings.
 */
export async function ensureConversationChannel(): Promise<void> {
  if (native === undefined) {
    return;
  }
  await native.ensureChannel();
}

/**
 * One line of push diagnostics to logcat under the `PappalPush` tag, in every
 * build including release (`adb logcat -s PappalPush`).
 *
 * The message is the caller's and must never contain the FCM token — see
 * `ConversationsModule.pushLog` for why. A warning is also mirrored to the JS
 * console in `__DEV__`, which is where push.ts's failures used to be the only
 * trace; a no-op under jest and anywhere else the module is absent.
 */
export function pushLog(level: 'info' | 'warn', message: string): void {
  if (__DEV__ && level === 'warn') {
    console.warn(`PappalPush ${message}`);
  }
  native?.pushLog(level === 'warn', message);
}
