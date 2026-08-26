package com.companionchat

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
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
 * **Three requests, not two, and the third is the one that was missing.**
 * https://developer.android.com/identity/sign-in/credential-manager-siwg
 *
 *   1. `GetGoogleIdOption` filtered to authorised accounts — a returning user
 *      gets a one-tap sheet with no picker.
 *   2. `GetGoogleIdOption` unfiltered — every account already on the device.
 *   3. `GetSignInWithGoogleOption` — the flow Google specifies for an explicit
 *      "Sign in with Google" BUTTON, which is exactly what this app has.
 *
 * The third tier is not a nicety. `GetGoogleIdOption` can only ever offer
 * accounts already present on the device, so it fails outright when there are
 * none, cannot add one, and cannot offer an account that needs
 * re-authentication. `GetSignInWithGoogleOption` handles all three. Google's own
 * guidance is to implement both and it lists the button flow as the fallback for
 * "user dismissed the bottom sheet or no accounts exist".
 *
 * **This was found by reading logcat, not by reasoning.** Driving the real flow
 * on API 34 showed both `GetGoogleIdOption` passes returning
 * `status: CANCELED, source: REMOTE_PROVIDER` with
 * `Auth.Api.Credentials: Operation execution failed`, after which the browser
 * fallback quietly carried the sign-in. The sheet had never produced a token and
 * nothing said so, because a working fallback is indistinguishable from a working
 * primary path unless you look.
 *
 * **The nonce is generated and hashed here, not in JS.** Supabase verifies the
 * ID token's nonce (`skip_nonce_check = false` in `supabase/config.toml`), and
 * the protocol wants the SHA-256 of a random value sent to Google while the raw
 * value goes to Supabase. React Native has no built-in SHA-256 and pulling a
 * crypto package in for one hash would be a dependency for four lines of
 * `MessageDigest`. So this returns both halves and JS forwards the raw one.
 *
 * **Verified on API 36 with Play services 25.08.34 (cc_api36_play AVD).** With no
 * Google account on the device, logcat shows all three tiers firing in order:
 * tier one CANCELED (nothing authorised), tier two CANCELED (no accounts at
 * all), then tier three opening `CredentialChooserActivity` ->
 * `PreAddAccountActivity` -> `MinuteMaidActivity` — Google's own add-account
 * flow, in-app, with no browser involved. That is precisely the case tiers one
 * and two structurally cannot serve, and it is why the button tier exists.
 * Backing out of it returns to the app with no error text and the button live,
 * which is the `E_CANCELLED` path behaving as intended.
 *
 * **What is still NOT verified: the token exchange.** Completing that flow means
 * signing into a real Google account, which is not something to do from an agent
 * session. So `signInWithIdToken` handing Supabase a token from this path has
 * never run. Sign in on the AVD by hand once and tiers one and two become
 * testable too — that is the remaining gap, and it is a small one.
 *
 * **The earlier failure, kept as a warning.** On the previous AVD (API 34, Play
 * services 23.18.18) all three tiers returned
 * `Auth.Api.Credentials: cgi: No matching credentials` and the browser fallback
 * carried every sign-in, while this path was reported as working. A working
 * fallback is indistinguishable from a working primary path unless you read the
 * log. The Play services version was the whole difference.
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

            // First pass: accounts that have already authorised this app, which
            // is a one-tap sheet with no picker for anyone coming back.
            val returning = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(true)
                .setServerClientId(webClientId)
                .setNonce(hashedNonce)
                .setAutoSelectEnabled(true)
                .build()

            try {
                val result = manager.getCredential(
                    activity,
                    GetCredentialRequest.Builder().addCredentialOption(returning).build(),
                )
                promise.resolve(result.toPayload(rawNonce))
                return@launch
            } catch (_: NoCredentialException) {
                // Expected on a first sign-in. Fall through and ask widely.
            } catch (error: GetCredentialCancellationException) {
                promise.reject(E_CANCELLED, "Sign-in was dismissed.", error)
                return@launch
            } catch (error: GetCredentialException) {
                promise.reject(E_FAILED, error.message ?: "Could not read a credential.", error)
                return@launch
            }

            val anyAccount = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId)
                .setNonce(hashedNonce)
                .setAutoSelectEnabled(false)
                .build()

            try {
                val result = manager.getCredential(
                    activity,
                    GetCredentialRequest.Builder().addCredentialOption(anyAccount).build(),
                )
                promise.resolve(result.toPayload(rawNonce))
                return@launch
            } catch (error: GetCredentialCancellationException) {
                // A dismissal is a decision. Stop, do not escalate to tier three.
                promise.reject(E_CANCELLED, "Sign-in was dismissed.", error)
                return@launch
            } catch (_: NoCredentialException) {
                // No account on the device. Tier three can add one.
            } catch (_: GetCredentialException) {
                // The provider itself failed, which is what happens on this
                // emulator. Tier three is a different provider path, so try it
                // rather than giving up here.
            }

            /*
             * Tier three: the button flow.
             *
             * `GetSignInWithGoogleOption` is what Google's own guidance names for
             * an explicit "Sign in with Google" button, and it is the only tier
             * that works with no account on the device, can add one, and can
             * offer an account needing re-authentication. Same nonce, so the
             * token still matches what Supabase is handed.
             */
            val button = GetSignInWithGoogleOption.Builder(webClientId)
                .setNonce(hashedNonce)
                .build()

            try {
                val result = manager.getCredential(
                    activity,
                    GetCredentialRequest.Builder().addCredentialOption(button).build(),
                )
                promise.resolve(result.toPayload(rawNonce))
            } catch (error: GetCredentialCancellationException) {
                promise.reject(E_CANCELLED, "Sign-in was dismissed.", error)
            } catch (error: NoCredentialException) {
                promise.reject(E_NO_ACCOUNT, "No Google account on this device.", error)
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
        const val E_NO_ACCOUNT = "no_account"
        const val E_FAILED = "failed"
    }
}
