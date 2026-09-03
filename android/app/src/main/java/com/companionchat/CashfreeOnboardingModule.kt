package com.companionchat

import com.cashfree.kyc_verification_core.channel.CF1ClickOnboardingCallback
import com.cashfree.kyc_verification_core.models.CF1ClickOnboardingErrorResponse
import com.cashfree.kyc_verification_core.models.CF1ClickOnboardingResponse
import com.cashfree.kyc_verification_core.models.CFUserDropResponse
import com.cashfree.kyc_verification_core.services.CFVerificationService
import com.cashfree.kyc_verification_core.utils.Environment
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Cashfree 1-Click Onboarding, in an app-owned bottom sheet — the native bridge
 * and nothing else.
 *
 * **Why native at all.** Cashfree ships no React Native SDK for the Verification
 * Suite. Of the two paths their docs sanction for Android — the native SDK and a
 * raw web SDK we would host in our own WebView — RULE 1 (`CLAUDE.md`) says prefer
 * the platform's own solution over a hand-rolled one, so this wraps
 * `com.cashfree.vrs:kyc-verification`. The SDK renders a Cashfree-owned WebView
 * bottom sheet; we do not maintain that surface, and the auth_code it returns is
 * exchanged for verified data server-side, so no KYC PII passes through JS.
 * https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/1-click-onboarding-sdk#android-native
 *
 * **The API is taken from the compiled AAR, not the README.** The published
 * README advertises `CashfreeKycSdk.startKycVerification` and the coordinate
 * `com.cashfree.kyc:sdk`; both are stale. The real 1.0.1 surface is
 * `CFVerificationService.Builder().setContext(activity).build()`, then
 * `set1ClickOnboardingCallback`, then `open1ClickOnboarding(sessionId, env)` —
 * verified with `javap` against the artifact before this was written.
 *
 * Kept thin for the same reason as `GoogleCredentialModule`: nothing here can be
 * unit-tested without the Cashfree sheet on a real device, so the only logic is
 * the shape of the call and the meaning of each terminal callback. What to DO
 * about each outcome lives in `src/api/provider.ts`, where it is testable.
 */
class CashfreeOnboardingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Open the sheet for `sessionId` and resolve `{ verificationId, authCode,
     * status }` on consent.
     *
     * Rejection codes are kept distinct because the caller must tell them apart:
     * `onUserDrop` is a person backing out and must stay silent, exactly like a
     * dismissed Credential Manager sheet, while `onVerificationError` is worth
     * surfacing. Collapsing the two is how "Verification failed" ends up shown to
     * someone who simply closed the sheet.
     */
    @ReactMethod
    fun open1ClickOnboarding(sessionId: String, environment: String, promise: Promise) {
        // `reactApplicationContext`, not the constructor field: the property tracks
        // the live Activity, and a module can outlive one. The SDK's bottom sheet
        // needs an Activity (FragmentActivity) host — the ReactActivity is one.
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(E_NO_ACTIVITY, "No activity is attached.")
            return
        }

        // A Promise settles exactly once. The SDK callback is an interface on an
        // event bus, so guard against a second terminal event racing the first.
        val settled = AtomicBoolean(false)

        // The sheet is a WebView and must be built and opened on the main thread.
        UiThreadUtil.runOnUiThread {
            try {
                val service = CFVerificationService.Builder()
                    .setContext(activity)
                    .build()

                service.set1ClickOnboardingCallback(object : CF1ClickOnboardingCallback {
                    override fun onVerification(response: CF1ClickOnboardingResponse) {
                        if (!settled.compareAndSet(false, true)) return
                        promise.resolve(
                            Arguments.createMap().apply {
                                putString("verificationId", response.verificationId)
                                putString("authCode", response.authCode)
                                putString("status", response.status)
                            },
                        )
                    }

                    override fun onVerificationError(error: CF1ClickOnboardingErrorResponse) {
                        if (!settled.compareAndSet(false, true)) return
                        promise.reject(E_FAILED, error.status ?: "Verification failed.")
                    }

                    override fun onUserDrop(drop: CFUserDropResponse) {
                        if (!settled.compareAndSet(false, true)) return
                        promise.reject(E_CANCELLED, "Verification was dismissed.")
                    }
                })

                // Environment.TEST is the sandbox sheet; PROD is live. The value is
                // chosen by JS from the same flag the Edge functions read, so the
                // sheet and the server never disagree on environment.
                val env = if (environment == "production") Environment.PROD else Environment.TEST
                service.open1ClickOnboarding(sessionId, env)
            } catch (error: Exception) {
                // build() declares CFException/IllegalArgumentException; anything
                // thrown before a terminal callback is a hard failure to show.
                if (settled.compareAndSet(false, true)) {
                    promise.reject(E_FAILED, error.message ?: "Could not open verification.", error)
                }
            }
        }
    }

    companion object {
        const val NAME = "CashfreeOnboarding"
        const val E_NO_ACTIVITY = "no_activity"
        const val E_CANCELLED = "cancelled"
        const val E_FAILED = "failed"
    }
}
