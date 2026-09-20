package com.companionchat

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.truecaller.android.sdk.oAuth.TcSdk
import com.truecaller.android.sdk.oAuth.TcOAuthError

/**
 * Truecaller OAuth bridge — thin call forwarding and promise settlement only.
 *
 * SDK lifecycle (init, PKCE, state, launcher, callbacks, TcSdk.clear) lives in
 * MainActivity to guarantee the ActivityResultLauncher is registered before the
 * Activity reaches STARTED. A module call site that registers the launcher would
 * be too late — Android silently ignores registrations after STARTED.
 *
 * https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/initialisation
 * https://developer.android.com/training/basics/intents/result
 *
 * Kept thin for the same reason as GoogleCredentialModule and
 * CashfreeOnboardingModule: nothing here can be unit-tested without the
 * Truecaller consent sheet on a real device, so the only logic here is the
 * shape of the call and the meaning of each terminal outcome. What to DO about
 * each outcome lives in src/lib/truecallerOAuth.ts / src/api/auth.ts.
 */
class TruecallerOAuthModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Launch the Truecaller consent sheet and resolve { authorizationCode, codeVerifier }.
     *
     * The code verifier is the PKCE secret generated in MainActivity for this
     * attempt. It never leaves the device except via the Edge Function exchange,
     * which sends it directly to Truecaller's token endpoint. It is never stored
     * persistently; if the Activity/process is recreated without a live attempt
     * this returns E_UNAVAILABLE so onboarding retries cleanly.
     *
     * The verified phone is intentionally absent from this payload. The server
     * fetches it from Truecaller's userinfo endpoint after the exchange so nothing
     * sensitive transits JS or appears in logs here.
     *
     * Rejection codes:
     *   cancelled  — user dismissed (code 2/11/14); must stay silent in the UI.
     *   unavailable — Truecaller not installed, SDK not usable, or process
     *                 recreated with no live attempt; fall back to WhatsApp.
     *   failed      — configuration error (code 12 = wrong client-id/SHA-1) or
     *                 other hard failure; show an actionable error.
     */
    @ReactMethod
    fun signIn(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity !is MainActivity) {
            promise.reject(E_UNAVAILABLE, "No MainActivity attached.")
            return
        }
        // Delegate to the activity; it owns the launcher, the SDK instance, the
        // state, and the PKCE verifier for the current attempt.
        activity.beginTruecallerOAuth(promise)
    }

    companion object {
        const val NAME = "TruecallerOAuth"
        const val E_CANCELLED = "cancelled"
        const val E_ALTERNATE_NUMBER = "alternate_number"
        const val E_UNAVAILABLE = "unavailable"
        const val E_FAILED = "failed"

        /**
         * Map TcOAuthError codes to one of the three outcome buckets.
         *
         * From https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/handling-error-scenarios
         *
         *   0  — "Something went wrong"         → failed
         *   2  — "User denied while loading"    → cancelled
         *   5  — "App not installed/logged in"  → unavailable
         *   6  — "Conflicting request / old SDK" → failed
         *   7  — "App closed unexpectedly"       → unavailable (retry-safe)
         *   10 — "Invalid account state"         → failed
         *   11 — "Use another number" footer      → alternate_number
         *   12 — "Invalid partner info"          → failed  (config error)
         *   14 — enhanced-sheet alternate footer  → alternate_number
         *
         * SDK 3.3 device evidence (S22, Android 16): the loaded enhanced sheet's
         * "ENTER DETAILS MANUALLY" footer returns 14, despite the docs assigning
         * 11 to the footer and 14 to dismissal. System back/outside do not dismiss
         * this Activity. Code 2 remains the true loading-time cancellation.
         *   16 — "Device not supported"          → unavailable
         */
        fun errorCodeToOutcome(error: TcOAuthError): String = when (error.errorCode) {
            2 -> E_CANCELLED
            11, 14 -> E_ALTERNATE_NUMBER
            5, 7, 16 -> E_UNAVAILABLE
            else -> E_FAILED
        }
    }
}
