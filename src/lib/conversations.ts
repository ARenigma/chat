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
  ): Promise<boolean>;
  notifyEngagement(
    peerId: string,
    title: string,
    body: string,
    avatarUrl: string,
  ): Promise<boolean>;
  clear(conversationId: string): Promise<void>;
  ensureChannel(): Promise<void>;
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

/** Whether the native module is present. False under jest and in any build without it. */
export function conversationsAvailable(): boolean {
  return native !== undefined;
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
 * Post or extend a conversation notification.
 *
 * Resolves `false` rather than rejecting when the module is absent, so a caller
 * inside a background handler has nothing to catch.
 */
export async function notifyConversation(
  push: ConversationPush,
  body: string,
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
  );
}

/** Clear a conversation's notification once it has been read in the app. */
export async function clearConversation(conversationId: string): Promise<void> {
  if (native === undefined) {
    return;
  }
  await native.clear(conversationId);
}

/**
 * Create the notification channel up front.
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
