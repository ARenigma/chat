package com.companionchat

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Promise
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.google.firebase.appdistribution.FirebaseAppDistribution
import com.truecaller.android.sdk.oAuth.CodeVerifierUtil
import com.truecaller.android.sdk.oAuth.TcOAuthCallback
import com.truecaller.android.sdk.oAuth.TcOAuthData
import com.truecaller.android.sdk.oAuth.TcOAuthError
import com.truecaller.android.sdk.oAuth.TcSdk
import com.truecaller.android.sdk.oAuth.TcSdkOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.math.BigInteger
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicReference

class MainActivity : ReactActivity() {

  companion object {
    const val BENCHMARK_READ_ONLY_EXTRA = "benchmark_read_only"
    private const val TAG = "MainActivity"

    /**
     * Captured before ReactActivity creates the React surface, so TurboModule
     * constants can expose the launch mode synchronously to the first JS render.
     * False is the safe default, and release ignores the extra entirely.
     */
    @Volatile
    var benchmarkReadOnlyLaunch: Boolean = false
      private set
  }

  // ---------------------------------------------------------------------------
  // Truecaller OAuth
  //
  // Lifecycle ownership: the launcher MUST be registered here, unconditionally,
  // before this Activity reaches STARTED. A module that registers it inside a
  // signIn() call would be too late — Android silently ignores post-STARTED
  // registrations. The TruecallerOAuthModule delegates to `beginTruecallerOAuth`;
  // it does not own any SDK state.
  //
  // https://developer.android.com/training/basics/intents/result
  // https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/implementing-callbacks
  // ---------------------------------------------------------------------------

  /**
   * The in-flight Promise for one Truecaller sign-in attempt. AtomicReference
   * prevents two concurrent attempts (JS cannot call signIn again while one is
   * active; a race between a module call and an orphan Activity result is also
   * guarded here).
   */
  private val pendingTruecallerPromise = AtomicReference<Promise?>(null)

  /**
   * PKCE verifier for the current attempt. Generated freshly per attempt and
   * nulled on terminal resolution. Never stored persistently — if the process
   * is killed the orphan Activity result is discarded.
   */
  @Volatile
  private var truecallerCodeVerifier: String? = null

  /** OAuth state for the current attempt. Validated before accepting success. */
  @Volatile
  private var truecallerState: String? = null

  /** Activity-owned job/scope for async SDK init; cancelled in onDestroy. */
  private val sdkJob = SupervisorJob()
  private val sdkScope = CoroutineScope(sdkJob + Dispatchers.IO)
  private val truecallerLifecycleLock = Any()

  @Volatile
  private var truecallerDestroyed = false

  /**
   * Registered unconditionally as a property (before STARTED) so the Activity
   * Result system can deliver results from this Activity even after process death
   * followed by task restore.
   *
   * https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/implementing-callbacks
   */
  private val truecallerLauncher = registerForActivityResult(StartActivityForResult()) {
    result: ActivityResult ->
      TcSdk.getInstance()?.onActivityResultObtained(this, result.resultCode, result.data)
  }

  private val tcOAuthCallback = object : TcOAuthCallback {
    override fun onSdkReady() {
      if (truecallerDestroyed) return
      val promise = pendingTruecallerPromise.get() ?: return
      val stateValue = truecallerState
      val verifier = truecallerCodeVerifier
      if (stateValue == null || verifier == null) {
        if (pendingTruecallerPromise.compareAndSet(promise, null)) {
          promise.reject(
            TruecallerOAuthModule.E_UNAVAILABLE,
            "Truecaller attempt state was lost.",
          )
        }
        return
      }

      try {
        if (!TcSdk.getInstance().isOAuthFlowUsable) {
          if (pendingTruecallerPromise.compareAndSet(promise, null)) {
            clearTruecallerAttempt()
            promise.reject(
              TruecallerOAuthModule.E_UNAVAILABLE,
              "Truecaller is not available on this device.",
            )
          }
          return
        }

        val challenge = CodeVerifierUtil.getCodeChallenge(verifier)
        if (challenge == null) {
          if (pendingTruecallerPromise.compareAndSet(promise, null)) {
            clearTruecallerAttempt()
            promise.reject(
              TruecallerOAuthModule.E_FAILED,
              "Device cannot produce a PKCE code challenge.",
            )
          }
          return
        }

        TcSdk.getInstance().setOAuthState(stateValue)
        TcSdk.getInstance().setOAuthScopes(arrayOf("openid", "phone"))
        TcSdk.getInstance().setCodeChallenge(challenge)
        runOnUiThread {
          TcSdk.getInstance().getAuthorizationCode(
            this@MainActivity,
            truecallerLauncher,
          )
        }
      } catch (error: Exception) {
        if (pendingTruecallerPromise.compareAndSet(promise, null)) {
          clearTruecallerAttempt()
          promise.reject(
            TruecallerOAuthModule.E_FAILED,
            error.message ?: "Truecaller SDK error.",
            error,
          )
        }
      }
    }

    override fun onVerificationRequired(error: TcOAuthError?) {
      if (truecallerDestroyed) return
      val promise = pendingTruecallerPromise.getAndSet(null) ?: return
      clearTruecallerAttempt()
      promise.reject(
        TruecallerOAuthModule.E_UNAVAILABLE,
        error?.errorMessage ?: "Truecaller verification is unavailable.",
      )
    }

    override fun onSuccess(data: TcOAuthData) {
      if (truecallerDestroyed) return
      val promise = pendingTruecallerPromise.getAndSet(null) ?: run {
        Log.w(TAG, "Truecaller onSuccess: no pending promise, discarding.")
        return
      }
      val sentState = truecallerState
      val verifier = truecallerCodeVerifier
      clearTruecallerAttempt()

      // State mismatch is a request-forgery signal; fail closed.
      if (data.state != sentState) {
        Log.e(TAG, "Truecaller state mismatch — possible CSRF. Rejecting.")
        promise.reject(TruecallerOAuthModule.E_FAILED, "OAuth state mismatch.")
        return
      }
      if (verifier == null) {
        // Process was recreated mid-attempt; no verifier to send the server.
        promise.reject(TruecallerOAuthModule.E_UNAVAILABLE, "No code verifier for this attempt.")
        return
      }
      com.facebook.react.bridge.Arguments.createMap().also { map ->
        map.putString("authorizationCode", data.authorizationCode)
        map.putString("codeVerifier", verifier)
        promise.resolve(map)
      }
    }

    override fun onFailure(error: TcOAuthError) {
      if (truecallerDestroyed) return
      val promise = pendingTruecallerPromise.getAndSet(null) ?: run {
        Log.w(TAG, "Truecaller onFailure (code ${error.errorCode}): no pending promise.")
        return
      }
      clearTruecallerAttempt()
      val outcome = TruecallerOAuthModule.errorCodeToOutcome(error)
      promise.reject(outcome, error.errorMessage ?: "Truecaller sign-in failed (${error.errorCode}).")
    }
  }

  /**
   * Called by TruecallerOAuthModule.signIn(). Initialises the SDK on a
   * background thread, validates usability, sets up PKCE + state, and invokes
   * the consent sheet.
   *
   * Only one attempt runs at a time. A concurrent call is rejected immediately
   * with E_UNAVAILABLE so the UI can remain stable.
   */
  fun beginTruecallerOAuth(promise: Promise) {
    if (!pendingTruecallerPromise.compareAndSet(null, promise)) {
      promise.reject(TruecallerOAuthModule.E_UNAVAILABLE, "A sign-in is already in progress.")
      return
    }

    // Generate one state/verifier pair before async initialization. onSdkReady
    // configures the initialized SDK and opens the consent sheet.
    truecallerState = BigInteger(130, SecureRandom()).toString(32)
    truecallerCodeVerifier = CodeVerifierUtil.generateRandomCodeVerifier()

    sdkScope.launch {
      try {
        synchronized(truecallerLifecycleLock) {
          if (truecallerDestroyed) return@launch

          // Clear any previous SDK instance so the fresh callback is wired
          // correctly, especially if the Activity was recreated.
          // https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/clearing-sdk-instance
          TcSdk.clear()

          val options = TcSdkOptions.Builder(this@MainActivity, tcOAuthCallback)
            .sdkOptions(TcSdkOptions.OPTION_VERIFY_ONLY_TC_USERS)
            .consentMode(TcSdkOptions.CONSENT_MODE_BOTTOMSHEET)
            // "Use another method" → Google (2026-09-24). The SDK has no custom
            // footer text; this is the closest preset to "Use Google instead".
            // Footer presets and their labels:
            // https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/customisation
            // Asserted in __tests__/platform.test.ts.
            .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_METHOD)
            .ctaText(TcSdkOptions.CTA_TEXT_CONTINUE)
            .build()

          // initAsync may continue on SDK-owned threads after this call returns.
          // onDestroy takes the same lock, marks destroyed, then clears the SDK;
          // every callback also checks truecallerDestroyed.
          TcSdk.initAsync(options)
        }
      } catch (e: Exception) {
        val p = pendingTruecallerPromise.getAndSet(null) ?: return@launch
        clearTruecallerAttempt()
        p.reject(TruecallerOAuthModule.E_FAILED, e.message ?: "Truecaller SDK error.")
      }
    }
  }

  private fun clearTruecallerAttempt() {
    truecallerState = null
    truecallerCodeVerifier = null
  }


  private fun updateBenchmarkLaunch(candidate: Intent) {
    benchmarkReadOnlyLaunch =
        BuildConfig.ALLOW_BENCHMARK_ROUTES &&
        candidate.getBooleanExtra(BENCHMARK_READ_ONLY_EXTRA, false)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "CompanionChat"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Block screenshots, screen recording, and the app-switcher thumbnail.
   *
   * `FLAG_SECURE` covers all three at once, which is the point: the person most
   * likely to capture a paid intimate conversation is someone intending to share
   * it, and a screenshot ban that leaves screen recording open bans nothing.
   *
   * Applied to every screen rather than only the transcript. A member's balance,
   * the directory they browsed and who they talked to are all disclosures, and a
   * per-screen rule is one somebody forgets to extend to the next screen.
   *
   * **Gated per build type, not on DEBUG.** A secure window returns nothing to
   * `screencap`, so debug and the named-tester variants stay capturable for
   * frame-by-frame defect reports. `BLOCK_SCREENSHOTS` is true only for the
   * production `release`; Play closed testing uses `closedTest`, not `release`.
   *
   * What it does not do, stated so nobody assumes otherwise: it cannot stop a
   * second phone pointed at the screen. It raises the effort, it does not remove
   * the possibility, which is why in-app reporting snapshots evidence server-side
   * rather than relying on the victim capturing anything.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    updateBenchmarkLaunch(intent)
    super.onCreate(savedInstanceState)

    /*
     * Edge to edge, declared rather than inherited.
     * https://developer.android.com/develop/ui/views/layout/edge-to-edge
     *
     * **Why this is not redundant even though we target SDK 36.** Android 15
     * (SDK 35) and above enforce edge-to-edge automatically, so on a new Pixel
     * this call changes nothing. `minSdkVersion` here is 24. On Android 7
     * through 14 — most of the Indian install base — enforcement does not
     * happen, the window is inset by the system, and every layout in this app
     * already pads itself using `useSafeAreaInsets`. The result on those devices
     * is the inset applied twice: a gap under the status bar and above the
     * navigation bar that nobody asked for. The docs are explicit that the
     * backward-compatible path is to call this yourself.
     *
     * The app was relying on React Native calling `updateEdgeToEdgeFeatureFlag`
     * internally, which is a framework detail and not a contract.
     *
     * `WindowCompat.enableEdgeToEdge` also makes the bars transparent and picks
     * light or dark system icons from the theme. The JS `<StatusBar>` in App.tsx
     * still drives icon appearance per theme mode, which is the layer that knows
     * whether the user is in dark mode.
     */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      /*
       * Set BEFORE `enableEdgeToEdge`, which the doc calls out specifically.
       *
       * This removes the translucent scrim the system draws behind three-button
       * navigation. It affects only three-button mode — a gesture navigation bar
       * is transparent regardless, and the docs say not to give it a background.
       * We want it off because the bloom field runs to the bottom edge of the
       * screen and a grey scrim over it reads as a rendering fault rather than
       * as a system affordance.
       */
      window.isNavigationBarContrastEnforced = false
    }
    WindowCompat.enableEdgeToEdge(window)

    /*
     * Vote for the panel's fastest mode from the first frame, not from the first
     * onResume. Amit, 2026-09-04: the Macrobenchmark setupBlock reads the mode
     * before the measured block, and a vote that lands one lifecycle step later
     * makes the first iteration run at a different vsync than the other nine.
     */
    preferHighestRefreshRate()

    if (BuildConfig.BLOCK_SCREENSHOTS) {
      window.setFlags(
          WindowManager.LayoutParams.FLAG_SECURE,
          WindowManager.LayoutParams.FLAG_SECURE,
      )
    }

    // A cold-start launched by a call's full-screen intent arrives here with the
    // call URI already on the intent. `neutralisedIfFromHistory` runs first: a
    // launch from Recents carries the SAME intent object, stale data and all —
    // see that function for why this used to replay a dead call.
    val safeIntent = neutralisedIfFromHistory(intent)
    if (safeIntent !== intent) setIntent(safeIntent)
    updateBenchmarkLaunch(safeIntent)
    applyCallWindowFlags(safeIntent)
  }

  /**
   * Show over the lock screen for an incoming CALL, and only a call.
   *
   * The call notification's full-screen intent (Conversations.notifyCall) launches
   * this singleTask activity with a `companionchat://call/…` data URI when the
   * screen is off or locked. `setShowWhenLocked` + `setTurnScreenOn` (API 27+)
   * render the ringing screen over the keyguard and wake the display, the way a
   * phone call does; `requestDismissKeyguard` lets a secure lock be dismissed as
   * the user answers. For any OTHER launch the flags are cleared, so the app never
   * sits over the lock screen outside a call — the narrow scope the reversed
   * 2026-08-27 decision requires (calls only, never messages).
   * https://developer.android.com/develop/ui/views/notifications/build-notification#urgent-message
   */
  /**
   * A relaunch from the Recents / task-switcher list carries the SAME
   * `getIntent()` object the app had when it was last put away — data URI and
   * all — because this activity is `singleTask` and Android is bringing the
   * existing task back to front, not starting a fresh one (2026-09-17 audit).
   *
   * Before this, a member could answer an incoming call, the call end, they
   * use other apps for a while, Android reclaims the process, and reopening
   * Pappal from Recents replayed the SAME `companionchat://call/…` intent as
   * though someone were calling again right now — full-screen intent,
   * foreground service, a minute of ringing, from nobody. A tapped message
   * notification's `companionchat://peer/<id>` replayed the same way,
   * reopening a paid conversation nobody asked to reopen — which directly
   * contradicts this app's own "always Home after a restart" rule (App.tsx,
   * 2026-09-08).
   *
   * `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` is exactly the signal Android gives
   * for this: it is set on the intent the system redelivers when an activity
   * is restored from the recent-tasks list, as opposed to a genuinely new
   * intent (a fresh notification tap, a fresh deep link). Neutralising the
   * intent here — replacing it with a bare `ACTION_MAIN`, not merely
   * stripping its data — is what makes `getIntent()` (which `Linking.
   * getInitialURL()` reads on the JS side) and `applyCallWindowFlags` both see
   * "no special launch", the same as any ordinary app reopen.
   *
   * Called from BOTH `onCreate` (Android restored the task with a fresh
   * Activity instance, the process having died) and `onNewIntent` (the task's
   * Activity instance survived and Android is redelivering to it) — the same
   * two places the platform docs name for this flag, because either can be
   * the actual path depending on whether the process survived.
   *
   * Takes and returns an explicit `Intent` rather than reading/writing
   * `getIntent()` implicitly: `onNewIntent(intent: Intent)`'s own parameter
   * shadows the class's `getIntent()` for the rest of that method, so a
   * version of this that mutated `getIntent()` behind the scenes would leave
   * `onNewIntent`'s own later reads of its local `intent` seeing the ORIGINAL,
   * still-stale value. Every call site uses the returned value from here on.
   */
  private fun neutralisedIfFromHistory(candidate: Intent): Intent =
      if (candidate.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
        Intent(Intent.ACTION_MAIN)
      } else {
        candidate
      }

  private fun applyCallWindowFlags(intent: Intent?) {
    val isCall = intent?.data?.toString()?.startsWith("companionchat://call/") == true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(isCall)
      setTurnScreenOn(isCall)
      if (isCall) {
        (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
            ?.requestDismissKeyguard(this, null)
      }
    } else {
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (isCall) window.addFlags(flags) else window.clearFlags(flags)
    }
  }

  /**
   * Store the new intent so `Linking.getInitialURL()` can see it.
   *
   * This activity is `singleTask`, so when the browser hands the OAuth callback
   * back to an app whose process was killed but whose task survived, Android
   * delivers it here rather than as a fresh launch intent. `getInitialURL()`
   * reads `getIntent()`, which without this still holds the original
   * `ACTION_MAIN` launcher intent, so the callback URL is silently dropped and
   * sign-in appears to hang on a loading screen with nothing in the logs.
   *
   * The `url` event path works without this, which is what made the bug
   * confusing: firing a deep link at a running app behaved perfectly, and only
   * the real flow, where the browser had pushed us out of memory, failed.
   */
  /**
   * Ask the display for its fastest mode AT THE CURRENT RESOLUTION so sheet
   * springs and list flings vsync at 90/120 Hz on panels that support it,
   * instead of staying locked at 60.
   * https://developer.android.com/media/optimize/performance/frame-rate
   *
   * **The bug this replaces (found 2026-09-04).** The first version took
   * `supportedModes.maxByOrNull { it.refreshRate }` with no resolution filter.
   * A Galaxy S22 Ultra exposes 120 Hz modes at 1440p, 1080p AND 720p, so the
   * "fastest" mode was whichever 120 Hz entry the OEM listed first — routinely
   * one at a different `physicalWidth`/`physicalHeight` than the mode the panel
   * was in. `preferredDisplayModeId` is a request for the whole mode, and the
   * frame-rate doc is explicit that it is the API to use "if the app wants to
   * change the resolution or other display mode settings". We never want that:
   * the vote asked the system to switch display resolution, which it either
   * refused (leaving us at 60 Hz with no error) or granted (a non-seamless
   * switch: black frame, relayout, every measurement since then invalid).
   *
   * **What is set, and why both.**
   *  - `preferredDisplayModeId` = the fastest mode whose physical size equals
   *    `display.mode`'s. The `LayoutParams.preferredRefreshRate` reference says
   *    the plain refresh-rate field is ignored when a mode id is set, so the mode
   *    id is the one the system honours on devices that expose modes.
   *  - `preferredRefreshRate` = that mode's rate as well. The frame-rate doc
   *    prefers this field when only the rate should change, and it is the
   *    mechanism the parity oracle uses: the reference app Android sets ONLY
   *    `preferredRefreshRate` to the maximum of `getSupportedRefreshRates()` and
   *    pushes it through `updateViewLayout` (measured fact from
   *    `AndroidUtilities.java:2819-2838`, see design/references/chat-app-mechanics.md; no
   *    code is copied). Carrying both means a device that ignores one still
   *    gets the vote from the other, and the two can never disagree because
   *    they are read from the same `Display.Mode`.
   *
   * **Deliberately NOT used:** `Surface.setFrameRate`. The doc frames it as a
   * content hint ("apps that want to inform the platform of their exact
   * intended frame rate", i.e. video), it overrides `preferredRefreshRate` for
   * the surface it is set on, and the app has no fixed content rate — its
   * animations want whatever the panel's fastest vsync is.
   *
   * **Windows this does not reach.** An RN `<Modal>` is a separate Dialog
   * window with its own `LayoutParams`; it carries no vote from this activity.
   * Whether the system keeps the panel at 120 Hz while a Modal is up is a thing
   * to MEASURE, not assume — `scripts/framestats.mjs` reports each window's
   * block from `dumpsys gfxinfo framestats` separately for exactly this reason.
   *
   * Called from `onCreate` (first frame), `onResume` (return from another app
   * that may have voted 60) and `onWindowFocusChanged(true)` (the vote is on
   * `window.attributes`, and focus is when the window manager has this window's
   * params settled after a Dialog or the IME took and released focus). Each
   * call is idempotent: the params are re-assigned only when they change, so
   * there is no relayout on a no-op.
   */
  private fun preferHighestRefreshRate() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    @Suppress("DEPRECATION")
    val display =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display
        else windowManager.defaultDisplay
    if (display == null) return
    val current = display.mode ?: return
    val fastest =
        display.supportedModes
            .filter {
              it.physicalWidth == current.physicalWidth &&
                  it.physicalHeight == current.physicalHeight
            }
            .maxByOrNull { it.refreshRate } ?: return
    val params = window.attributes
    val modeChanged = params.preferredDisplayModeId != fastest.modeId
    val rateChanged = params.preferredRefreshRate != fastest.refreshRate
    if (!modeChanged && !rateChanged) return
    params.preferredDisplayModeId = fastest.modeId
    params.preferredRefreshRate = fastest.refreshRate
    window.attributes = params
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) preferHighestRefreshRate()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // A warm app whose task survived gets the call's full-screen intent here
    // — or, if this is Android bringing the task back from Recents rather
    // than a real new intent, the SAME stale one it had before
    // (neutralisedIfFromHistory strips that case; see its docblock).
    val safeIntent = neutralisedIfFromHistory(intent)
    setIntent(safeIntent)
    updateBenchmarkLaunch(safeIntent)
    applyCallWindowFlags(safeIntent)
  }

  /**
   * Offer testers a newer build, if there is one.
   *
   * Unconditional on purpose. In `release` this links against
   * `firebase-appdistribution-api`, whose whole job is to be a no-op, so there is
   * no build-type check here and no variant-specific source set to keep in step.
   * In `internal` the real SDK is present and this shows Firebase's own dialog,
   * downloads the APK and installs it.
   *
   * `onResume` rather than `onCreate`, following Google's sample: a tester who
   * leaves the app open for a day and comes back is exactly the person a new
   * build is waiting for, and `onCreate` would only catch a cold start.
   *
   * Failures are logged and swallowed. The common ones are entirely normal on a
   * tester's device, not signed in to App Tester yet, no network, or simply no
   * new release, and none of them is worth a dialog on top of the app.
   */
  override fun onResume() {
    super.onResume()
    preferHighestRefreshRate()
    FirebaseAppDistribution.getInstance()
        .updateIfNewReleaseAvailable()
        .addOnFailureListener { error ->
          Log.i("AppDistribution", "no update offered: ${error.message}")
        }
  }

  override fun onDestroy() {
    sdkJob.cancel()
    synchronized(truecallerLifecycleLock) {
      truecallerDestroyed = true
      TcSdk.clear()
    }
    /*
     * Free SDK resources when the Activity is destroyed.
     *
     * Must be called here rather than onStop/onPause so a configuration change
     * (rotation, fold) that creates a new Activity instance calls clear() before
     * the new instance runs initAsync(). Failing to clear means the old callback
     * reference is still registered, and the result of the new consent sheet
     * would be delivered to a dead Activity rather than the new one.
     *
     * https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/clearing-sdk-instance
     */
    // If the Activity is destroyed while a sign-in is in progress (e.g. user
    // force-quits the app), reject the pending promise so the JS side is not
    // left waiting on a ghost.
    pendingTruecallerPromise.getAndSet(null)?.reject(
      TruecallerOAuthModule.E_UNAVAILABLE,
      "Activity was destroyed during sign-in.",
    )
    truecallerState = null
    truecallerCodeVerifier = null
    super.onDestroy()
  }
}
