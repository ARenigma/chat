package com.companionchat

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.core.view.WindowCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.google.firebase.appdistribution.FirebaseAppDistribution

class MainActivity : ReactActivity() {

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
   *    mechanism the parity oracle uses: Telegram Android sets ONLY
   *    `preferredRefreshRate` to the maximum of `getSupportedRefreshRates()` and
   *    pushes it through `updateViewLayout` (measured fact from
   *    `AndroidUtilities.java:2819-2838`, see design/references/telegram.md; no
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
    setIntent(intent)
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
}
