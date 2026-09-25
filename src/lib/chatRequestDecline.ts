import { DeviceEventEmitter } from 'react-native';
import { supabase } from './supabase';
import { clearChatRequest, pushLog } from './conversations';

/**
 * The lock-screen Decline on a chat-request notification, run as the headless
 * task "ChatRequestDecline" (index.js; started by ChatRequestDeclineService).
 *
 * A task rather than a listener in the signed-in tree, because the person who
 * taps it is usually a member with the app swiped away, where no tree is
 * mounted and an event had nobody to hear it (see ChatRequestReceiver.kt). The
 * persisted Supabase session is read from storage here as anywhere else.
 *
 * The notification leaves the shade only once the server has taken the
 * Decline. Cleared first, as the receiver used to do it, a Decline that never
 * landed took the only lock-screen way to answer the request with it while
 * the request stayed pending. On a failure it stays, so the person can press
 * Decline again or open the thread; `decline_session_request` reports a
 * request already gone or answered in its result, not as an error (082), so
 * an error here really is one that never landed.
 * https://developer.android.com/develop/ui/views/notifications/build-notification#Actions
 *
 * Emits "chatRequestDeclined" afterwards so a signed-in tree that is mounted
 * refetches what the Decline changed; with none mounted, nobody listens and
 * the next launch reads it fresh.
 */
export async function declineFromNotification(data: {
  readonly requestId?: string;
  readonly conversationId?: string;
}): Promise<void> {
  const requestId = data.requestId ?? '';
  const conversationId = data.conversationId ?? '';
  if (requestId === '') {
    return;
  }
  let failure: string | null = null;
  try {
    const { error } = await supabase.rpc('decline_session_request', {
      p_request_id: requestId,
    });
    if (error) {
      failure = error.code || 'no code';
    }
  } catch (err) {
    failure = String(err).slice(0, 200);
  }
  if (failure !== null) {
    pushLog('warn', `decline from notification: failed, ${failure}`);
    return;
  }
  pushLog('info', 'decline from notification: ok');
  if (conversationId !== '') {
    // Only while the entry is still this request: a message posted in the
    // cold start and round trip this took replaced it, and alerted, and is
    // not what the Decline answered (`Conversations.clearRequest`).
    await clearChatRequest(conversationId, requestId);
  }
  DeviceEventEmitter.emit('chatRequestDeclined', conversationId);
}
