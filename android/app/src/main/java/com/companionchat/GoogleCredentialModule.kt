package com.companionchat

import androidx.credentials.CredentialManager
import androidx.credentials.CredentialOption
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Sign in with Google through Credential Manager, in an app-owned bottom sheet.
 *
 * **Why this exists at all.** The previous path opened the system browser for
 * Supabase's OAuth redirect. That works, and `src/api/auth.ts` explains at length
 * why it must never be an in-app *webview* — Google blocks those outright with
 * `disallowed_useragent`, because a webview showing a consent screen is
 * indistinguishable from a phishing page. Credential Manager is neither: it is a
 * platform sheet rendered by Play services, outside our process, which is why
 * Google sanctions it where they ban the webview. The user never leaves the app,
 * so the onboarding's one-screen property survives the only step that was
 * breaking it.
 *
 * **This is the explicit-button API.**
 * `GetSignInWithGoogleOption` is the option Google's implementation guide assigns
 * to a visible "Sign in with Google" button. The previous implementation put two
 * `GetGoogleIdOption` requests in front of it. Those are for automatic/returning
 * account sheets, and on the Play-installed build their provider failure was
 * surfaced as cancellation; JS therefore reset silently after account selection.
 * The visible button now invokes its matching API directly.
 *
 * https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
 *
 * **The nonce is generated and hashed here, not in JS.** Supabase verifies the
 * ID token's nonce (`skip_nonce_check = false` in `supabase/config.toml`), and
 * the protocol wants the SHA-256 of a random value sent to Google while the raw
 * value goes to Supabase. React Native has no built-in SHA-256 and pulling a
 * crypto package in for one hash would be a dependency for four lines of
 * `MessageDigest`. So this returns both halves and JS forwards the raw one.
 *
 * The Play-installed path still requires the Play App Signing certificate SHA-1
 * to be registered as an Android OAuth client. The upload-key SHA-1 does not
 * identify the APK Google re-signs and delivers to closed testers.
 *
 * Kept thin for the same reason as `InAppUpdateModule`: nothing in here can be
 * unit-tested without Play services on a real device, so the only logic here is
 * the part that has to be native.
 */
class GoogleCredentialModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * Open the sheet and resolve `{ idToken, rawNonce }`.
     *
     * Rejection codes are distinct because the caller has to tell them apart: a
     * cancellation is a person changing their mind and must stay silent, while a
     * failure is worth showing. Collapsing both into one error is how a dismissed
     * sheet ends up displaying "Sign-in failed" to someone who simply tapped
     * outside it.
     */
    @ReactMethod
    fun signIn(promise: Promise) {
        // `reactApplicationContext`, not the constructor parameter: the property
        // is what tracks the live Activity, and a module can outlive one.
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(E_NO_ACTIVITY, "No activity is attached.")
            return
        }

        val webClientId = reactContext.getString(R.string.default_web_client_id)

        // 32 bytes of SecureRandom, hex-encoded. The raw value goes to Supabase,
        // its SHA-256 goes to Google, and the token Google returns carries the
        // hash so Supabase can match the two.
        val rawNonce = ByteArray(32).also { SecureRandom().nextBytes(it) }.toHex()
        val hashedNonce = MessageDigest.getInstance("SHA-256")
            .digest(rawNonce.toByteArray())
            .toHex()

        scope.launch {
            val manager = CredentialManager.create(reactContext)

            suspend fun attempt(option: CredentialOption): GetCredentialResponse =
                manager.getCredential(
                    activity,
                    GetCredentialRequest.Builder().addCredentialOption(option).build(),
                )

            /*
             * The implementation guide says to ship BOTH surfaces, in this order,
             * and that is what produces the bottom sheet the button alone did not:
             *   1. GetGoogleIdOption(filterByAuthorizedAccounts = true) — the
             *      slide-up sheet for accounts already authorised for this app,
             *      with auto-select for a lone returning account.
             *   2. GetGoogleIdOption(filterByAuthorizedAccounts = false) — the
             *      sheet again, now over every Google account on the device.
             *   3. GetSignInWithGoogleOption — the explicit "Sign in with Google"
             *      button/dialog, the last resort that can also ADD an account
             *      when the device has none (the sheet cannot).
             * https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
             *
             * The nonce is generated once and every option carries the same hash,
             * so the single rawNonce returned to JS matches whichever surface wins.
             *
             * History: an earlier build put GetGoogleIdOption first and it failed
             * with GMS status 16 surfaced as cancellation — because the Google
             * Cloud project had no ANDROID OAuth client (client_type 1) for the
             * signing certificate, only the Web client. Both signing certs are now
             * registered (see CREDENTIAL_MANAGER_ENABLED in src/api/auth.ts), so
             * the sheet resolves instead of dead-ending. `NoCredentialException`
             * (no matching account for this step) falls through to the next; a
             * real cancellation — the user dismissing a surface — stops here.
             */
            val sheetAuthorized = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(true)
                .setServerClientId(webClientId)
                .setAutoSelectEnabled(true)
                .setNonce(hashedNonce)
                .build()
            val sheetAll = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId)
                .setNonce(hashedNonce)
                .build()
            val button = GetSignInWithGoogleOption.Builder(webClientId)
                .setNonce(hashedNonce)
                .build()

            try {
                val result =
                    try {
                        attempt(sheetAuthorized)
                    } catch (noAuthorized: NoCredentialException) {
                        try {
                            attempt(sheetAll)
                        } catch (noAny: NoCredentialException) {
                            attempt(button)
                        }
                    }
                promise.resolve(result.toPayload(rawNonce))
            } catch (error: GetCredentialCancellationException) {
                promise.reject(E_CANCELLED, "Sign-in was dismissed.", error)
            } catch (error: GetCredentialException) {
                promise.reject(E_FAILED, error.message ?: "Could not sign in.", error)
            }
        }
    }

    private fun androidx.credentials.GetCredentialResponse.toPayload(rawNonce: String) =
        Arguments.createMap().apply {
            val credential = this@toPayload.credential
            if (
                credential !is CustomCredential ||
                credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                throw IllegalStateException("Unexpected credential ${credential.type}")
            }
            putString("idToken", GoogleIdTokenCredential.createFrom(credential.data).idToken)
            putString("rawNonce", rawNonce)
        }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        const val NAME = "GoogleCredential"
        const val E_NO_ACTIVITY = "no_activity"
        const val E_CANCELLED = "cancelled"
        const val E_FAILED = "failed"
    }
}
