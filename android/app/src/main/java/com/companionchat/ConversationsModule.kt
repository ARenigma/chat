package com.companionchat

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
     */
    @ReactMethod
    fun notify(
        conversationId: String,
        peerId: String,
        senderName: String,
        body: String,
        sentAt: Double,
        avatarUrl: String,
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
     * Ring an incoming call from the push — the PRE-notification, in Telegram's
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
        promise: Promise,
    ) {
        try {
            Conversations.notifyCall(
                reactContext,
                callId = callId,
                peerId = peerId,
                callerName = callerName,
                avatarUrl = avatarUrl.ifEmpty { null },
                medium = medium,
            )
            promise.resolve(true)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    /** Clear a call notification once it is answered, declined or gone. */
    @ReactMethod
    fun clearCall(callId: String, promise: Promise) {
        Conversations.clearCall(reactContext, callId)
        promise.resolve(null)
    }

    /** Clear a conversation's notification once it has been read in the app. */
    @ReactMethod
    fun clear(conversationId: String, promise: Promise) {
        Conversations.clear(reactContext, conversationId)
        promise.resolve(null)
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
     * Create the channel early, so it exists in Settings before the first push.
     *
     * A channel that only appears after the first notification means a user who
     * wants to pre-emptively silence the app finds nothing to silence.
     */
    @ReactMethod
    fun ensureChannel(promise: Promise) {
        Conversations.ensureChannel(reactContext)
        promise.resolve(null)
    }

    companion object {
        const val NAME = "Conversations"
    }
}
