package com.companionchat

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the lock-screen Decline in JavaScript whether or not the app is open:
 * the "ChatRequestDecline" task registered in index.js, which calls
 * `decline_session_request` and clears the notification only once it has
 * succeeded. Started by ChatRequestReceiver; see there for why a task and not
 * an event.
 *
 * `allowedInForeground`, because the app being open is a normal case (a
 * member who pulls the shade down over the app and taps Decline), and by
 * default a task started while the app is in the foreground crashes it.
 * https://reactnative.dev/docs/headless-js-android
 */
class ChatRequestDeclineService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val requestId = intent?.getStringExtra(ChatRequestReceiver.EXTRA_REQUEST_ID) ?: return null
        val conversationId = intent.getStringExtra(ChatRequestReceiver.EXTRA_CONVERSATION_ID) ?: ""
        val data = Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("conversationId", conversationId)
        }
        return HeadlessJsTaskConfig(TASK, data, TIMEOUT_MS, true)
    }

    companion object {
        /** The name index.js registers the task under. */
        const val TASK = "ChatRequestDecline"

        /**
         * Past the RPC's own 30 s ceiling (REQUEST_TIMEOUT_MS in
         * src/lib/supabase.ts), so the task ends by its own answer rather than
         * being cut off in the middle of one.
         */
        private const val TIMEOUT_MS = 45_000L
    }
}
