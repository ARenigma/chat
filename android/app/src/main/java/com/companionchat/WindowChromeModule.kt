package com.companionchat

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * Window-level chrome the JS sheets cannot reach: activity backdrop blur and
 * the preferred display mode.
 *
 * Blur: [View.setRenderEffect] on `android.R.id.content` (API 31+). The RN
 * Modal is a separate Dialog window, so blurring the activity blurs the page
 * behind the sheet without a screenshot (FLAG_SECURE would block that) and
 * without `@react-native-community/blur` (broken on Fabric).
 * https://developer.android.com/reference/android/view/View#setRenderEffect
 *
 * Refresh: [android.view.WindowManager.LayoutParams.preferredDisplayModeId]
 * picks the panel's highest mode so a 120 Hz device is not stuck at 60.
 * https://developer.android.com/develop/ui/views/animations/frame-rate
 */
class WindowChromeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun setActivityBlur(enabled: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        UiThreadUtil.runOnUiThread {
            val content = reactContext.currentActivity?.findViewById<ViewGroup>(android.R.id.content)
                ?: return@runOnUiThread
            content.setRenderEffect(
                if (enabled) {
                    RenderEffect.createBlurEffect(BLUR_PX, BLUR_PX, Shader.TileMode.CLAMP)
                } else {
                    null
                },
            )
        }
    }

    /**
     * The refresh rate the display is ACTUALLY running at, in Hz.
     *
     * `Display.getRefreshRate()` reports the current mode, which is the point:
     * it reflects whatever vote won, including this activity's own
     * `preferredDisplayModeId`. So it answers the question MainActivity's note
     * poses — is the panel in its fast mode — rather than the question "what is
     * this panel capable of".
     * https://developer.android.com/reference/android/view/Display#getRefreshRate()
     *
     * Read on the UI thread: the display is a window-manager property and
     * `Activity.getDisplay()` throws if the activity is not attached.
     *
     * Why it exists: `perfTelemetry.startFrameWatch` had to INFER the interval
     * from a rolling median of `requestAnimationFrame` deltas and snap it to a
     * table of known panel rates, because nothing exposed the real number. The
     * inference works, but it needs ~20 frames before it is trustworthy and it
     * cannot tell 60 Hz from a 120 Hz panel that is dropping every other frame.
     * This can, immediately.
     */
    @ReactMethod
    fun getRefreshRate(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.resolve(null)
                return@runOnUiThread
            }
            val display =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    activity.display
                } else {
                    @Suppress("DEPRECATION")
                    activity.windowManager.defaultDisplay
                }
            // A rate of 0 is not a measurement; report absence instead so the
            // caller keeps its own estimate rather than believing a zero.
            val hz = display?.refreshRate ?: 0f
            promise.resolve(if (hz > 1f) hz.toDouble() else null)
        }
    }

    /**
     * Lift or restore FLAG_SECURE for product-demo purposes.
     *
     * Two independent gates must both pass before capture is unblocked:
     *
     *   1. Build variant (compile-time): `BuildConfig.ALLOW_DEV_CAPTURE` is
     *      `true` only in the `internal` build variant. In `release` this
     *      method is an unconditional no-op — the APK cannot reach the
     *      `clearFlags` branch regardless of what the caller passes.
     *      https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
     *
     *   2. Account (runtime): the JS caller (`src/lib/demoCapture.ts`) passes
     *      `enabled = true` only when the signed-in email ends with
     *      `@example.test` (the dev-seed domain from `scripts/seed-dev.sql`).
     *      A real member on an internal build keeps FLAG_SECURE.
     *
     * `clearFlags`/`addFlags` are symmetric so a sign-out (enabled = false)
     * immediately restores protection without an activity restart.
     */
    @ReactMethod
    fun setDemoCaptureEnabled(enabled: Boolean) {
        // Gate 1: compile-time variant check. `release` always takes this
        // branch and returns before any window flag is touched.
        if (!BuildConfig.ALLOW_DEV_CAPTURE) return
        UiThreadUtil.runOnUiThread {
            val win = reactContext.currentActivity?.window ?: return@runOnUiThread
            if (enabled) {
                win.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                win.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }

    companion object {
        const val NAME = "WindowChrome"
        /** 20 px is enough to read as frost without smearing type on the page. */
        const val BLUR_PX = 20f
    }
}
