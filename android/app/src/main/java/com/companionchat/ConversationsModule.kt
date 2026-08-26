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
