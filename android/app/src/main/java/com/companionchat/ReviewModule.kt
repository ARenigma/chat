package com.companionchat

import android.app.Activity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * Google Play in-app review.
 *
 * Thin on purpose, like InAppUpdateModule: *when* to ask is policy and lives in
 * `src/lib/inAppReview.ts`; this only runs the documented two-step flow.
 *
 * https://developer.android.com/guide/playcore/in-app-review
 *   - Ask after the user has had a good experience, never from a button that
 *     promises a result: Play enforces a quota, so the card may not appear.
 *   - Never ask a question before the card; surface it untouched.
 * https://developer.android.com/guide/playcore/in-app-review/kotlin-java
 *   - `ReviewManagerFactory.create(context)`, `requestReviewFlow()`, then
 *     `launchReviewFlow(activity, reviewInfo)` with an `Activity`.
 *   - On error "don't inform the user or change the normal flow"; the launch
 *     task completes whether or not a card was shown, and says nothing about
 *     whether the user reviewed. So the promise resolves true only for "the
 *     flow ran to completion", never "a review was left".
 * https://developer.android.com/guide/playcore/in-app-review/test
 *   - Only works for an install from Play (internal track counts); anywhere
 *     else the request fails and this resolves false.
 */
class ReviewModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun request(promise: Promise) {
        val activity: Activity? = reactContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        try {
            val manager = ReviewManagerFactory.create(reactContext)
            manager.requestReviewFlow().addOnCompleteListener { request ->
                if (!request.isSuccessful) {
                    promise.resolve(false)
                    return@addOnCompleteListener
                }
                // Runs later on the main thread, outside the try above.
                try {
                    manager.launchReviewFlow(activity, request.result)
                        .addOnCompleteListener { promise.resolve(true) }
                } catch (error: RuntimeException) {
                    android.util.Log.w("InAppReview", "review flow failed", error)
                    promise.resolve(false)
                }
            }
        } catch (error: RuntimeException) {
            promise.resolve(false)
        }
    }

    companion object {
        const val NAME = "InAppReview"
    }
}
