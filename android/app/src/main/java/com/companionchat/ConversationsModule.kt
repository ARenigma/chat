package com.companionchat

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The bridge over `Conversations`, and nothing else.
 *
 * Thin on purpose, like `InAppUpdateModule`: everything here needs a real device
 * with a notification shade to exercise, so the only code in this file is the
 * part that has to cross the bridge. The decisions live in `Conversations.kt`.
 *
 * Called from `src/lib/conversations.ts`, which is in turn called from the FCM
 * background handler. The payload is data-only precisely so that JavaScript gets
 * a chance to run and reach this.
 */
class ConversationsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Post or extend a conversation notification.
     *
     * Resolves rather than rejects on failure. A push arriving is not a moment to
     * surface an error to anybody: the app is usually in the background with no
     * one looking, and a rejected promise inside a headless FCM handler is an
     * unhandled rejection rather than a message anyone reads.
     *
     * `inApp` is required here, not defaulted: a bridge method has one arity,
     * and the default lives in the JS wrapper (`notifyConversation` in
     * src/lib/conversations.ts) so every existing caller keeps its behaviour
     * without passing anything. Only the foreground path passes `true`, which
     * posts on the in-app channel (see `Conversations.CHANNEL_IN_APP`).
     * `silent` is required for the same reason, and only the foreground post
     * for a request ringing in the app passes `true`: in the shade, no banner
     * (see `Conversations.Route.silencedIf`).
     */
    @ReactMethod
    fun notify(
        conversationId: String,
        peerId: String,
        senderName: String,
        body: String,
        sentAt: Double,
        avatarUrl: String,
        inApp: Boolean,
        silent: Boolean,
        recipientId: String,
        promise: Promise,
    ) {
        try {
            Conversations.notify(
                reactContext,
                conversationId = conversationId,
                peerId = peerId,
                senderName = senderName,
                body = body,
                sentAt = sentAt.toLong(),
                // '' means "no photo": a member sender, or an older server build.
                avatarUrl = avatarUrl.ifEmpty { null },
                inApp = inApp,
                silent = silent,
                // '' means the sender named no account (before migration 143).
                recipientId = recipientId.ifEmpty { null },
            )
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Post an engagement nudge — the BigPicture re-engagement notification, the
     * second notification type. Resolves rather than rejects on failure, same as
     * `notify`, because it runs inside the headless FCM handler.
     */
    @ReactMethod
    fun notifyEngagement(
        peerId: String,
        title: String,
        body: String,
        avatarUrl: String,
        promise: Promise,
    ) {
        try {
            Conversations.notifyEngagement(
                reactContext,
                peerId = peerId,
                title = title,
                body = body,
                avatarUrl = avatarUrl.ifEmpty { null },
            )
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Ring an incoming call from the push — the PRE-notification, in the reference app's
     * sense: the CallStyle ring that exists before `CallForegroundService` does,
     * and that the service cancels when it takes the call over. See
     * `Conversations.CALL_PRENOTIFICATION_ID`.
     */
    @ReactMethod
    fun notifyCall(
        callId: String,
        peerId: String,
        callerName: String,
        avatarUrl: String,
        medium: String,
        recipientId: String,
        promise: Promise,
    ) {
        try {
            // False when the system refused the ring (notifications off), which
            // push.ts reports to Sentry: a ring that cannot be drawn is the one
            // failure the callee can never report themselves.
            val shown = Conversations.notifyCall(
                reactContext,
                callId = callId,
                peerId = peerId,
                callerName = callerName,
                avatarUrl = avatarUrl.ifEmpty { null },
                medium = medium,
                recipientId = recipientId.ifEmpty { null },
            )
            promise.resolve(shown)
        } catch (error: Exception) {
            android.util.Log.w("PappalCall", "notifyCall threw", error)
            promise.resolve(false)
        }
    }

    /** Clear a call notification once it is answered, declined or gone. */
    @ReactMethod
    fun clearCall(callId: String, promise: Promise) {
        Conversations.clearCall(reactContext, callId)
        promise.resolve(null)
    }

    /**
     * Post a chat-request notification with Accept/Decline action buttons.
     * Resolves rather than rejects on failure — same headless-handler contract as
     * `notify` and `notifyCall`. `inApp` and `silent` as on `notify`.
     */
    @ReactMethod
    fun notifyChatRequest(
        conversationId: String,
        peerId: String,
        senderName: String,
        requestId: String,
        sentAt: Double,
        avatarUrl: String,
        inApp: Boolean,
        silent: Boolean,
        recipientId: String,
        promise: Promise,
    ) {
        try {
            Conversations.notifyChatRequest(
                reactContext,
                conversationId = conversationId,
                peerId = peerId,
                senderName = senderName,
                requestId = requestId,
                sentAt = sentAt.toLong(),
                avatarUrl = avatarUrl.ifEmpty { null },
                inApp = inApp,
                silent = silent,
                recipientId = recipientId.ifEmpty { null },
            )
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /** Clear a conversation's notification once it has been read in the app. */
    @ReactMethod
    fun clear(conversationId: String, promise: Promise) {
        Conversations.clear(reactContext, conversationId)
        promise.resolve(null)
    }

    /**
     * Clear a chat request's notification after its Decline landed, only while
     * it is still that request's. See `Conversations.clearRequest`.
     */
    @ReactMethod
    fun clearRequest(conversationId: String, requestId: String, promise: Promise) {
        // Like notify: a system failure rejects the promise rather than
        // crashing the bridge thread.
        try {
            Conversations.clearRequest(reactContext, conversationId, requestId)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("E_CLEAR", e)
        }
    }

    /**
     * Every notification and conversation shortcut the signed-in account left
     * on this device, on sign-out and after account deletion. See
     * `Conversations.clearAll`.
     */
    @ReactMethod
    fun clearAll(promise: Promise) {
        try {
            Conversations.clearAll(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("E_CLEAR", e)
        }
    }

    /**
     * Starts the foreground service that keeps an active call alive in background.
     * Must be called from a foreground context (user action) on API 26+.
     * (developer.android.com/develop/background-work/services/foreground-services)
     */
    @ReactMethod
    fun startCallForegroundService(
        callerName: String,
        isIncoming: Boolean,
        includeMicrophone: Boolean,
        includeCamera: Boolean,
    ) {
        // Starts the FGS that keeps the call alive in background.
        // Must be called from a foreground context (user action).
        CallForegroundService.start(
            reactApplicationContext,
            callerName,
            isIncoming,
            includeMicrophone,
            includeCamera,
        )
    }

    /** Stops the call foreground service when the call ends or is declined. */
    @ReactMethod
    fun stopCallForegroundService() {
        CallForegroundService.stop(reactApplicationContext)
    }

    /**
     * Create the conversation channels early, so they exist in Settings before
     * the first push: Messages and the in-app one, both.
     *
     * A channel that only appears after the first notification means a user who
     * wants to pre-emptively silence the app finds nothing to silence.
     */
    @ReactMethod
    fun ensureChannel(promise: Promise) {
        Conversations.ensureChannel(reactContext)
        promise.resolve(null)
    }

    /**
     * One line of push diagnostics to logcat, under a tag of its own.
     *
     * Exists because the question "did this device register?" had no answer
     * in a RELEASE build. Registration in src/lib/push.ts only ever logged in
     * `__DEV__`, so a device with no row in `push_tokens` left nothing behind
     * to say whether the RPC failed, FCM had no token to give, or permission
     * was never granted. A fixed tag makes it one command on any build:
     * `adb logcat -s PappalPush`.
     * https://developer.android.com/reference/android/util/Log
     *
     * The caller composes the message and never passes the FCM token: a token
     * is a capability to push onto this lock screen (see migration 008), and
     * logcat is readable by anyone holding the phone over adb. Info and warn
     * only, both of which survive in release builds.
     */
    @ReactMethod
    fun pushLog(warn: Boolean, message: String) {
        if (warn) {
            Log.w(PUSH_LOG_TAG, message)
        } else {
            Log.i(PUSH_LOG_TAG, message)
        }
    }

    companion object {
        const val NAME = "Conversations"

        /** Stable, so the adb filter in docs and scripts keeps working. */
        const val PUSH_LOG_TAG = "PappalPush"
    }
}
