package com.companionchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * Receives the Decline action from a chat-request notification button and
 * hands it to JavaScript as a headless task, so `decline_session_request` runs
 * without ever opening the app UI.
 *
 * A headless task, not a device event. This used to emit "chatRequestDecline"
 * to a listener inside the signed-in React tree, and `ReactBridgeEvents.emit`
 * does nothing when no React context exists. The person who gets these buttons
 * is a member (only `contact` pushes carry a request id), usually with the app
 * swiped away: the background FCM handler posts the notification from a
 * headless context that mounts no tree, so there was nobody to hear the
 * event and the Decline was dropped. A HeadlessJsTaskService starts React
 * when it is not running and runs the task registered in index.js either way
 * (`allowedInForeground`, in ChatRequestDeclineService).
 * https://reactnative.dev/docs/headless-js-android
 *
 * Nothing is cleared here. It used to cancel the shade entry BEFORE the RPC
 * was even handed off, so a Decline that never reached the server (dropped as
 * above, offline, refused) still took away the notification: the request
 * stayed pending with nothing left on the lock screen to answer it from. The
 * task clears it, through `Conversations.clearRequest`, only after the server
 * took the Decline and only while the entry is still this request
 * (`declineFromNotification` in src/lib/chatRequestDecline.ts).
 * https://developer.android.com/develop/ui/views/notifications/build-notification#Actions
 *
 * Starting a plain service from here is allowed in the background: "Executing
 * a PendingIntent from a notification" puts the app on the temporary
 * allowlist, during which it "can launch services without limitation". The
 * wake lock is the headless-JS docs' own instruction for a service started
 * from a BroadcastReceiver, taken before returning from `onReceive`.
 * https://developer.android.com/about/versions/oreo/background#services
 */
class ChatRequestReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_DECLINE = "com.companionchat.ACTION_DECLINE_CHAT_REQUEST"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_CONVERSATION_ID = "conversation_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_DECLINE) return
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID) ?: ""

        val task = Intent(context, ChatRequestDeclineService::class.java)
            .putExtra(EXTRA_REQUEST_ID, requestId)
            .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        try {
            context.startService(task)
            HeadlessJsTaskService.acquireWakeLockNow(context)
        } catch (refused: IllegalStateException) {
            // The system would not start the service. The notification is still
            // up, so the request can be answered from it again or from the
            // thread; nothing claims the Decline happened.
            Log.w(ConversationsModule.PUSH_LOG_TAG, "decline from notification: could not start the task")
        }
    }
}
