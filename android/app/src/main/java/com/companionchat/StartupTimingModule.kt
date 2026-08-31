package com.companionchat

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Exposes Android's time-to-full-display boundary to the React boot machine.
 *
 * TTID is automatic. TTFD is not: Android records it only after
 * Activity.reportFullyDrawn(), and that call belongs after session restoration
 * has selected a usable screen rather than after the first empty React frame.
 *
 * https://developer.android.com/topic/performance/vitals/launch-time
 */
class StartupTimingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val reported = AtomicBoolean(false)

    override fun getName(): String = NAME

    @ReactMethod
    fun reportFullyDrawn() {
        if (!reported.compareAndSet(false, true)) return

        val activity = reactContext.currentActivity ?: run {
            reported.set(false)
            return
        }
        activity.runOnUiThread {
            activity.reportFullyDrawn()
        }
    }

    companion object {
        const val NAME = "StartupTiming"
    }
}
