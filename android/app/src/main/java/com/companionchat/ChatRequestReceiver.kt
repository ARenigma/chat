package com.companionchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives the Decline action from a chat-request notification button and
 * forwards it to React Native as a device event so App.tsx can call
 * `decline_session_request` without ever opening the app UI.
 *
 * The shade entry is cancelled through `Conversations.clear` (same id, same
 * lock as every post) rather than leaving a stale "wants to chat" card.
 *
 * https://developer.android.com/develop/ui/views/notifications/build-notification#Actions
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

        // Dismiss the notification so the lock screen is clean. Through
        // Conversations.clear, not a bare cancel: clear takes the post lock,
        // so a photo fill already in flight cannot post the declined request
        // back into the shade after this.
        if (conversationId.isNotEmpty()) Conversations.clear(context, conversationId)

        // Tell JS to call decline_session_request. The event carries
        // "<requestId>|<conversationId>" so App.tsx can issue the RPC and
        // invalidate the right query cache key without a separate fetch.
        ReactBridgeEvents.emit(context, "chatRequestDecline", "$requestId|$conversationId")
    }
}
