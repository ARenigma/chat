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
  };
}

/** Whether the native module is present. False under jest and in any build without it. */
export function conversationsAvailable(): boolean {
  return native !== undefined;
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
