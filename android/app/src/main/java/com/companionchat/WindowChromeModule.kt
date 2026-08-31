package com.companionchat

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.view.View
import android.view.ViewGroup
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

    companion object {
        const val NAME = "WindowChrome"
        /** 20 px is enough to read as frost without smearing type on the page. */
        const val BLUR_PX = 20f
    }
}
