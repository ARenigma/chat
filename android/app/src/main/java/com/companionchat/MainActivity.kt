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
   * Ask the display for its fastest mode so sheet springs and list flings vsync
   * at 90/120 Hz on panels that support it, instead of staying locked at 60.
   * https://developer.android.com/develop/ui/views/animations/frame-rate
   */
  private fun preferHighestRefreshRate() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    @Suppress("DEPRECATION")
    val display =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display
        else windowManager.defaultDisplay
    if (display == null) return
    val fastest = display.supportedModes.maxByOrNull { it.refreshRate } ?: return
    val params = window.attributes
    if (params.preferredDisplayModeId == fastest.modeId) return
    params.preferredDisplayModeId = fastest.modeId
    window.attributes = params
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
