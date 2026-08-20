package com.companionchat

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

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
   * Store the new intent so `Linking.getInitialURL()` can see it.
   *
   * This activity is `singleTask`, so when the browser hands the OAuth callback
   * back to an app whose process was killed but whose task survived, Android
   * delivers it here rather than as a fresh launch intent. `getInitialURL()`
   * reads `getIntent()`, which without this still holds the original
   * `ACTION_MAIN` launcher intent — so the callback URL is silently dropped and
   * sign-in appears to hang on a loading screen with nothing in the logs.
   *
   * The `url` event path works without this, which is what made the bug
   * confusing: firing a deep link at a running app behaved perfectly, and only
   * the real flow — where the browser had pushed us out of memory — failed.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
  }
}
